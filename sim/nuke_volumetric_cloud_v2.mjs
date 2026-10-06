import * as THREE from "three";
import {FX,sphereGeometry,fxMaterial,smokeMaterial,disposeEffect,setData} from "./nuke_fx_shared.mjs";

const clouds=[];
let installed=false;
const CINEMATIC_RENDER_ORDER=840;
const NUKE_SCALE=3;

function viewport(){return document.getElementById("viewport");}
function scene(){return globalThis.__arondightRealWorld?.threeScene||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.userData.nukeVolumetricPart=true;node.renderOrder=CINEMATIC_RENDER_ORDER;return node;}
// Depth-tested so buildings in front correctly hide the cloud instead of the
// cloud bleeding through them. Smoke is Lambert-lit by the scene's existing
// lights; heat is additive and unlit. No lights are ever added.
function puff(group,{role,r,x,y,z,color,scale=[1,1,1]}){const mesh=tag(new THREE.Mesh(sphereGeometry(r,16,11),smokeMaterial(color,{depthTest:true})),role);mesh.position.set(x,y,z);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function hotPuff(group,{role,r,x,y,z,color,scale=[1,1,1]}){const mesh=tag(new THREE.Mesh(sphereGeometry(r,14,9),fxMaterial(color,{opacity:0,additive:true,depthTest:true,side:THREE.BackSide})),role);mesh.position.set(x,y,z);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function seededNoise(i,salt=0){const x=Math.sin((i+1)*12.9898+salt*78.233)*43758.5453;return x-Math.floor(x);}

// ~70 large puffs instead of ~190 small ones: the silhouette reads the same,
// but transparent overdraw (the dominant cost on phones) drops by ~3x.
function spawn(position){
  const world=scene();if(!world)return;
  const group=tag(new THREE.Group(),"volumetric-world-root");
  group.position.copy(position);
  world.add(group);
  const smoke=[],hot=[];
  // Turbulent stem with a narrow neck.
  for(let i=0;i<12;i++){
    const t=i/11,z=4+t*80,neck=.6+Math.abs(t-.5)*.8,radius=(10+t*5)*neck,angle=i*1.77,offset=(1.8+t*4.4)*(.55+seededNoise(i,1));
    smoke.push(puff(group,{role:`plume-volumetric-${i}`,r:radius,x:Math.cos(angle)*offset,y:Math.sin(angle)*offset,z,color:i<4?FX.smokeLight:i<9?FX.smoke:FX.smokeLight,scale:[1.3,1.22,1.6]}));
  }
  // Incandescent core inside the stem.
  for(let i=0;i<6;i++){const a=i*1.31,rad=.8+(i%3)*.65;hot.push(hotPuff(group,{role:`hot-plume-visible-${i}`,r:4.4+i*.25,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z:6+i*7.2,color:i<2?FX.core:i<4?FX.yellow:FX.orange,scale:[1.35,1.25,1.7]}));}
  // Rolling collar where the stem opens into the cap.
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,rad=18+(i%3)*3.6;smoke.push(puff(group,{role:`crown-collar-${i}`,r:12.5+(i%4)*1.3,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z:67+(i%3)*3.4,color:i%2?FX.smokeLight:FX.smoke,scale:[1.9,1.82,1.2]}));}
  // Readable lower cap with a glowing underside.
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2,rad=23+(i%3)*4.6;smoke.push(puff(group,{role:`crown-visible-${i}`,r:15.5+(i%3)*2,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z:35+(i%4)*2.6,color:i%2?FX.smokeLight:FX.smoke,scale:[1.95,1.85,1.12]}));}
  smoke.push(puff(group,{role:"crown-visible-core",r:22,x:0,y:0,z:43,color:FX.smoke,scale:[2.35,2.18,1.18]}));
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2,rad=16+(i%2)*5;hot.push(hotPuff(group,{role:`hot-crown-visible-${i}`,r:6.8+(i%3)*1.1,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z:28+(i%3)*2.2,color:i%3===0?FX.core:i%2?FX.orange:FX.yellow,scale:[1.85,1.6,.7]}));}
  hot.push(hotPuff(group,{role:"hot-crown-visible-core",r:10.5,x:0,y:0,z:29,color:FX.yellow,scale:[2.05,1.78,.72]}));
  // Billowing upper crown.
  for(let ring=0;ring<3;ring++){
    const count=10+ring*3;
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2+ring*.31,rad=24+ring*12+(seededNoise(i,ring+3)-.5)*6,z=80+ring*7+(seededNoise(i,ring+7)-.5)*10,r=15+ring*1.8+seededNoise(i,ring+11)*4;
      smoke.push(puff(group,{role:`crown-volumetric-${ring}-${i}`,r,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color:[FX.smokeLight,FX.smoke,FX.smokeDark][ring],scale:[2.15+ring*.18,2.08+ring*.18,1.34+ring*.1]}));
    }
  }
  smoke.push(puff(group,{role:"crown-volumetric-core",r:28,x:0,y:0,z:94,color:FX.smoke,scale:[2.8,2.65,1.22]}));
  smoke.push(puff(group,{role:"crown-volumetric-upper",r:23,x:-4,y:3,z:109,color:FX.smokeDark,scale:[2.65,2.5,1.16]}));
  group.scale.setScalar(.035*NUKE_SCALE);
  clouds.push({group,world,smoke,hot,baseScale:smoke.map(m=>[m.scale.x,m.scale.y]),born:performance.now(),position:position.clone()});
  const v=viewport();if(v){v.dataset.nukeVolumetricCloud="lit-billowing-world-v2";v.dataset.nukeVolumetricStyle="lambert-smoke+additive-heat-v1";v.dataset.nukeVolumetricAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;v.dataset.nukeVolumetricParts=String(smoke.length+hot.length);v.dataset.nukeVolumetricHotParts=String(hot.length);v.dataset.nukeVolumetricScreenSpace="none";v.dataset.nukeVolumetricVisibility="depth-tested-v4";}
}

function update(item,now){
  const age=now-item.born;
  const grow=smooth(clamp(age/2200,0,1));
  const settle=smooth(clamp((age-1200)/6200,0,1));
  const fade=1-clamp((age-22000)/8500,0,1);
  const s=NUKE_SCALE*(.035+grow*1.08);
  item.group.scale.set(s,s,s*(1+.06*settle));
  item.group.position.z=item.position.z+settle*4.2*NUKE_SCALE;
  const heat=Math.max(0,1-age/9000);
  for(let i=0;i<item.smoke.length;i++){
    const mesh=item.smoke[i],delay=(i%9)*.016;
    const local=clamp((grow-delay)/(1-delay),0,1);
    mesh.material.opacity=(.78+.14*seededNoise(i,17))*local*fade;mesh.material.emissive.setRGB(.42*heat,.16*heat,.05*heat);
    const swell=1+age*.0000036,base=item.baseScale[i];mesh.scale.x=base[0]*swell;mesh.scale.y=base[1]*swell;mesh.rotation.z=age*.000006*((i%3)-1);
  }
  const heatFade=Math.max(0,1-age/11500),heatOpacity=clamp(grow*1.65,0,.78)*heatFade;
  for(let i=0;i<item.hot.length;i++)item.hot[i].material.opacity=heatOpacity*(.76+.24*seededNoise(i,41));
  const v=viewport();setData(v,"nukeVolumetricProgress",grow.toFixed(2));setData(v,"nukeVolumetricRiseM",(settle*4.2).toFixed(1));setData(v,"nukeVolumetricHeat",heatOpacity.toFixed(2));
  return age<30500;
}

function frame(now){for(let i=clouds.length-1;i>=0;i--){const item=clouds[i];if(update(item,now))continue;item.world?.remove(item.group);disposeEffect(item.group);clouds.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;requestAnimationFrame(()=>spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0)));});requestAnimationFrame(frame);}
install();