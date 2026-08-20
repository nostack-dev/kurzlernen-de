let installed=false,lastShots=0,flashTimer=0;
function viewport(){return document.getElementById("viewport");}
function ensure(){
  const view=viewport();if(!view||document.getElementById("footWeapon"))return;const wrap=document.createElement("div");wrap.id="footWeapon";wrap.setAttribute("aria-hidden","true");wrap.innerHTML='<i class="foot-weapon-slide"></i><i class="foot-weapon-frame"></i><i class="foot-weapon-grip"></i><i class="foot-weapon-sight"></i><i class="foot-weapon-flash"></i>';view.appendChild(wrap);
}
function frame(){
  ensure();const view=viewport(),shots=Number(view?.dataset.worldExperiencePistolShots||0),weapon=document.getElementById("footWeapon");if(shots>lastShots){lastShots=shots;if(weapon){weapon.classList.remove("recoil");void weapon.offsetWidth;weapon.classList.add("recoil");weapon.classList.add("flash");clearTimeout(flashTimer);flashTimer=setTimeout(()=>weapon.classList.remove("flash"),70);}}
  requestAnimationFrame(frame);
}
export function installFootWeaponOverlay(){
  if(installed)return;installed=true;const style=document.createElement("style");style.dataset.footWeaponOverlay="v1";style.textContent=`
  #footWeapon{display:none;position:absolute;z-index:8;right:max(8%,calc(var(--solo-safe-right,env(safe-area-inset-right)) + 24px));bottom:max(-10px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) - 12px));width:190px;height:150px;pointer-events:none;transform-origin:72% 92%;filter:drop-shadow(0 14px 10px #0008)}
  body.on-foot-mode #footWeapon{display:block}
  #footWeapon i{position:absolute;display:block;transform:skewX(-5deg);clip-path:polygon(6% 0,94% 0,100% 78%,85% 100%,12% 92%,0 20%)}
  .foot-weapon-slide{right:8px;bottom:70px;width:142px;height:35px;background:linear-gradient(180deg,#7f91a0 0 19%,#394a59 22% 72%,#1b2731 76%);border:1px solid #a9bac655}
  .foot-weapon-frame{right:30px;bottom:47px;width:108px;height:38px;background:linear-gradient(155deg,#283744,#111a22 66%);border:1px solid #62778655}
  .foot-weapon-grip{right:50px;bottom:-2px;width:47px;height:72px;background:repeating-linear-gradient(90deg,#111a22 0 5px,#1e2b35 5px 9px);transform:rotate(16deg) skewX(-4deg);clip-path:polygon(8% 0,92% 4%,78% 100%,10% 94%)}
  .foot-weapon-sight{right:40px;bottom:104px;width:12px;height:9px;background:#e2a83f!important;clip-path:polygon(15% 0,85% 0,100% 100%,0 100%)}
  .foot-weapon-flash{right:-19px;bottom:70px;width:48px;height:48px;opacity:0;background:radial-gradient(circle,#fff9c7 0 10%,#ffd460 12% 34%,#ff7e2b 36% 58%,transparent 61%);clip-path:polygon(50% 0,62% 34%,100% 18%,74% 50%,100% 78%,62% 67%,50% 100%,39% 66%,0 82%,26% 50%,0 20%,38% 34%)}
  #footWeapon.flash .foot-weapon-flash{opacity:1}
  #footWeapon.recoil{animation:footWeaponRecoil .16s cubic-bezier(.1,.8,.25,1)}
  @keyframes footWeaponRecoil{0%{transform:translate(0,0) rotate(0)}22%{transform:translate(11px,13px) rotate(4deg)}100%{transform:translate(0,0) rotate(0)}}
  @media(max-height:340px){#footWeapon{width:155px;height:120px;transform:scale(.86);transform-origin:100% 100%;right:5%;bottom:-12px}}
  `;document.head.appendChild(style);requestAnimationFrame(frame);
}
installFootWeaponOverlay();
