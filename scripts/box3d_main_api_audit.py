#!/usr/bin/env python3
import re, sys
from pathlib import Path

if len(sys.argv) not in (2, 4):
    raise SystemExit('usage: box3d_main_api_audit.py <box3d.js checkout> [--manifest <path>]')
root=Path(sys.argv[1])
headers=list((root/'vendor/box3d/include/box3d').glob('*.h'))
source='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in headers)
bindings=(root/'src/bindings.cpp').read_text(encoding='utf-8')
facade_path=root/'src/facade.js'
facade=facade_path.read_text(encoding='utf-8') if facade_path.exists() else ''

# Canonical contract: every public Box3D C entry point must exist in the browser
# facade under the exact same b3* name. No Editor3D-only allowlist and no silent
# "not needed in JS" exceptions. Ergonomic aliases may be added in addition, never
# instead of the canonical API.
api=set(re.findall(r'B3_API\s+[\s\S]{0,240}?\b(b3[A-Za-z0-9_]+)\s*\(',source))
# bindings.cpp embeds canonical names in the embind signature strings. facade.js may
# add canonical JS implementations/aliases; count exact b3* function/property names.
bound=set(re.findall(r'"(b3[A-Za-z0-9_]+)\s*\(',bindings))
facade_names=set(re.findall(r'\b(?:function\s+|Module\.)(b3[A-Za-z0-9_]+)\b',facade))
represented=bound|facade_names
missing=sorted(api-represented)
extra=sorted(represented-api)

print(f'Official Box3D public B3_API functions: {len(api)}')
print(f'Canonical names represented by browser source: {len(represented & api)}')
print(f'Canonical public API coverage: {len(api)-len(missing)}/{len(api)}')
if extra:
    print('Browser-only helpers/extra names: '+str(len(extra)))
if len(sys.argv)==4:
    if sys.argv[2] != '--manifest':
        raise SystemExit('expected --manifest <path>')
    Path(sys.argv[3]).write_text('\n'.join(sorted(api))+'\n',encoding='utf-8')
    print('Wrote public API manifest:',sys.argv[3])
if missing:
    msg=' '.join(missing)
    print('MISSING_PUBLIC_API='+msg)
    print(f'::error title=Box3D browser facade incomplete::Missing {len(missing)} of {len(api)} public Box3D APIs: {msg}')
    raise SystemExit(2)
print('PASS: browser source represents every public Box3D B3_API entry point by canonical name')
