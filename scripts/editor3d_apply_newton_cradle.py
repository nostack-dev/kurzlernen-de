#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

src_path=Path(sys.argv[1]); out_path=Path(sys.argv[2])
raw=src_path.read_text(encoding='utf-8')
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m:
    raise SystemExit('missing Editor3D payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode('utf-8')

def swap(old,new,label):
    global source
    if new in source:
        return
    if old not in source:
        raise SystemExit(f'missing {label}')
    source=source.replace(old,new,1)

# World settings available in box3d.js@0.1.1. Keep newer main-only solver knobs out of the runtime
# until the browser binding exposes them; the scene records requested values for forward compatibility.
swap(
"const defaults={gravity:[0,0,-9.80665],stepsPerSecond:60,subStepCount:4,allowSleep:true,continuousPhysics:true};",
"const defaults={gravity:[0,0,-9.80665],stepsPerSecond:60,subStepCount:4,allowSleep:true,continuousPhysics:true,restitutionThreshold:1,restitutionIterations:2,restitutionPropagation:false};",
'world defaults')

swap(
"if('enableContinuous'in wd)wd.enableContinuous=!!s.world.continuousPhysics;const world=b3.b3CreateWorld(wd)",
"if('enableContinuous'in wd)wd.enableContinuous=!!s.world.continuousPhysics;if('restitutionThreshold'in wd)wd.restitutionThreshold=Math.max(0,Number(s.world.restitutionThreshold??1));if('restitutionIterations'in wd)wd.restitutionIterations=Math.max(0,Math.min(63,Math.round(Number(s.world.restitutionIterations??2))));if('enableRestitutionPropagation'in wd)wd.enableRestitutionPropagation=!!s.world.restitutionPropagation;const world=b3.b3CreateWorld(wd)",
'world runtime settings')

swap(
"field('Continuous physics','continuousPhysics','checkbox')}",
"field('Continuous physics','continuousPhysics','checkbox');field('Restitution threshold (m/s)','restitutionThreshold','number',{min:0,step:.01});field('Restitution iterations','restitutionIterations','number',{min:0,max:63,step:1});field('Restitution propagation','restitutionPropagation','checkbox')}",
'world property fields')

swap(
"vertices:[],density:1,friction:.4,restitution:.1,sensor:false",
"vertices:[],density:1,friction:.4,restitution:.1,rollingResistance:0,sensor:false",
'fixture defaults')

swap(
"sd.baseMaterial.restitution=clamp(f.restitution||0,0,1);sd.isSensor=!!f.sensor",
"sd.baseMaterial.restitution=clamp(f.restitution||0,0,1);if('rollingResistance'in sd.baseMaterial)sd.baseMaterial.rollingResistance=Math.max(0,Number(f.rollingResistance||0));sd.isSensor=!!f.sensor",
'fixture rolling resistance runtime')

swap(
"field('Restitution','restitution','number',{min:0,max:1});field('Sensor','sensor','checkbox')",
"field('Restitution','restitution','number',{min:0,max:1});field('Rolling resistance','rollingResistance','number',{min:0,max:1,step:.001});field('Sensor','sensor','checkbox')",
'fixture property fields')

markers=[
    "}else if(kind==='cradle'){/* Editor3D Newton cradle example v1 */",
    "}else if(kind==='cradle'){/* Editor3D Newton cradle example v2 */",
    "}else if(kind==='cradle'){/* Editor3D Newton cradle example v3 MKS */",
    "}else if(kind==='cradle'){/* Editor3D Newton cradle example v4 equilibrium */",
]
start=-1
for marker in markers:
    start=source.find(marker)
    if start>=0: break
end=source.find("}else{const ramp=mk('ramp',0,[4,0,.6],'box',[5,4,.3]);",start)
if start<0 or end<0:
    raise SystemExit('missing Newton cradle branch')

cradle=r"""}else if(kind==='cradle'){/* Editor3D Newton cradle example v4 equilibrium */
s.world.gravity=[0,0,-9.80665];s.world.allowSleep=false;s.world.continuousPhysics=true;s.world.stepsPerSecond=120;s.world.subStepCount=12;s.world.restitutionThreshold=.01;s.world.restitutionIterations=12;s.world.restitutionPropagation=true;
const topZ=.34,drop=.20,radius=.025,spacing=2*radius,count=5,wire=.018,steelDensity=7850,steel='#66727d',base='#4e5964',ballColor='#d9a0aa';
const part=(name,p,size,color)=>{const b=mk(name,0,p,'box',size);b.fixtures[0].color=color;return b};
part('top beam',[0,0,topZ+.018],[.38,.055,.025],steel);part('left base rail',[0,-.085,.012],[.42,.025,.024],base);part('right base rail',[0,.085,.012],[.42,.025,.024],base);
for(const x of[-.19,.19]){part('frame post L '+x,[x,-.085,.17],[.018,.018,.32],steel);part('frame post R '+x,[x,.085,.17],[.018,.018,.32],steel);part('frame cross '+x,[x,0,.025],[.024,.19,.018],base);part('frame shoulder '+x,[x,0,topZ],[.018,.19,.018],steel)}
const wireLen=Math.sqrt(drop*drop+wire*wire);
for(let i=0;i<count;i++){
 const restX=(i-(count-1)/2)*spacing,x=restX,y=0,z=topZ-drop;
 const ball=mk('cradle ball '+(i+1),2,[x,y,z],'sphere',[radius]);const f=ball.fixtures[0];f.density=steelDensity;f.friction=.005;f.restitution=.995;f.rollingResistance=0;f.color=ballColor;ball.linearDamping=0;ball.angularDamping=0;ball.allowSleep=false;ball.awake=true;ball.bullet=false;
 for(const side of[-1,1]){const a=newBody(0,[restX,side*wire,topZ],'cradle anchor '+(i+1)+(side<0?' L':' R'));s.bodies.push(a);const j=jn('distance',a,ball,[restX,side*wire,topZ]);j.anchorA=V();j.anchorB=V();j.length=wireLen;j.enableLimit=false;j.enableSpring=false;j.frequency=0;j.dampingRatio=0}
}
s.cursor=[0,0,topZ-drop];report('Newton cradle · equilibrium start · 50 mm steel balls (~0.514 kg each) · restitution 0.995 · 120 Hz / 12 substeps · threshold 0.01 m/s. Run → Grab an end ball, pull it back and release.')"""
source=source[:start]+cradle+source[end:]

old="if(!loaded){addDocument(scene('Suspension test'));loadDemo('mechanism',true)}"
new="if(!loaded){addDocument(scene('Newton cradle'));loadDemo('cradle',true)}"
if old in source: source=source.replace(old,new,1)
elif new not in source: raise SystemExit('missing default scene bootstrap')

assert 'Editor3D Newton cradle example v4 equilibrium' in source
assert 'steelDensity=7850' in source
assert 'radius=.025' in source
assert 's.world.stepsPerSecond=120' in source
assert 's.world.subStepCount=12' in source
assert 's.world.restitutionThreshold=.01' in source
assert 'ball.bullet=false' in source
assert 'f.restitution=.995' in source
assert 'f.friction=.005' in source
assert 'x=restX,y=0,z=topZ-drop' in source
assert 'rollingResistance' in source
assert "if(!loaded){addDocument(scene('Newton cradle'));loadDemo('cradle',true)}" in source
payload=base64.b64encode(gzip.compress(source.encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed,encoding='utf-8')
print('patched equilibrium steel Newton cradle source bytes',len(source.encode('utf-8')),'wrapper bytes',len(fixed.encode('utf-8')))
