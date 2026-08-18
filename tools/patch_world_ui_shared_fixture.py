from pathlib import Path
import re

path=Path('tests/real_world_ui_smoke.mjs')
text=path.read_text()

import_anchor='import puppeteer from "puppeteer-core";\n'
shared_import='import {installDeterministicWorldFixture} from "./world_browser_fixture.mjs";\n'
if text.count(import_anchor)!=1: raise SystemExit(f'puppeteer import count={text.count(import_anchor)}, expected 1')
if shared_import in text: raise SystemExit('shared WORLD fixture import already present; refuse ambiguous patch')
text=text.replace(import_anchor,import_anchor+shared_import,1)

fixture_pattern=re.compile(r'''const OPENFREEMAP_STYLE="https://tiles\.openfreemap\.org/styles/liberty";\nconst VECTOR_HOST="tiles\.openfreemap\.org";\nconst DEM_HOST="tiles\.mapterhorn\.com";\nconst WORLD_IMAGERY_PREFIX="https://services\.arcgisonline\.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";\nconst fixtureTile=.*?\n\}\);\n\nconst waitWorld=''',re.S)
fixture_replacement='''const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";\nconst VECTOR_HOST="tiles.openfreemap.org";\nconst DEM_HOST="tiles.mapterhorn.com";\nconst WORLD_IMAGERY_PREFIX="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";\nconst providerRequests=[];\nconst imageryRequests=[];\nconst external=[];\nconst failedRequests=[];\nconst consoleErrors=[];\nconst allowedWorldProviderUrl=url=>{try{const parsed=new URL(url);return url.startsWith(WORLD_IMAGERY_PREFIX)||parsed.hostname===VECTOR_HOST||parsed.hostname===DEM_HOST;}catch{return false;}};\npage.on("request",request=>{\n  const url=request.url();let parsed;try{parsed=new URL(url);}catch{return;}\n  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname))return;\n  external.push(url);\n  if(url.startsWith(OPENFREEMAP_STYLE))providerRequests.push(url);\n  if(url.startsWith(WORLD_IMAGERY_PREFIX))imageryRequests.push(url);\n});\npage.on("requestfailed",request=>failedRequests.push(`${request.failure()?.errorText||"FAILED"} ${request.url()}`));\npage.on("pageerror",error=>consoleErrors.push(`PAGEERROR ${error.message}`));\npage.on("console",message=>{if(message.type()==="error"||message.type()==="warning")consoleErrors.push(`${message.type().toUpperCase()} ${message.text()}`);});\nawait installDeterministicWorldFixture(page,{base,styleName:"Arondight45 deterministic WORLD fixture",latitude:39.569600,longitude:2.650200});\n\nconst waitWorld='''
text,replacements=fixture_pattern.subn(fixture_replacement,text,count=1)
if replacements!=1: raise SystemExit(f'legacy WORLD fixture block replacement count={replacements}, expected 1')

old_wait='const waitWorld=()=>page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap-esri-mapterhorn-dem"&&v?.dataset.worldTerrainStatus==="box3d-active"&&v?.dataset.worldImageryLayer==="ready"&&Number(v?.dataset.worldThreeFrames||0)>=1&&Number(v?.dataset.presentationDraws||0)>=10;},{timeout:35000});'
new_wait='''const waitWorld=async()=>{\n  try{\n    await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap-esri-mapterhorn-dem"&&v?.dataset.worldTerrainStatus==="box3d-active"&&v?.dataset.worldImageryLayer==="ready"&&Boolean(b?.active)&&!b?.loading&&Boolean(b?.map)&&Boolean(b?.threeRenderer)&&Number(v?.dataset.worldThreeFrames||0)>=1&&Number(v?.dataset.presentationDraws||0)>=10;},{timeout:35000});\n  }catch(error){\n    const diagnostics=await page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{status:document.querySelector("#status")?.textContent||"",realWorldStatus:document.querySelector("#realWorldStatus")?.textContent||"",worldMode:v?.dataset.worldMode||"",provider:v?.dataset.worldProvider||"",terrain:v?.dataset.worldTerrainStatus||"",terrainTriangles:v?.dataset.worldTerrainTriangles||"",imagery:v?.dataset.worldImageryLayer||"",active:Boolean(b?.active),loading:Boolean(b?.loading),map:Boolean(b?.map),renderer:Boolean(b?.threeRenderer),buildingSource:b?.buildingSourceId||"",worldFrames:v?.dataset.worldThreeFrames||"",presentationDraws:v?.dataset.presentationDraws||"",autoWorldLocationSource:v?.dataset.autoWorldLocationSource||""};});\n    throw new Error(`WORLD UI readiness failed: ${JSON.stringify({diagnostics,failedRequests:failedRequests.slice(-20),consoleErrors:consoleErrors.slice(-20),external:external.slice(-20)})}`,{cause:error});\n  }\n};'''
if text.count(old_wait)!=1: raise SystemExit(f'waitWorld anchor count={text.count(old_wait)}, expected 1')
text=text.replace(old_wait,new_wait,1)

for forbidden in ['const fixtureTile=Buffer.from(','const demTile=Buffer.from(','await page.setRequestInterception(true);','request.respond({status:200,contentType:"image/png"']:
    if forbidden in text: raise SystemExit(f'legacy fixture marker remains: {forbidden}')
if text.count('installDeterministicWorldFixture(page')!=1: raise SystemExit('shared fixture invocation count mismatch')
path.write_text(text)
print('patched real_world_ui_smoke to shared deterministic WORLD fixture with failure diagnostics')
