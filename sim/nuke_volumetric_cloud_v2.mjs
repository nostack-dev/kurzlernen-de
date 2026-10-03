import * as THREE from "three";

const clouds=[];
let installed=false;

function viewport(){return document.getElementById("viewport");}
function scene(){return globalThis.__arondightRealWorld?.threeScene||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.userData.nukeVolumetricPart=true;return node;}
function smokeMaterial(color,emissive=0x120806){return new THREE.MeshStandardMaterial({color,roughness:1,metalness:0,transparent:true,opacity:0,depthWrite:false,depthTest:true,flatShading:false,emissive,emissiveIntensity:.2});}
function puff(group,{role,r,x,y,z,color,scale=[1,1,1]}){const mesh=tag(new THREE.Mesh(new THREE.SphereGeometry(r,22,14),smokeMaterial(color)),role);mesh.position.set(x,y,z);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function seededNoise(i,salt=0){const x=Math.sin((i+1)*12.9898+salt*78.233)*43758.5453;return x-Math.floor(x);}
function suppressLegacyPrimitives(root){root?.traverse?.(node=>{const role=String(node.userData?.nukeOverkillRole||"");if(role==="hot-crown"||role==="hot-column"||role==="plume-core")node.visible=false;});}

function spawn(position){
  const world=scene();if(!world)return;
  // Existing nuke effect is already rooted at the exact impact point. Hide only its
  // primitive helper meshes that read as a flat orange disc / straight tube.
  world.traverse?.(node=>{if(node.userData?.nukeOverkillPart)suppressLegacyPrimitives(node);});

  const group=tag(new THREE.Group(),"volumetric-world-root");
  group.position.copy(position);
  world.add(group);
  const smoke=[];

  // Turbulent stem: broad at the ground, necked in the middle, flaring into the cap.
  for(let i=0;i<22;i++){
    const t=i/21,z=4+t*88,neck=.55+Math.abs(t-.5)*.95;
    const radius=(9.5+t*5.5)*neck;
    const angle=i*1.77,offset=(2.2+t*6.2)*(0.55+seededNoise(i,1));
    const x=Math.cos(angle)*offset,y=Math.sin(angle)*offset;
    const color=i<5?0x5d514b:i<13?0x484646:0x55504d;
    smoke.push(puff(group,{role:`plume-volumetric-${i}`,r:radius,x,y,z,color,scale:[1.35,1.25,1.55]}));
  }

  // Thick rolling collar where the rising column mushrooms outward.
  for(let i=0;i<24;i++){
    const a=i/24*Math.PI*2,rad=19+(i%4)*3.8,z=73+(i%3)*4.2;
    smoke.push(puff(group,{role:`crown-collar-${i}`,r:12+(i%5)*1.4,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color:i%2?0x64554e:0x514b48,scale:[1.55,1.45,1.15]}));
  }

  // Four genuinely three-dimensional billowing crown rings. Not a flat disc: puffs
  // occupy different radii/heights/depths and are individually lit by the world.
  for(let ring=0;ring<4;ring++){
    const count=18+ring*4;
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2+ring*.31;
      const jitter=(seededNoise(i,ring+3)-.5)*8;
      const rad=26+ring*13+jitter;
      const z=88+ring*6+(seededNoise(i,ring+7)-.5)*12;
      const r=14+ring*1.8+seededNoise(i,ring+11)*5;
      const color=[0x6a5c55,0x59514d,0x4d4b49,0x414446][ring];
      smoke.push(puff(group,{role:`crown-volumetric-${ring}-${i}`,r,x:Math.cos(a)*rad,y:Math.sin(a)*rad,z,color,scale:[1.45+ring*.12,1.4+ring*.12,1.05+ring*.08]}));
    }
  }

  // Massive rounded crown volumes give the silhouette a mushroom head instead of a ring.
  smoke.push(puff(group,{role:"crown-volumetric-core",r:34,x:0,y:0,z:102,color:0x55504d,scale:[2.15,2.05,1.15]}));
  smoke.push(puff(group,{role:"crown-volumetric-upper",r:27,x:-5,y:4,z:119,color:0x454849,scale:[2.05,1.95,1.05]}));
  smoke.push(puff(group,{role:"crown-volumetric-lower",r:29,x:5,y:-3,z:85,color:0x65554d,scale:[2.1,2.0,.95]}));

  // Warm inner glow stays buried inside smoke; no visible orange saucer.
  const glow=tag(new THREE.PointLight(0xff6a18,1250,360,1.35),"volumetric-inner-glow");glow.position.set(0,0,76);group.add(glow);
  const topGlow=tag(new THREE.PointLight(0xffa047,650,300,1.5),"volumetric-crown-glow");topGlow.position.set(0,0,105);group.add(topGlow);

  group.scale.setScalar(.035);
  clouds.push({group,world,smoke,glow,topGlow,born:performance.now(),position:position.clone()});
  const v=viewport();if(v){v.dataset.nukeVolumetricCloud="lit-billowing-world-v1";v.dataset.nukeVolumetricAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;v.dataset.nukeVolumetricParts=String(smoke.length);v.dataset.nukeVolumetricScreenSpace="none";}
}

function update(item,now){
  const age=now-item.born;
  const grow=smooth(clamp(age/2350,0,1));
  const settle=smooth(clamp((age-1200)/6200,0,1));
  const fade=1-clamp((age-22000)/8500,0,1);
  const s=.035+grow*1.12;
  item.group.scale.set(s,s,s*(1+.08*settle));
  item.group.position.z=item.position.z+settle*5.5;
  for(let i=0;i<item.smoke.length;i++){
    const mesh=item.smoke[i],delay=(i%9)*.018;
    const local=clamp((grow-delay)/(1-delay),0,1);
    mesh.material.opacity=(.74+.18*seededNoise(i,17))*local*fade;
    // Very slow billowing keeps the cloud alive without detaching it from the impact.
    mesh.scale.x*=1.00008;mesh.scale.y*=1.00008;mesh.rotation.z+=.00011*((i%3)-1);
  }
  item.glow.intensity=1250*Math.max(0,1-age/9500);
  item.topGlow.intensity=650*Math.max(0,1-age/11500);
  const v=viewport();if(v){v.dataset.nukeVolumetricProgress=grow.toFixed(3);v.dataset.nukeVolumetricRiseM=(settle*5.5).toFixed(2);}
  return age<30500;
}

function frame(now){for(let i=clouds.length-1;i>=0;i--){const item=clouds[i];if(update(item,now))continue;item.world?.remove(item.group);item.group.traverse?.(node=>{node.geometry?.dispose?.();const mats=Array.isArray(node.material)?node.material:[node.material];mats.filter(Boolean).forEach(m=>m.dispose?.());});clouds.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;requestAnimationFrame(()=>spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0)));});requestAnimationFrame(frame);}
install();
