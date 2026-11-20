#!/usr/bin/env python3
"""Turn the Roadmap Planner's hub code into files in hub/.

The Qargo Artifacts hub runs the planner from Notion: the register row (Shared Artifacts table,
page 40ce32e8f8c881a7affdec5bb404510e) lists its "App code" pages, each holding a ```txt block of
base64 gzip JSON {app, version, html, files, caps}. A page can split the base64 over several
blocks (Notion's 200k limit), and the app can span several pages, in the order the row lists them.

Usage: python3 -I tools/hub_decode.py <saved notion-fetch result of each App code page, in order>...
Writes hub/index.html, hub/<files> (capabilities.json) and prints the version.
"""
import base64, gzip, json, os, re, sys

def blocks(path):
    raw = open(path).read()
    try:
        raw = json.loads(raw)['text']
    except (ValueError, KeyError, TypeError):
        pass
    return ''.join(m.group(1) for m in re.finditer(r'```txt\n(.*?)\n```', raw, re.S))

def main(paths):
    b64 = ''.join(blocks(p) for p in paths)
    d = json.loads(gzip.decompress(base64.b64decode(b64)))
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hub')
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, 'index.html'), 'w') as f:
        f.write(d['html'])
    for name, body in (d.get('files') or {}).items():
        p = os.path.join(root, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f:
            f.write(body if isinstance(body, str) else json.dumps(body, indent=2))
    print(d.get('app'), d.get('version'))

if __name__ == '__main__':
    main(sys.argv[1:])
