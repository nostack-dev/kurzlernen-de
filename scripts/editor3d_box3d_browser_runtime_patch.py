#!/usr/bin/env python3
import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: editor3d_box3d_browser_runtime_patch.py <box3d.js checkout>')

root = Path(sys.argv[1])
build = root / 'scripts/build.mjs'
world = root / 'vendor/box3d/src/physics_world.c'

b = build.read_text(encoding='utf-8')
w = world.read_text(encoding='utf-8')


def regex_once(text, pattern, replacement, label, already=None):
    if already and already in text:
        return text
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f'missing patch anchor: {label}')
    return out


# b3InternalAssert is a public B3_API entry point, but Box3D only compiles its
# implementation in non-NDEBUG builds or when B3_ENABLE_ASSERT is explicitly
# enabled. Keep Release optimisation while retaining the official public symbol.
b = regex_once(
    b,
    r"buildBox3dLib\(\s*'build/box3d'\s*,\s*null\s*\)",
    "buildBox3dLib( 'build/box3d', '-DB3_ENABLE_ASSERT=1' )",
    'B3_ENABLE_ASSERT ST engine build',
    "buildBox3dLib( 'build/box3d', '-DB3_ENABLE_ASSERT=1' )",
)
b = regex_once(
    b,
    r"buildBox3dLib\(\s*'build/box3d-mt'\s*,\s*'-pthread -sSHARED_MEMORY'\s*\)",
    "buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY -DB3_ENABLE_ASSERT=1' )",
    'B3_ENABLE_ASSERT MT engine build',
    "buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY -DB3_ENABLE_ASSERT=1' )",
)

# The bindings compile against the same public-header configuration as libbox3d.
if "'-DB3_ENABLE_ASSERT=1'," not in b:
    b = regex_once(
        b,
        r"(?P<indent>\s*)'-std=c\+\+17',",
        lambda m: f"{m.group('indent')}'-std=c++17',\n{m.group('indent')}'-DB3_ENABLE_ASSERT=1',",
        'B3_ENABLE_ASSERT bindings',
    )

# The public C API contains file-based recording/height-field/debug helpers and
# callback-taking functions. A complete browser mirror therefore needs Emscripten
# MEMFS plus dynamic function-table support instead of the old FILESYSTEM=0 build.
if "'-sFORCE_FILESYSTEM=1'," not in b:
    b = regex_once(
        b,
        r"(?P<indent>\s*)'-sFILESYSTEM=0',",
        lambda m: (
            f"{m.group('indent')}'-sFORCE_FILESYSTEM=1',\n"
            f"{m.group('indent')}'-sALLOW_TABLE_GROWTH=1',\n"
            f"{m.group('indent')}'-sEXPORTED_RUNTIME_METHODS=[\\\"FS\\\",\\\"addFunction\\\",\\\"removeFunction\\\",\\\"UTF8ToString\\\",\\\"stringToUTF8\\\",\\\"lengthBytesUTF8\\\"]',"
        ),
        'browser filesystem/callback runtime',
    )

# Upstream main currently declares b3World_DumpShapeBounds as B3_API in
# box3d.h but has no implementation in the source tree. Keep the public API
# whole rather than silently dropping the symbol. This implementation follows
# the declaration literally: write each live shape AABB for the requested body
# type to box3d_bounds.txt. In the browser the file lives in MEMFS and is
# available through Module.FS.
if 'void b3World_DumpShapeBounds( b3WorldId worldId, b3BodyType type )' not in w:
    w += r'''

// Browser binding completeness adapter for an upstream public declaration that
// currently has no implementation at this Box3D main commit.
void b3World_DumpShapeBounds( b3WorldId worldId, b3BodyType type )
{
	b3World* world = b3GetUnlockedWorldFromId( worldId );
	if ( world == NULL )
	{
		return;
	}

	FILE* file = fopen( "box3d_bounds.txt", "w" );
	if ( file == NULL )
	{
		b3Log( "b3World_DumpShapeBounds: failed to open box3d_bounds.txt" );
		return;
	}

	fprintf( file, "# shapeId bodyId lowerX lowerY lowerZ upperX upperY upperZ\n" );
	for ( int i = 0; i < world->shapes.count; ++i )
	{
		const b3Shape* shape = world->shapes.data + i;
		if ( shape->id == B3_NULL_INDEX )
		{
			continue;
		}

		const b3Body* body = world->bodies.data + shape->bodyId;
		if ( body->type != type )
		{
			continue;
		}

		const b3AABB aabb = shape->aabb;
		fprintf( file, "%d %d %.9g %.9g %.9g %.9g %.9g %.9g\n",
			shape->id, shape->bodyId,
			aabb.lowerBound.x, aabb.lowerBound.y, aabb.lowerBound.z,
			aabb.upperBound.x, aabb.upperBound.y, aabb.upperBound.z );
	}

	fclose( file );
}
'''

build.write_text(b, encoding='utf-8')
world.write_text(w, encoding='utf-8')
print('patched Box3D browser runtime: assertions + MEMFS/callbacks + orphan public API implementation')
