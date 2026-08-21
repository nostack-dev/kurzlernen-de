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

function frame(){patchFinder();requestAnimationFrame(frame);}

export function installVsMultiplayerGuard(){if(installed)return;installed=true;requestAnimationFrame(frame);}
