#!/usr/bin/env python3
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: editor3d_box3d_browser_runtime_patch.py <box3d.js checkout>')

root = Path(sys.argv[1])
build = root / 'scripts/build.mjs'
world = root / 'vendor/box3d/src/physics_world.c'

b = build.read_text(encoding='utf-8')
w = world.read_text(encoding='utf-8')


def swap(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)


# b3InternalAssert is a public B3_API entry point, but Box3D only compiles its
# implementation in non-NDEBUG builds or when B3_ENABLE_ASSERT is explicitly
# enabled. Keep Release optimisation while retaining the official public symbol.
b = swap(
    b,
    "const stLib = buildBox3dLib( 'build/box3d', null );\nconst mtLib = buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY' );",
    "const stLib = buildBox3dLib( 'build/box3d', '-DB3_ENABLE_ASSERT=1' );\nconst mtLib = buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY -DB3_ENABLE_ASSERT=1' );",
    'B3_ENABLE_ASSERT engine builds',
)

# The bindings compile against the same public-header configuration as libbox3d.
b = swap(
    b,
    "\t'-std=c++17',\n\t'-lembind',",
    "\t'-std=c++17',\n\t'-DB3_ENABLE_ASSERT=1',\n\t'-lembind',",
    'B3_ENABLE_ASSERT bindings',
)

# The public C API contains file-based recording/height-field/debug helpers and
# callback-taking functions. A complete browser mirror therefore needs Emscripten
# MEMFS plus dynamic function-table support instead of the old FILESYSTEM=0 build.
b = swap(
    b,
    "\t'-sFILESYSTEM=0',\n\t'-sENVIRONMENT=web,worker,node',",
    "\t'-sFORCE_FILESYSTEM=1',\n\t'-sALLOW_TABLE_GROWTH=1',\n\t'-sEXPORTED_RUNTIME_METHODS=[\"FS\",\"addFunction\",\"removeFunction\",\"UTF8ToString\",\"stringToUTF8\",\"lengthBytesUTF8\"]',\n\t'-sENVIRONMENT=web,worker,node',",
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
