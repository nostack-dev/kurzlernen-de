import * as THREE from "three";

const clouds=[];
let installed=false;
const CINEMATIC_RENDER_ORDER=840;

function viewport(){return document.getElementById("viewport");}
function scene(){return globalThis.__arondightRealWorld?.threeScene||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.userData.nukeVolumetricPart=true;node.renderOrder=CINEMATIC_RENDER_ORDER;return node;}
function smokeMaterial(color,emissive=0x21130f){return new THREE.MeshStandardMaterial({color,roughness:1,metalness:0,transparent:true,opacity:0,depthWrite:false,depthTest:false,flatShading:false,emissive,emissiveIntensity:.34});}
function hotMaterial(color){return new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});}
function puff(group,{role,r,x,y,z,color,scale=[1,1,1]}){const mesh=tag(new THREE.Mesh(new THREE.SphereGeometry(r,22,14),smokeMaterial(color)),role);mesh.position.set(x,y,z);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function hotPuff(group,{role,r,x,y,z,color,scale=[1,1,1]}){const mesh=tag(new THREE.Mesh(new THREE.SphereGeometry(r,18,12),hotMaterial(color)),role);mesh.position.set(x,y,z);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function seededNoise(i,salt=0){const x=Math.sin((i+1)*12.9898+salt*78.233)*43758.5453;return x-Math.floor(x);}
function suppressLegacyPrimitives(root){root?.traverse?.(node=>{const role=String(node.userData?.nukeOverkillRole||"");if(role==="hot-crown"||role==="hot-column"||role==="plume-core")node.visible=false;});}

function spawn(position){
  const world=scene();if(!world)return;
  world.traverse?.(node=>{if(node.userData?.nukeOverkillPart)suppressLegacyPrimitives(node);});

  const group=tag(new THREE.Group(),"volumetric-world-root");
  group.position.copy(position);
  world.add(group);
  const smoke=[],hot=[];

  // Turbulent smoke stem. It is deliberately brighter than scenery so the column
  // still reads in a low FPV camera instead of becoming another dark vertical prop.
  for(let i=0;i<22;i++){
    const t=i/21,z=4+t*82,neck=.58+Math.abs(t-.5)*.76;
    const radius=(8.6+t*4.8)*neck;
    const angle=i*1.77,offset=(1.8+t*4.8)*(0.55+seededNoise(i,1));
    const x=Math.cos(angle)*offset,y=Math.sin(angle)*offset;
    const color=i<6?0x665951:i<14?0x5a5552:0x625b57;
    smoke.push(puff(group,{role:`plume-volumetric-${i}`,r:radius,x,y,z,color,scale:[1.28,1.2,1.5]}));
  }

  // Incandescent material inside the rising stem makes the cloud unmistakably an
  // explosion while all geometry remains anchored in world space at the impact.
  for(let i=0;i<9;i++){
    const z=5+i*5.1,a=i*1.31,rad=.8+(i%3)*.65;
    hot.push(hotPuff(group,{role:`hot-plume-visible-${i}`,r:3.7+i*.18,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color:i<3?0xfff1a0:i<6?0xff9b28:0xff5b12,scale:[1.35,1.25,1.55]}));
  }

  // Rolling collar where the stem opens into the cap.
  for(let i=0;i<24;i++){
    const a=i/24*Math.PI*2,rad=17+(i%4)*3.2,z=67+(i%3)*3.4;
    smoke.push(puff(group,{role:`crown-collar-${i}`,r:10.5+(i%5)*1.15,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color:i%2?0x75645b:0x625954,scale:[1.9,1.82,1.2]}));
  }

  // Readable low mushroom cap. Previous versions were so wide/dark that they filled
  // the top of the screen like a ceiling. This one keeps a clear cap silhouette.
  for(let i=0;i<18;i++){
    const a=i/18*Math.PI*2;
    const rad=21+(i%4)*4.4+(seededNoise(i,31)-.5)*3.5;
    const z=34+(i%5)*2.5+(seededNoise(i,32)-.5)*3;
    const r=14+(i%4)*1.8+seededNoise(i,33)*2.6;
    const color=i%3===0?0x766963:i%3===1?0x665d59:0x817067;
    smoke.push(puff(group,{role:`crown-visible-${i}`,r,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color,scale:[1.9,1.8,1.12]}));
  }
  smoke.push(puff(group,{role:"crown-visible-core",r:22,x:0,y:0,z:43,color:0x71645f,scale:[2.35,2.18,1.18]}));

  // Hot underside of the cap. This is true 3D geometry, not a DOM/screen overlay.
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2,rad=15+(i%4)*4.2,z=28+(i%3)*2.2;
    hot.push(hotPuff(group,{role:`hot-crown-visible-${i}`,r:5.8+(i%3)*1.05,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color:i%4===0?0xfff1a0:i%2?0xff7b18:0xffad32,scale:[1.85,1.58,.68]}));
  }
  hot.push(hotPuff(group,{role:"hot-crown-visible-core",r:10.5,x:0,y:0,z:29,color:0xffc243,scale:[2.05,1.78,.72]}));

  // Higher billowing crown preserves the huge nuclear scale without swallowing the
  // whole frame. It sits above the readable lower cap rather than replacing it.
  for(let ring=0;ring<4;ring++){
    const count=18+ring*4;
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2+ring*.31;
      const jitter=(seededNoise(i,ring+3)-.5)*6;
      const rad=24+ring*10.5+jitter;
      const z=80+ring*6+(seededNoise(i,ring+7)-.5)*10;
      const r=12.5+ring*1.55+seededNoise(i,ring+11)*4;
      const color=[0x786862,0x685f5b,0x5d5956,0x535452][ring];
      smoke.push(puff(group,{role:`crown-volumetric-${ring}-${i}`,r,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color,scale:[2.15+ring*.18,2.08+ring*.18,1.34+ring*.1]}));
    }
  }

  smoke.push(puff(group,{role:"crown-volumetric-core",r:28,x:0,y:0,z:94,color:0x655d59,scale:[2.8,2.65,1.22]}));
  smoke.push(puff(group,{role:"crown-volumetric-upper",r:23,x:-4,y:3,z:109,color:0x565958,scale:[2.65,2.5,1.16]}));
  smoke.push(puff(group,{role:"crown-volumetric-lower",r:24,x:4,y:-3,z:76,color:0x78655c,scale:[2.72,2.58,1.08]}));

  const glow=tag(new THREE.PointLight(0xff6a18,1550,390,1.25),"volumetric-inner-glow");glow.position.set(0,0,35);group.add(glow);
  const topGlow=tag(new THREE.PointLight(0xffa047,780,310,1.4),"volumetric-crown-glow");topGlow.position.set(0,0,67);group.add(topGlow);

  group.scale.setScalar(.035);
  clouds.push({group,world,smoke,hot,glow,topGlow,born:performance.now(),position:position.clone()});
  const v=viewport();if(v){v.dataset.nukeVolumetricCloud="lit-billowing-world-v1";v.dataset.nukeVolumetricAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;v.dataset.nukeVolumetricParts=String(smoke.length+hot.length);v.dataset.nukeVolumetricHotParts=String(hot.length);v.dataset.nukeVolumetricScreenSpace="none";v.dataset.nukeVolumetricVisibility="cinematic-depth-priority-v3";v.dataset.nukeVolumetricReadableCrown="classic-mushroom-hot-underside-v2";v.dataset.nukeVolumetricSilhouette="gray-cap+hot-underside+lit-plume-v1";}
}

function update(item,now){
  const age=now-item.born;
  const grow=smooth(clamp(age/2200,0,1));
  const settle=smooth(clamp((age-1200)/6200,0,1));
  const fade=1-clamp((age-22000)/8500,0,1);
  const s=.035+grow*1.08;
  item.group.scale.set(s,s,s*(1+.06*settle));
  item.group.position.z=item.position.z+settle*4.2;
  for(let i=0;i<item.smoke.length;i++){
    const mesh=item.smoke[i],delay=(i%9)*.016;
    const local=clamp((grow-delay)/(1-delay),0,1);
    mesh.material.opacity=(.66+.15*seededNoise(i,17))*local*fade;
    mesh.scale.x*=1.00006;mesh.scale.y*=1.00006;mesh.rotation.z+=.0001*((i%3)-1);
  }
  const heatFade=Math.max(0,1-age/11500),heatOpacity=clamp(grow*1.65,0,.78)*heatFade;
  for(let i=0;i<item.hot.length;i++)item.hot[i].material.opacity=heatOpacity*(.76+.24*seededNoise(i,41));
  item.glow.intensity=1550*Math.max(0,1-age/9600);
  item.topGlow.intensity=780*Math.max(0,1-age/11800);
  const v=viewport();if(v){v.dataset.nukeVolumetricProgress=grow.toFixed(3);v.dataset.nukeVolumetricRiseM=(settle*4.2).toFixed(2);v.dataset.nukeVolumetricHeat=heatOpacity.toFixed(3);}
  return age<30500;
}

function frame(now){for(let i=clouds.length-1;i>=0;i--){const item=clouds[i];if(update(item,now))continue;item.world?.remove(item.group);item.group.traverse?.(node=>{node.geometry?.dispose?.();const mats=Array.isArray(node.material)?node.material:[node.material];mats.filter(Boolean).forEach(m=>m.dispose?.());});clouds.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;requestAnimationFrame(()=>spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0)));});requestAnimationFrame(frame);}
install();