let installed=false;
function mount(){const v=document.getElementById("viewport");if(!v||v.dataset.footTouchGuard==="1")return false;v.dataset.footTouchGuard="1";v.addEventListener("pointerdown",event=>{if(globalThis.__arondightOnFootMode!==true)return;const target=event.target instanceof Element?event.target:null;if(target?.closest("#soloTopbar,#soloLeft,#soloRight,#footFire,dialog,#worldLookHud"))return;if(event.pointerType==="mouse"&&document.pointerLockElement!==v)v.requestPointerLock?.();event.preventDefault();event.stopImmediatePropagation();},{capture:true,passive:false});return true;}
function tick(){mount();requestAnimationFrame(tick);}
export function installFootTouchGuard(){if(installed)return;installed=true;requestAnimationFrame(tick);}
installFootTouchGuard();
