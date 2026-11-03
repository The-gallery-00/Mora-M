import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image

import storage


class StorageValidationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = patch.object(storage, "UPLOAD_DIR", Path(self.tmp.name))
        self.directory.start()

    def tearDown(self):
        self.directory.stop()
        self.tmp.cleanup()

    def image(self):
        content = io.BytesIO()
        Image.new("RGB", (10, 10)).save(content, "PNG")
        content.seek(0)
        return UploadFile(content, filename="image.png")

    def test_actual_image_is_saved(self):
        path = storage.save_upload_file(self.image(), "safe.png")
        self.assertTrue(path.exists())

    def test_traversal_and_active_file_extensions_are_rejected(self):
        for name in ["../outside.png", "safe.html", "nested/file.png"]:
            with self.subTest(name=name), self.assertRaises(HTTPException):
                storage.save_upload_file(self.image(), name)

    def test_invalid_content_is_rejected_and_removed(self):
        file = UploadFile(io.BytesIO(b"not an image"), filename="fake.png")
        with self.assertRaises(HTTPException) as error:
            storage.save_upload_file(file, "fake.png")
        self.assertEqual(422, error.exception.status_code)
        self.assertFalse((storage.UPLOAD_DIR / "fake.png").exists())

    def test_byte_and_dimension_limits_remove_partial_files(self):
        for limit, value in [("MAX_UPLOAD_BYTES", 8), ("MAX_IMAGE_PIXELS", 20)]:
            with self.subTest(limit=limit), patch.object(storage, limit, value):
                with self.assertRaises(HTTPException) as error:
                    storage.save_upload_file(self.image(), "large.png")
                self.assertEqual(413, error.exception.status_code)
                self.assertFalse((storage.UPLOAD_DIR / "large.png").exists())


if __name__ == "__main__":
    unittest.main()
