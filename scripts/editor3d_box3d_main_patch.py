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

# World definition fields added on Box3D main after v0.1.0.
replace_once(
    '.field( "restitutionThreshold", &b3WorldDef::restitutionThreshold )\n\t\t.field( "hitEventThreshold", &b3WorldDef::hitEventThreshold )',
    '.field( "restitutionThreshold", &b3WorldDef::restitutionThreshold )\n\t\t.field( "restitutionIterations", &b3WorldDef::restitutionIterations )\n\t\t.field( "enableRestitutionPropagation", &b3WorldDef::enableRestitutionPropagation )\n\t\t.field( "hitEventThreshold", &b3WorldDef::hitEventThreshold )',
    'b3WorldDef restitution fields')

# Runtime world controls added on current Box3D main.
replace_once(
    'function( "b3World_SetRestitutionThreshold(worldId, value)", &b3World_SetRestitutionThreshold );\n\tfunction( "b3World_GetRestitutionThreshold(worldId)", &b3World_GetRestitutionThreshold );',
    'function( "b3World_SetRestitutionThreshold(worldId, value)", &b3World_SetRestitutionThreshold );\n\tfunction( "b3World_GetRestitutionThreshold(worldId)", &b3World_GetRestitutionThreshold );\n\tfunction( "b3World_SetRestitutionIterations(worldId, iterations)", &b3World_SetRestitutionIterations );\n\tfunction( "b3World_GetRestitutionIterations(worldId)", &b3World_GetRestitutionIterations );\n\tfunction( "b3World_EnableRestitutionPropagation(worldId, flag)", &b3World_EnableRestitutionPropagation );\n\tfunction( "b3World_IsRestitutionPropagationEnabled(worldId)", &b3World_IsRestitutionPropagationEnabled );',
    'world restitution runtime API')

p.write_text(s,encoding='utf-8')
print('patched current Box3D world APIs into browser bindings')
