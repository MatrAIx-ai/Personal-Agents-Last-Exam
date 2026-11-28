#!/usr/bin/env python3
"""Shrinks the curated implementation screenshots in evidence/screens/ after
`node apps/crossway/tests/web-checks.cjs --evidence` writes them: each PNG is
reduced to a 128-colour palette (lossy, like JPEG quality, but still PNG) and
saved optimized. The manifest records the step. Needs Pillow.
Run: python3 -I apps/crossway/evidence/compress-screens.py
"""
import glob
import json
import os
from PIL import Image

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screens')
before = after = 0
for path in sorted(glob.glob(os.path.join(here, '*.png'))):
    before += os.path.getsize(path)
    Image.open(path).convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    after += os.path.getsize(path)
manifest_path = os.path.join(here, 'manifest.json')
with open(manifest_path) as f:
    manifest = json.load(f)
manifest['compression'] = {'by': 'python3 -I apps/crossway/evidence/compress-screens.py', 'method': '128-colour palette PNG (Pillow median cut), optimized',
                           'bytes_before': before, 'bytes_after': after}
with open(manifest_path, 'w') as f:
    f.write(json.dumps(manifest, indent=2) + '\n')
print(f'{before} -> {after} bytes')
