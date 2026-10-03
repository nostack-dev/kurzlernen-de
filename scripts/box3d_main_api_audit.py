#!/usr/bin/env python3
import re, sys
from pathlib import Path

args=sys.argv[1:]
if not args:
    raise SystemExit('usage: box3d_main_api_audit.py <box3d.js checkout> [--manifest <path>] [--report-only]')
root=Path(args[0]); args=args[1:]
report_only=False; manifest=None
i=0
while i<len(args):
    if args[i]=='--report-only': report_only=True; i+=1
    elif args[i]=='--manifest' and i+1<len(args): manifest=Path(args[i+1]); i+=2
    else: raise SystemExit('unknown arguments: '+' '.join(args[i:]))
headers=list((root/'vendor/box3d/include/box3d').glob('*.h'))
source='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in headers)
bindings=(root/'src/bindings.cpp').read_text(encoding='utf-8')
facade_path=root/'src/facade.js'
facade=facade_path.read_text(encoding='utf-8') if facade_path.exists() else ''

# This source audit reports which canonical b3* names have ergonomic/typed JS
# implementations before build. The hard completeness contract lives AFTER the
# build: every B3_API symbol must exist in publicApi, raw and at top level.
api=set(re.findall(r'B3_API\s+[\s\S]{0,240}?\b(b3[A-Za-z0-9_]+)\s*\(',source))
bound=set(re.findall(r'"(b3[A-Za-z0-9_]+)\s*\(',bindings))
facade_names=set(re.findall(r'\b(?:function\s+|Module\.)(b3[A-Za-z0-9_]+)\b',facade))
represented=bound|facade_names
missing=sorted(api-represented)
extra=sorted(represented-api)

print(f'Official Box3D public B3_API functions: {len(api)}')
print(f'Ergonomic/typed canonical names represented prebuild: {len(represented & api)}')
print(f'Prebuild ergonomic coverage: {len(api)-len(missing)}/{len(api)}')
if extra: print('Browser-only helpers/extra names: '+str(len(extra)))
if manifest:
    manifest.write_text('\n'.join(sorted(api))+'\n',encoding='utf-8')
    print('Wrote public API manifest:',manifest)
if missing:
    msg=' '.join(missing)
    print('RAW_MIRROR_WILL_COVER='+msg)
    if not report_only:
        print(f'::error title=Box3D browser facade incomplete::Missing {len(missing)} of {len(api)} public Box3D APIs before generated raw mirror: {msg}')
        raise SystemExit(2)
    print(f'INFO: {len(missing)} APIs rely on the generated exact raw C mirror; post-build N/N gate is authoritative')
print('PASS: prebuild API inventory completed')
