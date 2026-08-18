from pathlib import Path

path=Path('tests/real_world_ui_smoke_impl.mjs')
text=path.read_text()

import_anchor='import puppeteer from "puppeteer-core";\n'
shared_import='import {installDeterministicWorldFixture} from "./world_browser_fixture.mjs";\n'
if text.count(import_anchor)!=1:
    raise SystemExit(f'puppeteer import count={text.count(import_anchor)}, expected 1')
if shared_import in text:
    print('shared fixture import already present')
else:
    text=text.replace(import_anchor,import_anchor+shared_import,1)

start_marker='const fixtureTile=Buffer.from('
end_marker='});\n\nconst waitWorld='
start=text.find(start_marker)
end=text.find(end_marker,start)
if start<0 or end<0:
    if 'installDeterministicWorldFixture(page' in text and start<0:
        print('split WORLD UI gate already uses shared fixture')
        path.write_text(text)
        raise SystemExit(0)
    raise SystemExit(f'legacy fixture block anchors missing: start={start} end={end}')
end+=len('});\n')
replacement='''const providerRequests=[];\nconst imageryRequests=[];\nconst external=[];\nconst allowedWorldProviderUrl=url=>{try{const parsed=new URL(url);return url.startsWith(WORLD_IMAGERY_PREFIX)||parsed.hostname===VECTOR_HOST||parsed.hostname===DEM_HOST;}catch{return false;}};\npage.on("request",request=>{\n  const url=request.url();let parsed;try{parsed=new URL(url);}catch{return;}\n  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname))return;\n  external.push(url);\n  if(url.startsWith(OPENFREEMAP_STYLE))providerRequests.push(url);\n  if(url.startsWith(WORLD_IMAGERY_PREFIX))imageryRequests.push(url);\n});\nawait installDeterministicWorldFixture(page,{base,styleName:"Arondight45 deterministic WORLD fixture",latitude:39.569600,longitude:2.650200});\n'''
text=text[:start]+replacement+text[end:]
for forbidden in ['const fixtureTile=Buffer.from(','const vectorTile=Buffer.from(','const demTile=Buffer.from(','await page.setRequestInterception(true);','request.respond({status:200,contentType:"application/x-protobuf"']:
    if forbidden in text:
        raise SystemExit(f'legacy fixture marker remains: {forbidden}')
if text.count('installDeterministicWorldFixture(page')!=1:
    raise SystemExit('shared fixture invocation count mismatch')
path.write_text(text)
print('patched split real_world_ui_smoke_impl to shared deterministic WORLD fixture')
