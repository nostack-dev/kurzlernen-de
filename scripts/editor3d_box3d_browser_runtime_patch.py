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
if "'-sALLOW_TABLE_GROWTH=1'," not in b:
    if "'-sFORCE_FILESYSTEM=1'," in b:
        b = b.replace(
            "\t'-sFORCE_FILESYSTEM=1',",
            "\t'-sFORCE_FILESYSTEM=1',\n\t'-sALLOW_TABLE_GROWTH=1',\n\t'-sEXPORTED_RUNTIME_METHODS=[\\\"FS\\\",\\\"addFunction\\\",\\\"removeFunction\\\",\\\"UTF8ToString\\\",\\\"stringToUTF8\\\",\\\"lengthBytesUTF8\\\"]',",
            1,
        )
    else:
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

# box3d.js 0.1.1 deliberately pins Emscripten 6.0.2 and its validateESModule()
# rewrites Node require() calls to await import(). With filesystem support enabled,
# emcc adds a *synchronous* require("crypto") inside initRandomFill(). Blindly
# rewriting that nested require produces invalid JS: await inside a non-async arrow.
# Hoist only that Node crypto load to the surrounding async MODULARIZE factory;
# initRandomFill remains synchronous and browser execution stays unchanged.
crypto_fix_marker = '__box3dNodeCrypto'
if crypto_fix_marker not in b:
    anchor = "\t// require() -> await import\n\tsrc = src.replaceAll( /\\brequire\\(\\s*[\"']([^\"']+)[\"']\\s*\\)/g, '(await import(\"$1\"))' );"
    insert = """\t// Emscripten 6.0.2 + FORCE_FILESYSTEM emits require(\"crypto\") inside
\t// synchronous initRandomFill(). Hoist that one import to this async factory
\t// scope before the generic require -> await import rewrite below.
\tconst syncCryptoRequire = /var nodeCrypto=require\\(\\s*[\"'](?:node:)?crypto[\"']\\s*\\)/;
\tif ( syncCryptoRequire.test( src ) )
\t{
\t\tif ( !src.includes( 'var initRandomFill=' ) )
\t\t\tthrow new Error( `${file}: crypto require found but initRandomFill anchor changed` );
\t\tsrc = src.replace(
\t\t\t'var initRandomFill=',
\t\t\t'var __box3dNodeCrypto=ENVIRONMENT_IS_NODE?await import(\"node:crypto\"):null;var initRandomFill=',
\t\t);
\t\tsrc = src.replace( syncCryptoRequire, 'var nodeCrypto=__box3dNodeCrypto' );
\t}

\t// require() -> await import
\tsrc = src.replaceAll( /\\brequire\\(\\s*[\"']([^\"']+)[\"']\\s*\\)/g, '(await import(\"$1\"))' );"""
    if anchor not in b:
        raise SystemExit('missing patch anchor: validateESModule require rewrite')
    b = b.replace(anchor, insert, 1)

# The stock box3d.js validator assumes SINGLE_FILE means readAsync/readBinary must
# disappear. FORCE_FILESYSTEM invalidates that assumption: Emscripten 6 may retain
# browser-safe readers for MEMFS/runtime file APIs. Validate the actual dangerous
# Node capabilities instead (sync host filesystem and path/url modules).
for old_leftovers in (
    "for ( const leftover of [ 'readAsync', 'readBinary', 'readFileSync', 'node:fs', 'node:path', 'node:url' ] )",
    "for ( const leftover of [ 'readBinary', 'readFileSync', 'node:fs', 'node:path', 'node:url' ] )",
):
    if old_leftovers in b:
        b = b.replace(
            old_leftovers,
            "for ( const leftover of [ 'readFileSync', 'node:fs', 'node:path', 'node:url' ] )",
            1,
        )
        break
else:
    if "for ( const leftover of [ 'readFileSync', 'node:fs', 'node:path', 'node:url' ] )" not in b:
        raise SystemExit('missing patch anchor: inline browser safety leftovers')

build_path.write_text(b, encoding='utf-8')
core_path.write_text(core, encoding='utf-8')
print('patched Box3D browser runtime: public assert symbol + MEMFS/callback bridge + valid ESM crypto loader + capability-based inline validation')
