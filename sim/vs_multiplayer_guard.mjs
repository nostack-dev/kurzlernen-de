let installed=false;

function bridge(){return globalThis.__arondightRealWorld||null;}

function patchFinder(){
  const b=bridge(),finder=b?.vsSession;if(!finder?.options||finder.__vsMultiplayerLegacyGuard)return;
  finder.__vsMultiplayerLegacyGuard=true;
  const basePeer=finder.options.onPeer,baseLeave=finder.options.onLeave;
  finder.options.onPeer=(...args)=>{
    if(b.vsConnected&&finder.peerCount>0){const button=document.getElementById("lanVsButton");if(button)button.textContent=`MATES ${finder.peerCount} ✓`;return;}
    return basePeer?.(...args);
  };
  finder.options.onLeave=(...args)=>{
    if(finder.peerCount>0){b.vsConnected=true;const button=document.getElementById("lanVsButton");if(button)button.textContent=`MATES ${finder.peerCount} ✓`;return;}
    return baseLeave?.(...args);
  };
}

function patchLegacyPeerRenderer(){
  const b=bridge();if(!b||b.__vsV3PrimaryRenderGuard||typeof b.updateVsPeerRender!=="function")return;
  b.__vsV3PrimaryRenderGuard=true;
  const base=b.updateVsPeerRender.bind(b);
  b.updateVsPeerRender=(...args)=>{
    const view=document.getElementById("viewport"),v3OwnsPrimary=document.body.classList.contains("vs-multiplayer")&&Number(view?.dataset.vsPeerCount||0)>0&&Boolean(b.vsPeerMesh?.userData?.vsPlayerId);
    if(v3OwnsPrimary){if(view)view.dataset.vsPrimaryRenderOwner="multiplayer-v3";return;}
    if(view&&view.dataset.vsPrimaryRenderOwner==="multiplayer-v3")delete view.dataset.vsPrimaryRenderOwner;
    return base(...args);
  };
}

function frame(){patchFinder();patchLegacyPeerRenderer();requestAnimationFrame(frame);}

export function installVsMultiplayerGuard(){if(installed)return;installed=true;requestAnimationFrame(frame);}
