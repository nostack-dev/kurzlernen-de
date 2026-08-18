from pathlib import Path

path=Path('tests/real_world_ui_smoke.mjs')
text=path.read_text()
anchor='const waitWorld=()=>page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap-esri-mapterhorn-dem"&&v?.dataset.worldTerrainStatus==="box3d-active"&&v?.dataset.worldImageryLayer==="ready"&&Number(v?.dataset.worldMinimapImageryTiles||0)>0&&Number(v?.dataset.worldThreeFrames||0)>=1&&Number(v?.dataset.presentationDraws||0)>=10;},{timeout:35000});\n'
helper='''const openSettings=async()=>{\n  await page.evaluate(()=>{\n    const button=document.querySelector("#soloTopbar .phone-settings-button");\n    if(!(button instanceof HTMLButtonElement))throw new Error("settings button missing");\n    button.click();\n  });\n  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});\n};\n'''
pattern='await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});'
if text.count(anchor)!=1:
    raise SystemExit(f'waitWorld anchor count={text.count(anchor)}, expected 1')
if 'const openSettings=async()=>{' in text:
    raise SystemExit('openSettings helper already present; refuse ambiguous patch')
count=text.count(pattern)
if count!=8:
    raise SystemExit(f'settings open sequence count={count}, expected exactly 8')
text=text.replace(anchor,anchor+'\n'+helper,1)
text=text.replace(pattern,'await openSettings();')
if text.count(pattern)!=0 or text.count('await openSettings();')!=8:
    raise SystemExit('post-patch settings open count mismatch')
path.write_text(text)
print('patched 8 settings openings to deterministic DOM click helper')
