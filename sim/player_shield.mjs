import * as THREE from "three";

// The pilot spawns inside a protective shield bubble (the pilot only, not the
// drone) and is invulnerable to the nuke: blast, burn and radiation damage to
// the player are cancelled by nuke_destruction.mjs / nuke_hazard_fx.mjs while
// the shield is up. The bubble is drawn in the same neon line style and
// flares when a shock wave hits it.

export const PLAYER_SHIELD_VERSION="pilot-nuke-shield-v1";
const RADIUS_M=1.55;
let installed=false,group=null,lines=null,fill=null,flareUntil=-Infinity;

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;

export const playerShield={active:true,version:PLAYER_SHIELD_VERSION,nukeImmune(){return this.active;}};
globalThis.__arondightPlayerShield=playerShield;

function ensure(scene){
  if(group?.parent===scene)return group;
  const geometry=new THREE.IcosahedronGeometry(RADIUS_M,2);
  lines=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,1),new THREE.LineBasicMaterial({color:0x7fd4ff,transparent:true,opacity:.55,depthWrite:false,toneMapped:false}));
  fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x7fd4ff,transparent:true,opacity:.06,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
  group=new THREE.Group();group.name="PILOT_SHIELD";group.add(fill,lines);lines.raycast=()=>{};fill.raycast=()=>{};
  group.traverse(n=>{n.userData.neonSkip=true;n.userData.flightFireIgnore=true;n.userData.nukeWeaponPart=true;});
  scene.add(group);return group;
}
function pilotPosition(){
  const target=(globalThis.__arondightPlayerVitals?.damageTargets?.()||[]).find(t=>t.kind==="player");
  return target?.position||null;
}
function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    const g=ensure(scene),p=pilotPosition(),foot=walk()?.mode==="foot";
    // On foot the camera is inside the bubble; keep the protection, hide the shell.
    g.visible=Boolean(playerShield.active&&p&&!foot);
    if(g.visible){g.position.set(p.x,p.y,Math.max(RADIUS_M*.9,(p.z||0)-.2));g.rotation.z=now*.00025;
      const flare=Math.max(0,(flareUntil-now)/900),pulse=.5+.5*Math.sin(now*.003);
      lines.material.opacity=.38+.17*pulse+.45*flare;fill.material.opacity=.04+.03*pulse+.22*flare;g.scale.setScalar(1+.08*flare);}
  }
  requestAnimationFrame(frame);
}
export function installPlayerShield(){
  if(installed)return;installed=true;
  window.addEventListener("arondight:nuke-shockwave-arrival",()=>{flareUntil=performance.now()+900;});
  window.addEventListener("arondight:nuke-impact",()=>{flareUntil=performance.now()+600;});
  const v=viewport();if(v)v.dataset.playerShield=PLAYER_SHIELD_VERSION;requestAnimationFrame(frame);
}
installPlayerShield();
