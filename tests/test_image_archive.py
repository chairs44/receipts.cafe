import base64
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location("worker", Path(__file__).resolve().parents[1] / "scripts/receipt-drop-poller.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class ArchiveTest(unittest.TestCase):
    def test_image_and_text_share_archive(self):
        pixels = bytes(range(256)) * 128
        image = dict(kind="image", message="[Image receipt]", id="archive-check", raster=base64.b64encode(pixels).decode())
        with tempfile.TemporaryDirectory() as d, patch.object(worker,"ARCHIVE_DIR",Path(d)), patch.object(worker,"MIRROR_PATH",Path(d)/"mirror"):
            for job in [dict(id="text-check",message="Archive test"), image]:
                with patch.object(worker,"print_receipt") as spool, patch.object(worker,"ack") as ack:
                    worker.print_and_ack(job)
                    spool.assert_called_once()
                    ack.assert_called_once()
            rows = [json.loads(line) for line in (Path(d)/"events/printed.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows),2)
            for row in rows:
                png = Path(d)/row["receipt_image_path"]
                self.assertTrue((Path(d)/row["receipt_text_path"]).exists())
                self.assertEqual(png.read_bytes(),(Path(d)/"mirror"/row["receipt_image_path"]).read_bytes())
            with Image.open(Path(d)/rows[1]["receipt_image_path"]) as png:
                self.assertEqual(png.width, 512)
                self.assertGreater(png.height, 512)
                self.assertEqual(png.convert("1").tobytes(), worker.render_receipt_image(image).tobytes())
            self.assertIn(worker.raster_bytes(worker.render_receipt_image(image))[2],worker.render_escpos(image))
            self.assertIn("archive-check",(Path(d)/"exports/receipt-cafe-log.csv").read_text())
            self.assertNotIn("raster",(Path(d)/"events/claimed.jsonl").read_text())
