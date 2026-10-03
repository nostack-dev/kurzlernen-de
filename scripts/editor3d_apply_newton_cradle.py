#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

src_path=Path(sys.argv[1]); out_path=Path(sys.argv[2])
raw=src_path.read_text(encoding='utf-8')
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m:
    raise SystemExit('missing Editor3D payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode('utf-8')
marker='Editor3D Newton cradle example v1'

if marker not in source:
    old="{label:'Suspension & vehicle',run:()=>loadDemo('mechanism')},{label:'3D hulls & stacking'"
    new="{label:'Suspension & vehicle',run:()=>loadDemo('mechanism')},{label:'Newton cradle / pendulum',run:()=>loadDemo('cradle')},{label:'3D hulls & stacking'"
    if source.count(old)!=1: raise SystemExit(f'expected one Examples insertion point, got {source.count(old)}')
    source=source.replace(old,new,1)

    old="kind==='joints'?'Joint laboratory':'Suspension test'"
    new="kind==='joints'?'Joint laboratory':kind==='cradle'?'Newton cradle':'Suspension test'"
    if source.count(old)!=1: raise SystemExit(f'expected one loadDemo title expression, got {source.count(old)}')
    source=source.replace(old,new,1)

    old="button('□','Fit scene (Home)',()=>fitView());button('▶','Open player (Ctrl+R)',openPlayer)"
    new="button('□','Fit scene (Home)',()=>fitView());button('◉','Newton cradle example',()=>loadDemo('cradle'));button('▶','Open player (Ctrl+R)',openPlayer)"
    if source.count(old)!=1: raise SystemExit(f'expected one toolbar insertion point, got {source.count(old)}')
    source=source.replace(old,new,1)

    needle="}else{const ramp=mk('ramp',0,[4,0,.6],'box',[5,4,.3]);"
    if source.count(needle)!=1: raise SystemExit(f'expected one mechanism branch insertion point, got {source.count(needle)}')
    cradle=r"""}else if(kind==='cradle'){/* Editor3D Newton cradle example v1 */
s.world.gravity=[0,0,-9.80665];s.world.allowSleep=false;s.world.continuousPhysics=true;
const topZ=6.4,drop=3.65,radius=.5,spacing=1.005,count=5,wire=.28,pull=1.45,steel='#66727d',base='#4e5964',ballColor='#d9a0aa';
const part=(name,p,size,color)=>{const b=mk(name,0,p,'box',size);b.fixtures[0].color=color;return b};
part('top beam',[0,0,topZ+.28],[.34,6.8,.28],steel);
part('left base rail',[-1.55,0,.16],[.3,7,.32],base);part('right base rail',[1.55,0,.16],[.3,7,.32],base);
for(const y of[-3.2,3.2]){part('frame post L '+y,[-1.55,y,3.25],[.28,.28,6.2],steel);part('frame post R '+y,[1.55,y,3.25],[.28,.28,6.2],steel);part('frame cross '+y,[0,y,.2],[3.4,.32,.32],base);part('frame shoulder '+y,[0,y,topZ-.02],[3.4,.28,.24],steel)}
const wireLen=Math.sqrt(drop*drop+wire*wire),pulledZ=topZ-Math.sqrt(Math.max(.05,drop*drop-pull*pull));
for(let i=0;i<count;i++){
 const y=(i-(count-1)/2)*spacing,x=i===0?-pull:0,z=i===0?pulledZ:topZ-drop;
 const ball=mk('cradle ball '+(i+1),2,[x,y,z],'sphere',[radius]);const f=ball.fixtures[0];f.density=1;f.friction=0;f.restitution=1;f.color=ballColor;ball.linearDamping=0;ball.angularDamping=0;ball.allowSleep=false;ball.awake=true;ball.bullet=true;
 for(const side of[-1,1]){const a=newBody(0,[0,y+side*wire,topZ],'cradle anchor '+(i+1)+(side<0?' L':' R'));s.bodies.push(a);const j=jn('distance',a,ball,[0,y+side*wire,topZ]);j.anchorA=V();j.anchorB=V();j.length=wireLen;j.enableLimit=true;j.lowerLimit=wireLen;j.upperLimit=wireLen;j.frequency=0;j.dampingRatio=0}
}
s.cursor=[0,0,topZ-drop];report('Newton cradle loaded · Run → on mobile switch Orbit to Grab, pull a ball and release it.')}else{const ramp=mk('ramp',0,[4,0,.6],'box',[5,4,.3]);"""
    source=source.replace(needle,cradle,1)

    old="<p><b>Run</b> opens an independent Box3D player. Left-drag dynamic bodies with a real Box3D MotorJoint.</p>"
    new="<p><b>Run</b> opens an independent Box3D player. Left-drag dynamic bodies with a real Box3D MotorJoint. The <b>◉</b> toolbar button loads the Newton cradle; on mobile switch Orbit to Grab to pull a ball back and release it.</p>"
    if source.count(old)==1: source=source.replace(old,new,1)

assert marker in source
assert "loadDemo('cradle')" in source
assert "f.restitution=1" in source
assert "wireLen=Math.sqrt" in source
assert "button('◉','Newton cradle example'" in source
payload=base64.b64encode(gzip.compress(source.encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed,encoding='utf-8')
print('patched Newton cradle source bytes',len(source.encode('utf-8')),'wrapper bytes',len(fixed.encode('utf-8')))
