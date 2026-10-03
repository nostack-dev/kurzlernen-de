#!/usr/bin/env python3
import sys
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit('usage: editor3d_box3d_main_patch.py <box3d.js checkout>')
root=Path(sys.argv[1])
p=root/'src/bindings.cpp'
s=p.read_text(encoding='utf-8')

def replace_once(old,new,label):
    global s
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'missing patch anchor: {label}')
    s=s.replace(old,new,1)

def remove_once(old,label):
    global s
    if old not in s:
        return
    s=s.replace(old,'',1)

# World definition fields added on current Box3D main.
replace_once(
    '.field( "restitutionThreshold", &b3WorldDef::restitutionThreshold )\n\t\t.field( "hitEventThreshold", &b3WorldDef::hitEventThreshold )',
    '.field( "restitutionThreshold", &b3WorldDef::restitutionThreshold )\n\t\t.field( "restitutionIterations", &b3WorldDef::restitutionIterations )\n\t\t.field( "enableRestitutionPropagation", &b3WorldDef::enableRestitutionPropagation )\n\t\t.field( "hitEventThreshold", &b3WorldDef::hitEventThreshold )',
    'b3WorldDef restitution fields')

# Runtime world controls added on current Box3D main.
replace_once(
    'function( "b3World_SetRestitutionThreshold(worldId, value)", &b3World_SetRestitutionThreshold );\n\tfunction( "b3World_GetRestitutionThreshold(worldId)", &b3World_GetRestitutionThreshold );',
    'function( "b3World_SetRestitutionThreshold(worldId, value)", &b3World_SetRestitutionThreshold );\n\tfunction( "b3World_GetRestitutionThreshold(worldId)", &b3World_GetRestitutionThreshold );\n\tfunction( "b3World_SetRestitutionIterations(worldId, iterations)", &b3World_SetRestitutionIterations );\n\tfunction( "b3World_GetRestitutionIterations(worldId)", &b3World_GetRestitutionIterations );\n\tfunction( "b3World_EnableRestitutionPropagation(worldId, flag)", &b3World_EnableRestitutionPropagation );\n\tfunction( "b3World_IsRestitutionPropagationEnabled(worldId)", &b3World_IsRestitutionPropagationEnabled );',
    'world restitution runtime API')

# APIs removed/renamed since box3d.js v0.1.1. Keep the typed layer compiling
# against the exact current Box3D headers; the generated full facade separately
# exports every current B3_API symbol at raw[name] and top-level b3[name].
remove_once('\tfunction( "b3World_RebuildStaticTree(worldId)", &b3World_RebuildStaticTree );\n','removed b3World_RebuildStaticTree')

replace_once(
    '\tfunction( "b3CreateCompoundShape(bodyId, shapeDef, compound)",\n\t\t+[]( b3BodyId bodyId, b3ShapeDef def, b3CompoundData* compound ) { return b3CreateCompoundShape( bodyId, &def, compound ); },\n\t\tallow_raw_pointers() );',
    '\tfunction( "b3CreateBakedCompoundShape(bodyId, shapeDef, compound)",\n\t\t+[]( b3BodyId bodyId, b3ShapeDef def, b3CompoundData* compound ) { return b3CreateBakedCompoundShape( bodyId, &def, compound ); },\n\t\tallow_raw_pointers() );',
    'baked compound shape rename')

replace_once(
    '\tfunction( "b3CollideCapsuleAndTriangle(capsuleA, v1, v2, v3)", +[]( b3Capsule a, b3Vec3 v1, b3Vec3 v2, b3Vec3 v3 ) -> val\n\t{\n\t\tb3Vec3 tri[3] = { v1, v2, v3 }; b3SimplexCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideCapsuleAndTriangle( &m, 4, &a, tri, &cache );\n\t\treturn localManifoldToVal( m );\n\t} );',
    '\tfunction( "b3CollideTriangleAndCapsule(v1, v2, v3, capsuleB)", +[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, b3Capsule b ) -> val\n\t{\n\t\tb3Vec3 tri[3] = { v1, v2, v3 }; b3SimplexCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideTriangleAndCapsule( &m, 4, tri, &b, &cache );\n\t\treturn localManifoldToVal( m );\n\t} );',
    'triangle capsule collision rename')

replace_once(
    '\tfunction( "b3CollideHullAndTriangle(hullA, v1, v2, v3, triangleFlags)", +[]( b3HullData* a, b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, int triangleFlags ) -> val\n\t{\n\t\tb3SATCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideHullAndTriangle( &m, 4, a, v1, v2, v3, triangleFlags, &cache );\n\t\treturn localManifoldToVal( m );\n\t}, allow_raw_pointers() );',
    '\tfunction( "b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hullB, enableSpeculative)", +[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, int triangleFlags, b3HullData* b, bool enableSpeculative ) -> val\n\t{\n\t\tb3SATCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideTriangleAndHull( &m, 4, v1, v2, v3, triangleFlags, b, &cache, enableSpeculative );\n\t\treturn localManifoldToVal( m );\n\t}, allow_raw_pointers() );',
    'triangle hull collision rename')

replace_once(
    '\tfunction( "b3CollideSphereAndTriangle(sphereA, v1, v2, v3)", +[]( b3Sphere a, b3Vec3 v1, b3Vec3 v2, b3Vec3 v3 ) -> val\n\t{\n\t\tb3Vec3 tri[3] = { v1, v2, v3 }; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideSphereAndTriangle( &m, 4, &a, tri );\n\t\treturn localManifoldToVal( m );\n\t} );',
    '\tfunction( "b3CollideTriangleAndSphere(v1, v2, v3, sphereB)", +[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, b3Sphere b ) -> val\n\t{\n\t\tb3Vec3 tri[3] = { v1, v2, v3 }; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;\n\t\tb3CollideTriangleAndSphere( &m, 4, tri, &b );\n\t\treturn localManifoldToVal( m );\n\t} );',
    'triangle sphere collision rename')

remove_once('\t\t.field( "applyRestitution", &b3Profile::applyRestitution )\n','removed b3Profile applyRestitution field')

replace_once(
    'out_function( "b3Body_GetLocalCenterOfMass(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetLocalCenterOfMass( bodyId ) ); } );',
    'out_function( "b3Body_GetLocalCenter(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetLocalCenter( bodyId ) ); } );',
    'local center rename')
replace_once(
    'out_function( "b3Body_GetWorldCenterOfMass(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetWorldCenterOfMass( bodyId ) ); } );',
    'out_function( "b3Body_GetWorldCenter(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetWorldCenter( bodyId ) ); } );',
    'world center rename')

# Recording player lifecycle was renamed on Box3D main. Preserve the convenient
# CreateFromRecording helper while routing it through the current canonical API.
replace_once(
    'return reinterpret_cast<uintptr_t>( b3RecPlayer_Create( b3Recording_GetData( r ), b3Recording_GetSize( r ), workerCount ) );',
    'return reinterpret_cast<uintptr_t>( b3CreatePlayer( b3Recording_GetData( r ), b3Recording_GetSize( r ), workerCount ) );',
    'recording player create rename')
replace_once(
    'function( "b3RecPlayer_Destroy(player)", +[]( uintptr_t p ) { b3RecPlayer_Destroy( reinterpret_cast<b3RecPlayer*>( p ) ); } );',
    'function( "b3RecPlayer_Destroy(player)", +[]( uintptr_t p ) { b3DestroyPlayer( reinterpret_cast<b3RecPlayer*>( p ) ); } );',
    'recording player destroy rename')

p.write_text(s,encoding='utf-8')
print('patched box3d.js typed bindings for current Box3D main compatibility')
