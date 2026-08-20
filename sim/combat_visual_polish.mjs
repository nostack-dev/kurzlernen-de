const MATERIAL_REFRESH_MS=100;
let installed=false,lastMaterialRefresh=-Infinity,raf=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}

function cleanPeerMaterials(now=performance.now()){
  if(now-lastMaterialRefresh<MATERIAL_REFRESH_MS)return;lastMaterialRefresh=now;
  const peer=bridge()?.vsPeerMesh;if(!peer)return;
  const color=Number(peer.userData?.vsPlayerColor)||0xff6845;
  for(const child of [...peer.children])if(child?.userData?.vsReadableGlow)child.removeFromParent();
  peer.traverse?.(node=>{
    if(!node?.isMesh||!node.userData?.vsReadableVisual)return;
    const material=node.material;
    if(material?.color?.setHex)material.color.setHex(color);
    if(material?.emissive?.setHex){material.emissive.setHex(color);material.emissiveIntensity=.28;}
    if(material){material.roughness=.44;material.metalness=.18;}
  });
  const view=viewport();if(view)view.dataset.vsPeerVisualStyle="clean-player-color";
}

function frame(now){cleanPeerMaterials(now);raf=requestAnimationFrame(frame);}

export function installCombatVisualPolish(){
  if(installed)return;installed=true;
  const style=document.createElement("style");style.dataset.combatVisualPolish="v1";style.textContent=`
#vsEnemyMarker{width:84px!important;height:68px!important;filter:drop-shadow(0 1px 1px #0009)!important}
#vsEnemyMarker .vs-enemy-reticle{left:50%!important;top:34px!important;width:28px!important;height:28px!important;transform:translate(-50%,-50%) rotate(45deg)!important;border:.75px solid #ff765fcc!important;border-radius:1px!important;box-shadow:0 0 3px #ff3b2238!important;background:transparent!important}
#vsEnemyMarker .vs-enemy-reticle:before,#vsEnemyMarker .vs-enemy-reticle:after{display:none!important;content:none!important}
#vsEnemyMarker strong{top:0!important}
#vsEnemyMarker small{left:-10px!important;right:-10px!important;top:55px!important}
#vsEnemyMarker .vs-enemy-hp{left:28px!important;right:28px!important;top:64px!important;height:1px!important}
#vsEnemyMarker.offscreen{width:76px!important;height:40px!important}
#vsEnemyMarker.offscreen .vs-enemy-reticle,#vsEnemyMarker.offscreen .vs-enemy-hp{display:none!important}
#vsEnemyMarker.offscreen strong{top:22px!important}
#vsEnemyMarker.offscreen small{top:31px!important}
@media(max-height:340px){#vsEnemyMarker{width:76px!important;height:62px!important}#vsEnemyMarker .vs-enemy-reticle{width:25px!important;height:25px!important;top:31px!important}#vsEnemyMarker small{top:50px!important}#vsEnemyMarker .vs-enemy-hp{top:58px!important}}
`;
  document.head.appendChild(style);const view=viewport();if(view)view.dataset.vsEnemyIndicatorStyle="thin-diamond";raf=requestAnimationFrame(frame);
}

installCombatVisualPolish();
