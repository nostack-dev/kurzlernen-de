#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

src_path=Path(sys.argv[1]); out_path=Path(sys.argv[2])
raw=src_path.read_text(encoding='utf-8')
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m:
    raise SystemExit('missing Editor3D payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode('utf-8')

# Upgrade the already-shipped v1 example in place. Keep a single canonical editor3d.html.
start=source.find("}else if(kind==='cradle'){/* Editor3D Newton cradle example v1 */")
end=source.find("}else{const ramp=mk('ramp',0,[4,0,.6],'box',[5,4,.3]);", start)
if start < 0:
    start=source.find("}else if(kind==='cradle'){/* Editor3D Newton cradle example v2 */")
    end=source.find("}else{const ramp=mk('ramp',0,[4,0,.6],'box',[5,4,.3]);", start)
if start < 0 or end < 0:
    raise SystemExit('missing Newton cradle branch')

# Do not include the closing brace here: source[end:] begins with that brace before the following else.
cradle=r"""}else if(kind==='cradle'){/* Editor3D Newton cradle example v2 */
s.world.gravity=[0,0,-9.80665];s.world.allowSleep=false;s.world.continuousPhysics=true;
const topZ=6.4,drop=3.65,radius=.5,spacing=1.0,count=5,wire=.32,pull=1.45,steel='#66727d',base='#4e5964',ballColor='#d9a0aa';
const part=(name,p,size,color)=>{const b=mk(name,0,p,'box',size);b.fixtures[0].color=color;return b};
part('top beam',[0,0,topZ+.28],[6.7,.34,.28],steel);
part('left base rail',[0,-1.55,.16],[7,.3,.32],base);part('right base rail',[0,1.55,.16],[7,.3,.32],base);
for(const x of[-3.2,3.2]){part('frame post L '+x,[x,-1.55,3.25],[.28,.28,6.2],steel);part('frame post R '+x,[x,1.55,3.25],[.28,.28,6.2],steel);part('frame cross '+x,[x,0,.2],[.32,3.4,.32],base);part('frame shoulder '+x,[x,0,topZ-.02],[.28,3.4,.24],steel)}
const wireLen=Math.sqrt(drop*drop+wire*wire),pulledZ=topZ-Math.sqrt(Math.max(.05,drop*drop-pull*pull));
for(let i=0;i<count;i++){
 const restX=(i-(count-1)/2)*spacing,x=restX+(i===0?-pull:0),y=0,z=i===0?pulledZ:topZ-drop;
 const ball=mk('cradle ball '+(i+1),2,[x,y,z],'sphere',[radius]);const f=ball.fixtures[0];f.density=1;f.friction=0;f.restitution=1;f.color=ballColor;ball.linearDamping=0;ball.angularDamping=0;ball.allowSleep=false;ball.awake=true;ball.bullet=true;
 for(const side of[-1,1]){const a=newBody(0,[restX,side*wire,topZ],'cradle anchor '+(i+1)+(side<0?' L':' R'));s.bodies.push(a);const j=jn('distance',a,ball,[restX,side*wire,topZ]);j.anchorA=V();j.anchorB=V();j.length=wireLen;j.enableLimit=false;j.enableSpring=false;j.frequency=0;j.dampingRatio=0}
}
s.cursor=[0,0,topZ-drop];report('Newton cradle loaded · balls are aligned and swing along X; Run → Grab to pull an end ball and release it.')"""
source=source[:start]+cradle+source[end:]

# Fresh workspaces open the Newton cradle by default. Existing saved workspaces are preserved.
old="if(!loaded){addDocument(scene('Suspension test'));loadDemo('mechanism',true)}"
new="if(!loaded){addDocument(scene('Newton cradle'));loadDemo('cradle',true)}"
if old in source:
    source=source.replace(old,new,1)
elif new not in source:
    raise SystemExit('missing default scene bootstrap')

assert 'Editor3D Newton cradle example v2' in source
assert "loadDemo('cradle')" in source
assert "if(!loaded){addDocument(scene('Newton cradle'));loadDemo('cradle',true)}" in source
assert 'j.enableLimit=false' in source
assert 'restX=(i-(count-1)/2)*spacing' in source
assert "ball=mk('cradle ball '+(i+1),2,[x,y,z]" in source
payload=base64.b64encode(gzip.compress(source.encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed,encoding='utf-8')
print('patched realistic Newton cradle source bytes',len(source.encode('utf-8')),'wrapper bytes',len(fixed.encode('utf-8')))
