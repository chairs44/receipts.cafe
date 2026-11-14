import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec=importlib.util.spec_from_file_location('prepare',Path(__file__).parents[1]/'scripts'/'prepare-image-preview.py')
prepare=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class PrepareImageTest(unittest.TestCase):
 def test_saves_private_copy_and_raster_before_any_print(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source.png';Image.new('1',(512,256),1).save(source)
   output=prepare.prepare_image(source,root/'private')
   self.assertTrue(output['image'].is_file());self.assertTrue(output['escpos'].is_file())
   data=output['escpos'].read_bytes();self.assertEqual(data[:2],b'\x1b@');self.assertTrue(data.endswith(b'\x1dV\x01'))
   self.assertEqual(output['image'].stat().st_mode & 0o777,0o600)
 def test_rejects_oversize_input(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'source.png';Image.new('1',(512,1025),1).save(source)
   with self.assertRaises(ValueError):prepare.prepare_image(source,Path(folder)/'archive')
if __name__=='__main__':unittest.main()
