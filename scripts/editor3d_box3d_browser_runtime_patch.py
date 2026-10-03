#!/usr/bin/env python3
import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: editor3d_box3d_browser_runtime_patch.py <box3d.js checkout>')

root = Path(sys.argv[1])
build_path = root / 'scripts/build.mjs'
core_path = root / 'vendor/box3d/src/core.c'
world_path = root / 'vendor/box3d/src/physics_world.c'

b = build_path.read_text(encoding='utf-8')
core = core_path.read_text(encoding='utf-8')
world = world_path.read_text(encoding='utf-8')


def regex_once(text, pattern, replacement, label, already=None):
    if already and already in text:
        return text
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f'missing patch anchor: {label}')
    return out


# b3InternalAssert is part of the public B3_API inventory but Box3D compiles its
# implementation out of Release unless B3_ENABLE_ASSERT is defined. Enable that
# source feature locally before any Box3D headers are parsed. This avoids
# coupling browser completeness to the shape of box3d.js build helper calls.
assert_define = '#ifndef B3_ENABLE_ASSERT\n#define B3_ENABLE_ASSERT 1\n#endif\n'
if assert_define not in core:
    core = assert_define + core

# The main compatibility patch must restore the one API that current upstream
# declares publicly but does not define. Fail closed if that invariant drifts.
if 'void b3World_DumpShapeBounds( b3WorldId worldId, b3BodyType type )' not in world:
    raise SystemExit('b3World_DumpShapeBounds implementation missing after main compatibility patch')

# The full-facade patch intentionally turns FILESYSTEM=0 into FILESYSTEM=1 first.
# Upgrade either state to the complete browser runtime needed by public file and
# callback APIs: MEMFS plus a growable function table and registration bridges.
if "'-sFORCE_FILESYSTEM=1'," not in b:
    b = regex_once(
        b,
        r"(?P<indent>\s*)'-sFILESYSTEM=(?:0|1)',",
        lambda m: (
            f"{m.group('indent')}'-sFORCE_FILESYSTEM=1',\n"
            f"{m.group('indent')}'-sALLOW_TABLE_GROWTH=1',\n"
            f"{m.group('indent')}'-sEXPORTED_RUNTIME_METHODS=[\\\"FS\\\",\\\"addFunction\\\",\\\"removeFunction\\\",\\\"UTF8ToString\\\",\\\"stringToUTF8\\\",\\\"lengthBytesUTF8\\\"]',"
        ),
        'browser filesystem/callback runtime',
    )

build_path.write_text(b, encoding='utf-8')
core_path.write_text(core, encoding='utf-8')
print('patched Box3D browser runtime: public assert symbol + MEMFS + callback bridge')
