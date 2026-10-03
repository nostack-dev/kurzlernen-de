#!/usr/bin/env python3
import re, sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: box3d_main_api_audit.py <box3d.js checkout>')
root=Path(sys.argv[1])
headers=list((root/'vendor/box3d/include/box3d').glob('*.h'))
source='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in headers)
bindings=(root/'src/bindings.cpp').read_text(encoding='utf-8')
# Public C entry points. Match across line breaks up to the function name.
api=set(re.findall(r'B3_API\s+[\s\S]{0,240}?\b(b3[A-Za-z0-9_]+)\s*\(',source))
bound=set(re.findall(r'"(b3[A-Za-z0-9_]+)\s*\(',bindings))
# Functions explicitly documented by box3d.js as intentionally JS-side math helpers.
intentional={
 'b3Cross','b3CrossSV','b3CrossVS','b3Dot','b3Length','b3LengthSquared','b3Normalize',
 'b3Add','b3Sub','b3Mul','b3Neg','b3Lerp','b3MulAdd','b3MulSub','b3Abs','b3Min','b3Max',
 'b3IsValidVec3','b3IsValidQuat','b3IsNormalized','b3IsNormalizedPlane','b3RotateVector',
 'b3InvRotateVector','b3TransformPoint','b3InvTransformPoint','b3MulTransforms','b3InvMulTransforms',
 'b3MakeQuatFromAxisAngle','b3IntegrateRotation','b3NLerp','b3ComputeAngularVelocity',
}
missing=sorted(api-bound-intentional)
print(f'Box3D public B3_API functions: {len(api)}')
print(f'Browser binding named functions: {len(bound)}')
print(f'Intentional JS-side math functions: {len(api & intentional)}')
if missing:
    msg=' '.join(missing)
    print('MISSING_PUBLIC_API='+msg)
    print(f'::error title=Box3D browser API coverage::Missing {len(missing)} public Box3D APIs: {msg}')
    raise SystemExit(2)
print('PASS: every non-math public Box3D B3_API entry point is represented in browser bindings')
