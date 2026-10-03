#!/usr/bin/env python3
import sys
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit('usage: editor3d_box3d_full_facade_patch.py <box3d.js checkout>')
root=Path(sys.argv[1])
build=root/'scripts/build.mjs'
facade=root/'src/facade.js'
b=build.read_text(encoding='utf-8')
f=facade.read_text(encoding='utf-8')

def swap(text,old,new,label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old,new,1)

# Discover the authoritative public C API directly from the exact Box3D headers being built.
anchor="const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );\nconst debug = process.argv.includes( '--debug' );"
insert="""const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const debug = process.argv.includes( '--debug' );

function collectPublicBox3DApi()
{
	const includeDir = join( root, 'vendor', 'box3d', 'include', 'box3d' );
	const names = new Set();
	for ( const file of readdirSync( includeDir ) )
	{
		if ( !file.endsWith( '.h' ) ) continue;
		const src = readFileSync( join( includeDir, file ), 'utf8' );
		for ( const m of src.matchAll( /B3_API\\s+[\\s\\S]{0,240}?\\b(b3[A-Za-z0-9_]+)\\s*\\(/g ) ) names.add( m[ 1 ] );
	}
	return [ ...names ].sort();
}
const publicBox3DApi = collectPublicBox3DApi();
if ( publicBox3DApi.length < 500 ) throw new Error( `unexpectedly small Box3D public API: ${publicBox3DApi.length}` );
const rawExports = [ '_malloc', '_free', ...publicBox3DApi.map( n => '_' + n ) ];
"""
b=swap(b,anchor,insert,'public API discovery')

# Full public API means conditional assert API is compiled even in optimized builds,
# and public save/load/dump APIs have a real Emscripten virtual filesystem.
b=swap(b,"const stLib = buildBox3dLib( 'build/box3d', null );\nconst mtLib = buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY' );","const stLib = buildBox3dLib( 'build/box3d', '-DB3_ENABLE_ASSERT' );\nconst mtLib = buildBox3dLib( 'build/box3d-mt', '-DB3_ENABLE_ASSERT -pthread -sSHARED_MEMORY' );",'assert-enabled Box3D libs')
b=swap(b,"\t'-sFILESYSTEM=0',","\t'-sFILESYSTEM=1',",'filesystem')

# Keep every official C entry point alive/exported from WASM, in addition to embind.
anchor="\t'-sENVIRONMENT=web,worker,node',\n\t// NDEBUG in release matches how libbox3d.a is built,"
insert="\t'-sENVIRONMENT=web,worker,node',\n\t'-sEXPORTED_FUNCTIONS=' + JSON.stringify( rawExports ),\n\t'-DB3_ENABLE_ASSERT',\n\t// NDEBUG in release matches how libbox3d.a is built,"
b=swap(b,anchor,insert,'EXPORTED_FUNCTIONS')

# Expose the same authoritative list to the generated facade template.
anchor="const facadeGen = facadeSrc\n\t.replaceAll( '__B3_LAYOUT__', JSON.stringify( layoutMeta ) )\n\t.replaceAll( '__B3_OUT_META__', JSON.stringify( outMeta ) );"
insert="""const facadeGen = facadeSrc
	.replaceAll( '__B3_LAYOUT__', JSON.stringify( layoutMeta ) )
	.replaceAll( '__B3_OUT_META__', JSON.stringify( outMeta ) )
	.replaceAll( '__B3_PUBLIC_API__', JSON.stringify( publicBox3DApi ) );"""
b=swap(b,anchor,insert,'facade public API codegen')

# Extend types with the complete raw mirror. Existing typed/ergonomic methods stay authoritative when present.
anchor="export interface Box3DFacade {\n  getNumShapeIds(buf: ShapeIdBuffer): number;"
insert="""export interface Box3DRawC {
  /** Exact low-level mirror of every public Box3D B3_API symbol. Pointer/struct/callback APIs use the native wasm ABI. */
  readonly [name: string]: (...args: any[]) => any;
}
export interface Box3DFullApi {
  /** Exact C ABI mirror, generated from the Box3D headers used for this build. */
  readonly raw: Box3DRawC;
  /** Sorted authoritative list of public B3_API symbols in this engine build. */
  readonly publicApi: readonly string[];
}
export interface Box3DFacade {
  getNumShapeIds(buf: ShapeIdBuffer): number;"""
b=swap(b,anchor,insert,'raw API types')

# Emscripten 6 adds `typeof RuntimeExports` to MainModule. Preserve whatever
# module basis the active compiler emitted instead of replacing one historical
# spelling. Patch only the old box3d.js exact-replacement stanza, then append the
# facade types to the discovered alias at build time.
old=r"""	.replaceAll( 'MainModule', 'Box3DModule' )
	.replace(
		'export type Box3DModule = WasmModule & EmbindModule;',
		`${facadeTypes}\nexport type Box3DModule = WasmModule & EmbindModule & Box3DFacade;`,
	);
if ( !tsd.includes( '& Box3DFacade' ) ) throw new Error( 'tsd: Box3DModule alias not found — did --emit-tsd output change?' );"""
new=r"""	.replaceAll( 'MainModule', 'Box3DModule' );
const box3dModuleAlias = /^export type Box3DModule = ([^;]+);$/m;
const box3dModuleMatch = tsd.match( box3dModuleAlias );
if ( !box3dModuleMatch ) throw new Error( 'tsd: Box3DModule alias not found — did --emit-tsd output change?' );
const box3dModuleBase = box3dModuleMatch[ 1 ].trim();
tsd = tsd.replace(
	box3dModuleAlias,
	`${facadeTypes}\nexport type Box3DModule = ${box3dModuleBase} & Box3DFacade & Box3DFullApi;`,
);
if ( !tsd.includes( '& Box3DFacade & Box3DFullApi' ) ) throw new Error( 'tsd: full Box3D facade alias injection failed' );"""
b=swap(b,old,new,'Emscripten 6 Box3DModule alias')

# Facade template gets the generated symbol list and exposes raw + top-level fallback.
anchor="const LAYOUT = __B3_LAYOUT__;"
insert="""const LAYOUT = __B3_LAYOUT__;
const PUBLIC_API = __B3_PUBLIC_API__;

// Exact low-level mirror of the public C API. Existing embind methods remain the
// ergonomic top-level implementation; any public symbol not wrapped by embind is
// attached as its native wasm ABI function so the browser surface is complete.
const raw = Object.create( null );
for ( const name of PUBLIC_API )
{
	const native = Module[ '_' + name ];
	if ( typeof native !== 'function' ) throw new Error( `Box3D public WASM export missing: ${name}` );
	raw[ name ] = native;
	if ( typeof Module[ name ] !== 'function' ) Module[ name ] = native;
}
Object.freeze( raw );
Object.defineProperty( Module, 'raw', { value: raw, enumerable: true } );
Object.defineProperty( Module, 'publicApi', { value: Object.freeze( PUBLIC_API.slice() ), enumerable: true } );"""
f=swap(f,anchor,insert,'full raw facade')

# Build script validates all template tokens before codegen.
anchor="if ( !facadeSrc.includes( '__B3_LAYOUT__' ) || !facadeSrc.includes( '__B3_OUT_META__' ) )\n\tthrow new Error( 'facade codegen: __B3_LAYOUT__/__B3_OUT_META__ token missing from src/facade.js' );"
insert="""if ( !facadeSrc.includes( '__B3_LAYOUT__' ) || !facadeSrc.includes( '__B3_OUT_META__' ) || !facadeSrc.includes( '__B3_PUBLIC_API__' ) )
	throw new Error( 'facade codegen: metadata token missing from src/facade.js' );"""
b=swap(b,anchor,insert,'facade token validation')

build.write_text(b,encoding='utf-8')
facade.write_text(f,encoding='utf-8')
print('patched build for complete generated Box3D B3_API browser mirror')
