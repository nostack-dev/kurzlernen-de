let installed=false,lastGun=null,patched=0,postFrameQueued=false,contractObserver=null;
const FINAL_MUZZLE_DEPTH="depth-tested-behind-viewmodel-v2";
function viewport(){return document.getElementById("viewport");}
function patchMaterial(material){if(!material)return;const list=Array.isArray(material)?material:[material];for(const mat of list){if(!mat)continue;mat.depthTest=true;mat.depthWrite=false;mat.needsUpdate=true;}}
function enforceFrameContract(){const view=viewport();if(!view||!lastGun)return false;if(view.dataset.walkMuzzleDepth!==FINAL_MUZZLE_DEPTH)view.dataset.walkMuzzleDepth=FINAL_MUZZLE_DEPTH;view.dataset.walkMuzzleDepthPatches=String(patched);view.dataset.walkFireButton="screen-touch-only-hidden-v1";return true;}
function patchWeaponDepth(){const scene=globalThis.__arondightRealWorld?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(!gun)return false;const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");if(!flash)return false;if(gun!==lastGun||!flash.userData?.finalDepthPatched){lastGun=gun;flash.userData.finalDepthPatched=true;flash.renderOrder=9996;flash.traverse?.(node=>{if(!node?.isMesh)return;node.renderOrder=9996;patchMaterial(node.material);});patched++;}return enforceFrameContract();}
function installContractObserver(){if(contractObserver)return;const view=viewport();if(!view)return;contractObserver=new MutationObserver(records=>{for(const record of records){if(record.type==="attributes"&&record.attributeName==="data-walk-muzzle-depth"&&lastGun&&view.dataset.walkMuzzleDepth!==FINAL_MUZZLE_DEPTH){view.dataset.walkMuzzleDepth=FINAL_MUZZLE_DEPTH;break;}}});contractObserver.observe(view,{attributes:true,attributeFilter:["data-walk-muzzle-depth"]});}
function installStyle(){if(document.querySelector("style[data-gameplay-final-realism]"))return;const style=document.createElement("style");style.dataset.gameplayFinalRealism="v5";style.textContent=`
body.on-foot-mode #footFire{display:none!important;visibility:hidden!important;pointer-events:none!important}
`;document.head.appendChild(style);}
function settleFrameContract(){postFrameQueued=false;patchWeaponDepth();}
function frame(){installContractObserver();patchWeaponDepth();if(!postFrameQueued){postFrameQueued=true;setTimeout(settleFrameContract,0);}requestAnimationFrame(frame);}
export function installGameplayFinalRealismPatch(){if(installed)return;installed=true;installStyle();installContractObserver();const view=viewport();if(view){view.dataset.gameplayFinalRealism="muzzle-depth+screen-touch-fire-v5";view.dataset.walkFireButton="screen-touch-only-hidden-v1";}requestAnimationFrame(frame);}
installGameplayFinalRealismPatch();
