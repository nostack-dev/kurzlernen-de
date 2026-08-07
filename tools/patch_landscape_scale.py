from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()
replacements={
    'b3.b3CreateBoxShape(ground,groundShape,10,10,.05);':'b3.b3CreateBoxShape(ground,groundShape,60,60,.05);',
    'scene.fog=new THREE.Fog(0xd7e8f2,14,52);':'scene.fog=new THREE.Fog(0xd7e8f2,35,150);',
    'new THREE.PerspectiveCamera(52,1,.01,120)':'new THREE.PerspectiveCamera(52,1,.01,300)',
    'new THREE.GridHelper(20,40,0x6b7d89,0xa7b6bd)':'new THREE.GridHelper(120,60,0x6b7d89,0xa7b6bd)',
    'new THREE.BoxGeometry(20,20,.1)':'new THREE.BoxGeometry(120,120,.1)',
}
for old,new in replacements.items():
    count=s.count(old)
    if count!=1:
        raise SystemExit(f'expected exactly one occurrence of {old!r}, found {count}')
    s=s.replace(old,new)
p.write_text(s)
