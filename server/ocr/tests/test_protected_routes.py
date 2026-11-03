"""Exercise real HTTP routes with the expensive OCR engine replaced by a stub."""
import hashlib
import importlib
import io
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import jwt
from fastapi.testclient import TestClient
from PIL import Image

SECRET = "test-only-secret-that-is-at-least-32-characters"


class ProtectedRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        engine = types.ModuleType("services")
        engine.pipeline = Mock()
        engine.parsing_skill = Mock()
        with patch.dict(sys.modules, {"services": engine}):
            cls.app = importlib.import_module("app").app

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        import storage
        self.environment = patch.dict(os.environ, {"OCR_SHARED_SECRET": SECRET})
        self.directory = patch.object(storage, "UPLOAD_DIR", Path(self.tmp.name))
        self.environment.start()
        self.directory.start()
        self.client = TestClient(self.app)

    def tearDown(self):
        self.directory.stop()
        self.environment.stop()
        self.tmp.cleanup()

    def headers(self, operation, name=""):
        key = hashlib.sha256(("mora-ocr-service:" + SECRET).encode()).digest()
        payload = {"iss": "mora-spring", "aud": "mora-ocr", "iat": int(time.time()),
                   "exp": int(time.time()) + 120, "operation": operation, "image_name": name}
        return {"Authorization": "Bearer " + jwt.encode(payload, key, algorithm="HS256")}

    def image_bytes(self):
        b = io.BytesIO()
        Image.new("RGB", (10, 10)).save(b, "PNG")
        return b.getvalue()

    def test_real_routes_deny_anonymous_uploads_reads_and_deletes(self):
        for route in ["scan", "commit"]:
            response = self.client.post("/api/" + route,
                                        files={"file": ("safe.png", self.image_bytes(), "image/png")})
            self.assertEqual(401, response.status_code)
        self.assertEqual(401, self.client.get("/uploads/safe.png").status_code)
        self.assertEqual(401, self.client.delete("/uploads/safe.png").status_code)

    def test_health_does_not_report_ready_without_service_authentication(self):
        with patch.dict(os.environ, {"OCR_SHARED_SECRET": ""}):
            response = self.client.get("/health")
            self.assertEqual(503, response.status_code)
            self.assertEqual("not-run", response.json()["ocr"])

    def test_authenticated_commit_read_and_delete_with_scoped_credentials(self):
        response = self.client.post("/api/commit", headers=self.headers("commit"),
                                    files={"file": ("safe.png", self.image_bytes(), "image/png")},
                                    data={"document_type": "RECEIPT", "raw_blocks": "[]", "corrected_fields": "{}"})
        self.assertEqual(200, response.status_code)
        path = response.json()["data"]["image_url"]
        name = path.split("/")[-1]
        self.assertEqual(403, self.client.get(path, headers=self.headers("read", "wrong.png")).status_code)
        self.assertEqual(200, self.client.get(path, headers=self.headers("read", name)).status_code)
        self.assertEqual(403, self.client.delete(path, headers=self.headers("read", name)).status_code)
        self.assertEqual(200, self.client.delete(path, headers=self.headers("delete", name)).status_code)
        self.assertEqual(404, self.client.get(path, headers=self.headers("read", name)).status_code)


if __name__ == "__main__":
    unittest.main()
