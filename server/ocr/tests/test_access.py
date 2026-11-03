import hashlib
import os
import time
import unittest
from unittest.mock import patch

import jwt
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from access import require_ocr_access


SECRET = "test-only-secret-that-is-at-least-32-characters"
KEY = hashlib.sha256(("mora-ocr-service:" + SECRET).encode()).digest()


class AccessTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"OCR_SHARED_SECRET": SECRET})
        self.env.start()
        app = FastAPI()
        guard = [Depends(require_ocr_access)]

        @app.get("/uploads/{image_name}", dependencies=guard)
        @app.delete("/uploads/{image_name}", dependencies=guard)
        @app.post("/api/scan", dependencies=guard)
        @app.post("/api/commit", dependencies=guard)
        def protected():
            return {"ok": True}

        self.client = TestClient(app)

    def tearDown(self):
        self.env.stop()

    def token(self, **overrides):
        claims = {"iss": "mora-spring", "aud": "mora-ocr", "iat": int(time.time()),
                  "exp": int(time.time()) + 120, "operation": "read", "image_name": "mine.jpg"}
        claims.update(overrides)
        return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="HS256")}

    def test_anonymous_reads_deletes_and_uploads_are_denied(self):
        for method, path in [("GET", "/uploads/mine.jpg"), ("DELETE", "/uploads/mine.jpg"),
                             ("POST", "/api/scan"), ("POST", "/api/commit")]:
            with self.subTest(method=method):
                self.assertEqual(401, self.client.request(method, path).status_code)

    def test_read_token_cannot_delete_or_read_another_image(self):
        h = self.token()
        self.assertEqual(200, self.client.get("/uploads/mine.jpg", headers=h).status_code)
        self.assertEqual(403, self.client.delete("/uploads/mine.jpg", headers=h).status_code)
        self.assertEqual(403, self.client.get("/uploads/other.jpg", headers=h).status_code)

    def test_scan_and_commit_require_separate_scopes(self):
        h = self.token(operation="scan", image_name="")
        self.assertEqual(200, self.client.post("/api/scan", headers=h).status_code)
        self.assertEqual(403, self.client.post("/api/commit", headers=h).status_code)
        self.assertEqual(200, self.client.post("/api/commit", headers=self.token(operation="commit")).status_code)

    def test_expiry_audience_issuer_and_signature_are_enforced(self):
        for overrides in [{"exp": int(time.time()) - 1}, {"aud": "other"}, {"iss": "other"}]:
            with self.subTest(overrides=overrides):
                self.assertEqual(401, self.client.get("/uploads/mine.jpg", headers=self.token(**overrides)).status_code)
        h = {"Authorization": "Bearer " + jwt.encode({"sub": "user", "exp": int(time.time()) + 120}, SECRET, algorithm="HS256")}
        self.assertEqual(401, self.client.get("/uploads/mine.jpg", headers=h).status_code)

    def test_missing_shared_secret_fails_closed(self):
        with patch.dict(os.environ, {"OCR_SHARED_SECRET": ""}):
            self.assertEqual(503, self.client.get("/uploads/mine.jpg", headers=self.token()).status_code)


if __name__ == "__main__":
    unittest.main()
