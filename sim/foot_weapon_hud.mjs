let installed=false,lastShots=0,flashTimer=0;
function viewport(){return document.getElementById("viewport");}
function ensure(){const hud=document.getElementById("footHud");if(!hud||document.getElementById("footWeapon"))return;const weapon=document.createElement("div");weapon.id="footWeapon";weapon.setAttribute("aria-hidden","true");weapon.innerHTML='<i class="foot-gun-slide"></i><i class="foot-gun-frame"></i><i class="foot-gun-grip"></i><i class="foot-gun-sight"></i><i class="foot-gun-flash"></i>';hud.appendChild(weapon);}
function frame(){ensure();const v=viewport(),shots=Number(v?.dataset.worldExperiencePistolShots)||0,weapon=document.getElementById("footWeapon");if(shots!==lastShots){lastShots=shots;if(weapon){weapon.classList.remove("kick");void weapon.offsetWidth;weapon.classList.add("kick");const flash=weapon.querySelector(".foot-gun-flash");flash?.classList.add("active");clearTimeout(flashTimer);flashTimer=setTimeout(()=>flash?.classList.remove("active"),65);}}requestAnimationFrame(frame);}
export function installFootWeaponHud(){if(installed)return;installed=true;const style=document.createElement("style");style.dataset.footWeaponHud="v1";style.textContent=`
#footWeapon{display:none;position:absolute;z-index:2;right:max(12%,calc(var(--solo-safe-right,env(safe-area-inset-right)) + 76px));bottom:-7px;width:190px;height:150px;transform-origin:70% 100%;pointer-events:none;filter:drop-shadow(0 12px 12px #0007)}
body.on-foot-mode #footWeapon{display:block}#footWeapon i{position:absolute;display:block;box-sizing:border-box}
.foot-gun-slide{right:18px;top:15px;width:116px;height:38px;border-radius:7px 4px 4px 8px;background:linear-gradient(180deg,#8492a1 0 18%,#465361 20% 75%,#232d37 77%);border:1px solid #aab5c044;transform:skewX(-4deg)}
.foot-gun-frame{right:30px;top:48px;width:91px;height:42px;border-radius:4px 8px 10px 5px;background:linear-gradient(135deg,#283540,#101820);border:1px solid #71808b33}
.foot-gun-grip{right:41px;top:75px;width:42px;height:78px;border-radius:5px 8px 12px 13px;background:repeating-linear-gradient(155deg,#18232c 0 6px,#24323d 6px 10px);transform:skewX(-12deg);border:1px solid #66727d3d}
.foot-gun-sight{right:34px;top:8px;width:15px;height:10px;border-radius:2px;background:#d9a83b;box-shadow:0 0 9px #ffca55aa}
.foot-gun-flash{right:-8px;top:20px;width:42px;height:42px;opacity:0;background:radial-gradient(circle,#fff9ce 0 15%,#ffd45b 17% 35%,#ff7d21 38% 58%,transparent 62%);clip-path:polygon(50% 0,62% 34%,100% 20%,72% 50%,100% 80%,62% 66%,50% 100%,38% 66%,0 80%,28% 50%,0 20%,38% 34%);transform:rotate(22deg) scale(.35)}
.foot-gun-flash.active{opacity:1;transform:rotate(22deg) scale(1);transition:transform 35ms ease-out,opacity 65ms linear}#footWeapon.kick{animation:footGunKick 120ms cubic-bezier(.2,.8,.3,1)}@keyframes footGunKick{0%{transform:translate(0,0) rotate(0)}30%{transform:translate(-5px,8px) rotate(-4deg)}100%{transform:translate(0,0) rotate(0)}}
@media(max-height:340px){#footWeapon{width:154px;height:122px;transform:scale(.82);transform-origin:100% 100%;right:12%;bottom:-5px}}
`;document.head.appendChild(style);requestAnimationFrame(frame);}
installFootWeaponHud();
