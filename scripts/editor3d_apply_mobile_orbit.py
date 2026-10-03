#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

src_path=Path(sys.argv[1])
out_path=Path(sys.argv[2])
raw=src_path.read_text()
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m:
    raise SystemExit('missing Editor3D payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode()

# Earth gravity as the default for newly created scenes. Imported scenes keep their own value.
# Anchor to the single document-default declaration rather than runtime/world copies.
pat=re.compile(r"(const\s+defaults\s*=\s*\{\s*gravity\s*:\s*)\[[^\]]+\]")
matches=list(pat.finditer(source))
if len(matches)!=1:
    contexts=[source[max(0,m.start()-80):m.start()+160] for m in re.finditer(r'gravity',source,re.I)][:12]
    raise SystemExit(f'expected exactly one default world gravity, got {len(matches)}; gravity contexts={contexts!r}')
source=pat.sub(r"\1[0,0,-9.80665]",source,count=1)

marker='Editor3D mobile orbit toggle v1'
if marker not in source:
    addon=r'''<style id="editor3d-mobile-orbit-style">
@media (pointer:coarse),(max-width:899px){
  .e3d-mobile-orbit-toggle{position:absolute;right:12px;bottom:42px;z-index:50;display:flex;align-items:center;justify-content:center;gap:6px;min-width:74px;height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.38);border-radius:12px;background:rgba(25,29,36,.88);color:#fff;font:600 13px/1 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:manipulation;-webkit-user-select:none;user-select:none}
  .e3d-mobile-orbit-toggle[data-mode="orbit"]{background:rgba(42,92,145,.92);border-color:#9dc8f3}
  .e3d-mobile-orbit-toggle .ico{font-size:19px;line-height:1;pointer-events:none}
  .e3d-mobile-orbit-toggle .txt{pointer-events:none}
}
@media (pointer:fine) and (min-width:900px){.e3d-mobile-orbit-toggle{display:none!important}}
</style>
<script>
/* Editor3D mobile orbit toggle v1 */
(()=>{
  'use strict';
  const installed=new WeakSet();
  const isMobileSurface=()=>!!(matchMedia?.('(pointer:coarse)').matches||innerWidth<900);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function targetOf(v){return v.controls?.target||null}
  function renderNow(v){try{v.renderer?.render(v.scene3,v.camera)}catch(_){}}
  function orbit(v,dx,dy){
    const t=targetOf(v); if(!t||!v.camera)return;
    const ox=v.camera.position.x-t.x,oy=v.camera.position.y-t.y,oz=v.camera.position.z-t.z;
    const r=Math.max(.001,Math.hypot(ox,oy,oz));
    let yaw=Math.atan2(oy,ox),pitch=Math.atan2(oz,Math.hypot(ox,oy));
    yaw-=dx*.007; pitch=clamp(pitch+dy*.007,-1.48,1.48);
    const cp=Math.cos(pitch);
    v.camera.position.set(t.x+r*cp*Math.cos(yaw),t.y+r*cp*Math.sin(yaw),t.z+r*Math.sin(pitch));
    v.camera.lookAt(t); renderNow(v);
  }
  function zoom(v,factor){
    const t=targetOf(v); if(!t||!v.camera)return;
    const o=v.camera.position.clone().sub(t),r=Math.max(.001,o.length());
    const nr=clamp(r*factor,Math.max(.08,v.camera.near*2),Math.min(5000,v.camera.far*.45));
    o.multiplyScalar(nr/r);v.camera.position.copy(t).add(o);v.camera.lookAt(t);renderNow(v);
  }
  function pan(v,dx,dy){
    const t=targetOf(v); if(!t||!v.camera)return;
    v.camera.updateMatrix();
    const r=v.camera.position.distanceTo(t),h=Math.max(1,v.renderer?.domElement?.clientHeight||1);
    const scale=2*r*Math.tan((v.camera.fov||50)*Math.PI/360)/h;
    const right=v.camera.position.clone().set(0,0,0).setFromMatrixColumn(v.camera.matrix,0).normalize();
    const up=v.camera.position.clone().set(0,0,0).setFromMatrixColumn(v.camera.matrix,1).normalize();
    const d=right.multiplyScalar(-dx*scale).add(up.multiplyScalar(dy*scale));
    t.add(d);v.camera.position.add(d);v.camera.lookAt(t);renderNow(v);
  }
  function sync(v){
    const mobile=isMobileSurface(),btn=v.__mobileOrbitBtn;
    if(!btn)return;
    btn.hidden=!mobile;
    if(!mobile){if(v.controls)v.controls.enabled=true;return}
    if(v.mobileOrbitMode==null)v.mobileOrbitMode=true;
    if(v.controls)v.controls.enabled=false;
    const orbitOn=!!v.mobileOrbitMode;
    btn.dataset.mode=orbitOn?'orbit':'interact';
    btn.setAttribute('aria-pressed',orbitOn?'true':'false');
    const label=orbitOn?'Orbit':(v.type==='player'?'Grab':'Select');
    btn.querySelector('.ico').textContent=orbitOn?'⟳':'⌖';
    btn.querySelector('.txt').textContent=label;
    btn.title=orbitOn?'Orbit navigation active. Tap for selection/interact.':'Selection/interact active. Tap for orbit navigation.';
    btn.setAttribute('aria-label',btn.title);
  }
  function install(v){
    if(!v?.renderer?.domElement||!v.wrap||installed.has(v))return;
    installed.add(v);v.mobileOrbitMode=true;
    if(getComputedStyle(v.wrap).position==='static')v.wrap.style.position='relative';
    const btn=document.createElement('button');btn.type='button';btn.className='e3d-mobile-orbit-toggle';btn.innerHTML='<span class="ico">⟳</span><span class="txt">Orbit</span>';v.wrap.appendChild(btn);v.__mobileOrbitBtn=btn;
    const pointers=new Map();let lastPair=null;
    const canvas=v.renderer.domElement;
    const owned=()=>isMobileSurface()&&v.mobileOrbitMode===true;
    const pair=()=>{const a=[...pointers.values()].slice(0,2);if(a.length<2)return null;return{cx:(a[0].x+a[1].x)/2,cy:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)}};
    const resetPair=()=>{lastPair=pair()};
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();v.mobileOrbitMode=!v.mobileOrbitMode;pointers.clear();lastPair=null;sync(v)});
    canvas.addEventListener('pointerdown',e=>{if(!owned())return;e.preventDefault();e.stopImmediatePropagation();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});try{canvas.setPointerCapture(e.pointerId)}catch(_){}resetPair()},{capture:true,passive:false});
    canvas.addEventListener('pointermove',e=>{if(!owned()||!pointers.has(e.pointerId))return;e.preventDefault();e.stopImmediatePropagation();const p=pointers.get(e.pointerId),ox=p.x,oy=p.y;p.x=e.clientX;p.y=e.clientY;if(pointers.size===1){orbit(v,p.x-ox,p.y-oy);lastPair=null}else{const now=pair();if(now&&lastPair){pan(v,now.cx-lastPair.cx,now.cy-lastPair.cy);if(now.d>2&&lastPair.d>2)zoom(v,lastPair.d/now.d)}lastPair=now}},{capture:true,passive:false});
    const end=e=>{if(!owned()&&!pointers.has(e.pointerId))return;if(owned()){e.preventDefault();e.stopImmediatePropagation()}pointers.delete(e.pointerId);resetPair()};
    canvas.addEventListener('pointerup',end,{capture:true,passive:false});canvas.addEventListener('pointercancel',end,{capture:true,passive:false});
    for(const type of ['click','dblclick','contextmenu'])canvas.addEventListener(type,e=>{if(owned()){e.preventDefault();e.stopImmediatePropagation()}},{capture:true,passive:false});
    sync(v);
  }
  function syncAll(){const api=window.Editor3D;if(!api?.views)return false;for(const v of api.views){install(v);sync(v)}return true}
  const timer=setInterval(syncAll,250);window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});syncAll();
  window.Editor3DMobileOrbit={sync:syncAll,isMobileSurface,set(v,on){if(v){v.mobileOrbitMode=!!on;sync(v)}}};
})();
</script>'''
    if source.count('</body>')!=1:
        raise SystemExit('expected one </body>')
    source=source.replace('</body>',addon+'</body>',1)

assert '[0,0,-9.80665]' in source
assert marker in source
assert 'e3d-mobile-orbit-toggle' in source
payload=base64.b64encode(gzip.compress(source.encode(),compresslevel=9,mtime=0)).decode()
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed)
print('patched source bytes',len(source.encode()),'wrapper bytes',len(fixed.encode()))
