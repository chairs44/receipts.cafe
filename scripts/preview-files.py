"""Emit the exact isolated preview deployment source manifest. No credentials."""
import base64
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
paths=[*sorted((root/'public').rglob('*')),*sorted((root/'lib').rglob('*.js')),root/'api/image-submit.js',root/'package.json',root/'package-lock.json']
files=[{'file':str(p.relative_to(root)),'data':base64.b64encode(p.read_bytes()).decode(),'encoding':'base64'} for p in paths if p.is_file()]
# Replace production entry points only in the isolated preview manifest.
by_name = {entry['file']: entry for entry in files}
for path in sorted((root / 'preview').glob('*')):
    name = 'public/' + path.name
    by_name[name] = {'file': name, 'data': base64.b64encode(path.read_bytes()).decode(), 'encoding': 'base64'}
files = list(by_name.values())
config=json.loads((root/'vercel.json').read_text())
config.pop('redirects',None)
config['functions']={'api/image-submit.js':{'maxDuration':10}}
files.append({'file':'vercel.json','data':json.dumps(config),'encoding':'utf-8'})
print(json.dumps(files))
