#!/usr/bin/env python3
import re, sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: box3d_main_api_audit.py <box3d.js checkout>')
root=Path(sys.argv[1])
headers=list((root/'vendor/box3d/include/box3d').glob('*.h'))
source='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in headers)
bindings=(root/'src/bindings.cpp').read_text(encoding='utf-8')
api=set(re.findall(r'B3_API\s+[\s\S]{0,240}?\b(b3[A-Za-z0-9_]+)\s*\(',source))
bound=set(re.findall(r'"(b3[A-Za-z0-9_]+)\s*\(',bindings))
intentional={
 'b3Cross','b3CrossSV','b3CrossVS','b3Dot','b3Length','b3LengthSquared','b3Normalize',
 'b3Add','b3Sub','b3Mul','b3Neg','b3Lerp','b3MulAdd','b3MulSub','b3Abs','b3Min','b3Max',
 'b3IsValidVec3','b3IsValidQuat','b3IsNormalized','b3IsNormalizedPlane','b3RotateVector',
 'b3InvRotateVector','b3TransformPoint','b3InvTransformPoint','b3MulTransforms','b3InvMulTransforms',
 'b3MakeQuatFromAxisAngle','b3IntegrateRotation','b3NLerp','b3ComputeAngularVelocity',
}
missing_all=sorted(api-bound-intentional)
required={
 'b3DefaultWorldDef','b3CreateWorld','b3DestroyWorld','b3World_Step','b3World_SetGravity',
 'b3World_EnableContinuous','b3World_SetRestitutionThreshold','b3World_GetRestitutionThreshold',
 'b3World_SetRestitutionIterations','b3World_GetRestitutionIterations',
 'b3World_EnableRestitutionPropagation','b3World_IsRestitutionPropagationEnabled',
 'b3DefaultBodyDef','b3CreateBody','b3DestroyBody','b3Body_GetPosition','b3Body_GetRotation',
 'b3Body_SetTransform','b3Body_GetMass','b3Body_SetAwake','b3Body_SetBullet',
 'b3DefaultShapeDef','b3CreateBoxShape','b3CreateSphereShape','b3CreateCapsuleShape','b3CreateHullShape',
 'b3CreateHull','b3DestroyHull','b3DefaultDistanceJointDef','b3CreateDistanceJoint',
 'b3DefaultMotorJointDef','b3CreateMotorJoint','b3DestroyJoint',
}
missing_required=sorted(required-bound)
print(f'Official Box3D public B3_API functions: {len(api)}')
print(f'Browser facade currently names: {len(bound)}')
print(f'Non-editor public APIs not exposed by the upstream JS facade: {len(missing_all)}')
if missing_all:
    print('UNEXPOSED_PUBLIC_API='+' '.join(missing_all))
if missing_required:
    msg=' '.join(missing_required)
    print(f'::error title=Editor3D Box3D API coverage::Missing required current APIs: {msg}')
    raise SystemExit(2)
print('PASS: every Editor3D-required current Box3D API is represented in browser bindings')
