from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
SIM=ROOT/'sim'/'simulator.mjs'
HTML=ROOT/'drone_simulator.html'
OUT=Path('/tmp/arondight45-realtime-profile')
OUT.mkdir(parents=True,exist_ok=True)
original=SIM.read_text()
html=HTML.read_text()
marker='<script type="module" src="./sim/real_world_bootstrap.mjs"></script>'
assert marker in html


def one(text,old,new,label):
    n=text.count(old)
    assert n==1,f'{label}: expected exactly one match, got {n}'
    return text.replace(old,new,1)


def replace_render(text,body):
    start=text.index('function render(){')
    end=text.index('\n}\nrender();',start)+2
    return text[:start]+body+text[end:]


def source_for(name):
    s=original
    draw='if(!globalThis.__arondightRealWorld?.renderFrame?.(renderer,scene,camera))renderer.render(scene,camera);'
    audio='motorSound.syncFcState(fcState,arm);motorSound.update(physics,camera.position);'
    render_head='requestAnimationFrame(render);const renderNow=performance.now();physics.render();updateCamera();const fcState=latest.state;motorSound.syncFcState(fcState,arm);motorSound.update(physics,camera.position);const state=physics.state();'
    if name=='no-render':
        s=replace_render(s,'function render(){requestAnimationFrame(render);ui.simTime.textContent=simTime.toFixed(3)+" s";}')
    elif name=='no-draw':
        s=one(s,draw,'void 0;','Three draw')
    elif name=='no-hud':
        body='function render(){requestAnimationFrame(render);const renderNow=performance.now();physics.render();updateCamera();ui.simTime.textContent=simTime.toFixed(3)+" s";'+draw+'}'
        s=replace_render(s,body)
    elif name=='no-audio':
        s=one(s,audio,'','motor audio update')
    elif name=='shadows-off':
        s=one(s,'renderer.shadowMap.enabled=true;','renderer.shadowMap.enabled=false;','shadow map')
    elif name=='shadow10':
        s=one(s,'function render(){','let PROFILE_LAST_SHADOW=0;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;\nfunction render(){','shadow state')
        s=one(s,draw,'if(renderNow-PROFILE_LAST_SHADOW>=100){PROFILE_LAST_SHADOW=renderNow;renderer.shadowMap.needsUpdate=true;}'+draw,'shadow cadence')
    elif name=='optimized':
        s=one(s,'function render(){','let PROFILE_LAST_SHADOW=0,PROFILE_LAST_AUDIO=0,PROFILE_LAST_HUD=0;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;\nfunction render(){','presentation budget state')
        new_head='requestAnimationFrame(render);const renderNow=performance.now();physics.render();updateCamera();const fcState=latest.state;if(renderNow-PROFILE_LAST_AUDIO>=33){PROFILE_LAST_AUDIO=renderNow;'+audio+'}if(renderNow-PROFILE_LAST_HUD>=50){PROFILE_LAST_HUD=renderNow;const state=physics.state();'
        s=one(s,render_head,new_head,'render budget head')
        new_draw='}if(renderNow-PROFILE_LAST_SHADOW>=100){PROFILE_LAST_SHADOW=renderNow;renderer.shadowMap.needsUpdate=true;}'+draw
        s=one(s,draw,new_draw,'render budget tail')
    elif name in ('draw45','draw30'):
        interval='22' if name=='draw45' else '33'
        s=one(s,'function render(){','let PROFILE_LAST_DRAW=0;\nfunction render(){','draw budget state')
        s=one(s,draw,f'if(renderNow-PROFILE_LAST_DRAW>={interval}){{PROFILE_LAST_DRAW=renderNow;{draw}}}','draw budget')
    elif name=='no-physics':
        s=one(s,'physics.step(latest.motors,DT);simTime+=DT;','simTime+=DT;','physics step')
    elif name=='no-fc':
        old='''function controllerStepSync(){
  const {seq,packet}=prepareControllerStep();
  if((seq%20)===0){const started=performance.now(),out=backend.exchangeSync(packet);latestControllerRttMs=performance.now()-started;return out;}
  return backend.exchangeSync(packet);
}
'''
        new='''function controllerStepSync(){
  prepareControllerStep();
  return {sequence:sequence-1,motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};
}
'''
        s=one(s,old,new,'FC sync path')
    elif name=='no-imu':
        s=one(s,'let latestControllerRttMs=0;','let latestControllerRttMs=0;\nconst PROFILE_ZERO_IMU=new Uint8Array(14);','IMU profile constant')
        s=one(s,'physics.imuRaw(DT)','PROFILE_ZERO_IMU','IMU raw sample')
    elif name=='no-nav':
        s=one(s,'navigationFrame=navigationSensors.sampleFrame(physics,DT)','navigationFrame=null','NAV sample')
    elif name!='baseline':
        raise ValueError(name)
    return s

variants=['baseline','no-render','no-draw','no-hud','no-audio','shadows-off','shadow10','optimized','draw45','draw30','no-physics','no-fc','no-imu','no-nav']
try:
    for name in variants:
        SIM.write_text(source_for(name))
        bundle=OUT/f'{name}.mjs'
        subprocess.run([
            str(ROOT/'node_modules'/'.bin'/'esbuild'),'sim/real_world_bootstrap.mjs','--bundle','--format=esm','--platform=browser','--target=es2022','--minify',
            '--alias:box3d.js/dist/box3d.inline.mjs=box3d.js/inline',f'--outfile={bundle}'
        ],cwd=ROOT,check=True)
        code=bundle.read_text().replace('</script','<\\/script')
        (OUT/f'{name}.html').write_text(html.replace(marker,'<script type="module">\n'+code+'\n</script>'))
finally:
    SIM.write_text(original)

print('PROFILE_VARIANTS '+' '.join(variants))
