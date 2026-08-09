from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
SIM=ROOT/'sim'/'simulator.mjs'
HTML=ROOT/'drone_simulator.html'
OUT=Path('/tmp/arondight45-presentation-quality')
OUT.mkdir(parents=True,exist_ok=True)
original=SIM.read_text()
html=HTML.read_text()
marker='<script type="module" src="./sim/real_world_bootstrap.mjs"></script>'
assert marker in html


def one(text,old,new,label):
    n=text.count(old)
    assert n==1,f'{label}: expected one occurrence, got {n}'
    return text.replace(old,new,1)


def source_for(name):
    s=original
    if name in ('no-shadows','no-shadows-res75','no-shadows-res60','lean75','lean60'):
        s=one(s,'renderer.shadowMap.enabled=true;','renderer.shadowMap.enabled=false;','shadow disable')
    if name in ('res75','no-shadows-res75','lean75'):
        s=one(s,'renderer.setPixelRatio(Math.min(devicePixelRatio,2))','renderer.setPixelRatio(Math.min(devicePixelRatio,.75))','0.75 render scale')
    if name in ('res60','no-shadows-res60','lean60'):
        s=one(s,'renderer.setPixelRatio(Math.min(devicePixelRatio,2))','renderer.setPixelRatio(Math.min(devicePixelRatio,.60))','0.60 render scale')
    if name in ('no-aa','lean75','lean60'):
        s=one(s,'new THREE.WebGLRenderer({antialias:true,alpha:true})','new THREE.WebGLRenderer({antialias:false,alpha:true})','antialias disable')
    if name in ('lean75','lean60'):
        s=one(s,'renderer.toneMapping=THREE.ACESFilmicToneMapping;','renderer.toneMapping=THREE.NoToneMapping;','tone mapping')
    if name not in ('baseline','no-shadows','res75','res60','no-shadows-res75','no-shadows-res60','no-aa','lean75','lean60'):
        raise ValueError(name)
    return s

variants=['baseline','no-shadows','res75','res60','no-shadows-res75','no-shadows-res60','no-aa','lean75','lean60']
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

print('PRESENTATION_PROFILE_VARIANTS '+' '.join(variants))
