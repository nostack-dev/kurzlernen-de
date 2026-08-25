let installed=false,lastGun=null,patched=0,postFrameQueued=false;
function viewport(){return document.getElementById("viewport");}
function patchMaterial(material){if(!material)return;const list=Array.isArray(material)?material:[material];for(const mat of list){if(!mat)continue;mat.depthTest=true;mat.depthWrite=false;mat.needsUpdate=true;}}
function patchWeaponDepth(){const scene=globalThis.__arondightRealWorld?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(!gun)return false;const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");if(!flash)return false;if(gun!==lastGun||!flash.userData?.finalDepthPatched){lastGun=gun;flash.userData.finalDepthPatched=true;flash.renderOrder=9996;flash.traverse?.(node=>{if(!node?.isMesh)return;node.renderOrder=9996;patchMaterial(node.material);});patched++;}const view=viewport();if(view)view.dataset.walkMuzzleDepthPatches=String(patched);return true;}
function settleFrameContract(){postFrameQueued=false;patchWeaponDepth();}
function frame(){patchWeaponDepth();if(!postFrameQueued){postFrameQueued=true;setTimeout(settleFrameContract,0);}requestAnimationFrame(frame);}
export function installGameplayFinalRealismPatch(){if(installed)return;installed=true;const view=viewport();if(view)view.dataset.gameplayFinalRealism="muzzle-material-only-v5";requestAnimationFrame(frame);}
installGameplayFinalRealismPatch();
