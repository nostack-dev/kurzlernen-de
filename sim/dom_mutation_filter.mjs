// Many modules watch the whole document for new dialogs / sections (childList + subtree). Every HUD
// number written with textContent swaps a Text node — a childList record too — so those observers
// ran (and re-scanned the DOM with querySelectorAll) several times per frame, most in the jet with
// its live readouts. They only care about ELEMENTS appearing or disappearing.
export function structuralMutation(list){for(const m of list||[]){if(m.type!=="childList")return true;for(const n of m.addedNodes)if(n.nodeType===1)return true;for(const n of m.removedNodes)if(n.nodeType===1)return true;}return false;}
// write text without replacing the Text node (a characterData change, invisible to childList observers)
export function setText(el,text){if(!el)return;const t=String(text);const f=el.firstChild;if(f&&f.nodeType===3&&!f.nextSibling){if(f.data!==t)f.data=t;}else if(el.textContent!==t)el.textContent=t;}
