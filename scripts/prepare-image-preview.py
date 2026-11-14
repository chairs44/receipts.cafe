#!/usr/bin/env python3
"""Archive a downloaded test PNG and prepare ESC/POS bytes. Never prints."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from PIL import Image


def private_write(path, data):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as file:
        file.write(data)
    path.chmod(0o600)


def prepare_image(source, archive):
    source, archive = Path(source), Path(archive)
    if source.stat().st_size > 150_000:
        raise ValueError('Image must be under 150 KB.')
    with Image.open(source) as original:
        if original.format != 'PNG' or original.width != 512 or not 128 <= original.height <= 1024:
            raise ValueError('Expected a PNG, 512 pixels wide and 128–1024 pixels tall.')
        original.load()
        image = Image.new('RGBA', original.size, 'white')
        image.alpha_composite(original.convert('RGBA'))
        image = image.convert('L').point(lambda p: 0 if p < 128 else 255, '1')
    archive.mkdir(parents=True, exist_ok=True, mode=0o700)
    identity = hashlib.sha256(source.read_bytes()).hexdigest()[:24]
    image_path = archive / f'{identity}.png'
    private_write(image_path, source.read_bytes())
    # ESC/POS raster: set bits represent black dots, opposite PNG's white bits.
    raster = bytes(byte ^ 255 for byte in image.tobytes())
    height = image.height
    raw = b'\x1b@\x1dv0\x00' + bytes([64, 0, height % 256, height // 256]) + raster + b'\x1bd\x08\x1dV\x01'
    escpos_path = archive / f'{identity}.escpos'
    private_write(escpos_path, raw)
    private_write(archive / f'{identity}.json', json.dumps({'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'width': 512, 'height': height, 'printed': False}).encode())
    return {'image': image_path, 'escpos': escpos_path}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    outputs = prepare_image(args.image, args.archive)
    print(json.dumps({key: str(value) for key, value in outputs.items()}))
