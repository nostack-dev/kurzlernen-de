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


def source_for(name):
    s=original
    if name=='no-render':
        old='''}
render();

function parseCsv'''
        new='''}
function profileRender(){requestAnimationFrame(profileRender);ui.simTime.textContent=simTime.toFixed(3)+" s";}
profileRender();

function parseCsv'''
        s=one(s,old,new,'render loop activation')
    elif name=='no-physics':
        needle='physics.step(latest.motors,DT);simTime+=DT;'
        s=one(s,needle,'simTime+=DT;','physics step')
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

variants=['baseline','no-render','no-physics','no-fc','no-imu','no-nav']
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
