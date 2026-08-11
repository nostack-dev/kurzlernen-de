from pathlib import Path
p=Path('sim/real_world_bootstrap.mjs')
s=p.read_text()
if 'LanVsSession' not in s:
    s=s.replace('import {fpvTargetDistanceMeters,forwardTarget} from "./world_camera_math.mjs";','import {fpvTargetDistanceMeters,forwardTarget} from "./world_camera_math.mjs";\nimport {LanVsSession,nearbyRoomKey} from "./lan_vs.mjs";')
    s=s.replace('this.lanVs=null;this.lanVsPeer=null;this.lanVsTimer=0;this.lanVsId=(crypto.randomUUID?.()||Math.random().toString(36).slice(2));' if 'this.lanVsId=' in s else 'this.installUi();this.installLookHud();this.installFreeLookSurface();', 'this.vsSession=null;this.vsPeerMesh=null;this.vsConnected=false;this.installUi();this.installLookHud();this.installFreeLookSurface();this.installVsUi();')
    marker='  installLookHud(){'
    method=r'''  installVsUi(){
    const viewport=$("viewport");if(!viewport||$("lanVsButton"))return;
    const button=document.createElement("button");button.id="lanVsButton";button.type="button";button.textContent="FIND MATE · VS";button.style.cssText="position:absolute;z-index:6;left:max(10px,env(safe-area-inset-left));bottom:max(12px,calc(env(safe-area-inset-bottom) + 8px));padding:9px 12px;border:1px solid #70ddff88;border-radius:10px;background:#071522e8;color:#dff7ff;font:800 10px system-ui;letter-spacing:.05em;touch-action:manipulation";viewport.appendChild(button);
    const status=document.createElement("div");status.id="lanVsStatus";status.style.cssText="position:absolute;z-index:6;left:max(10px,env(safe-area-inset-left));bottom:max(52px,calc(env(safe-area-inset-bottom) + 48px));padding:5px 8px;border-radius:8px;background:#071522d9;color:#aeeaff;font:800 9px system-ui;display:none";viewport.appendChild(status);
    button.onclick=()=>this.toggleVs();
  }
  async toggleVs(){
    if(this.vsSession){this.stopVs();return;}
    const button=$("lanVsButton"),status=$("lanVsStatus");if(button)button.textContent="FINDING MATE…";if(status){status.style.display="block";status.textContent="Nearby VS matchmaking…";}
    const lat=Number(this.lastLocation?.coords?.latitude??this.originLat),lon=Number(this.lastLocation?.coords?.longitude??this.originLon);const roomId=nearbyRoomKey(lat,lon);
    const session=new LanVsSession({onPeer:()=>{this.vsConnected=true;if(button)button.textContent="VS · CONNECTED";if(status)status.textContent="Mate found · direct P2P";this.ensureVsPeerMesh();},onPose:pose=>this.applyVsPose(pose),onLeave:()=>{this.vsConnected=false;if(button)button.textContent="FINDING MATE…";if(status)status.textContent="Mate left · searching…";if(this.vsPeerMesh)this.vsPeerMesh.visible=false;},onError:error=>{if(button)button.textContent="FIND MATE · VS";if(status)status.textContent=`VS unavailable · ${error?.message||error}`;}});this.vsSession=session;try{await session.start(roomId);}catch{if(this.vsSession===session)this.vsSession=null;}
  }
  stopVs(){this.vsSession?.stop();this.vsSession=null;this.vsConnected=false;if(this.vsPeerMesh)this.vsPeerMesh.visible=false;const b=$("lanVsButton"),s=$("lanVsStatus");if(b)b.textContent="FIND MATE · VS";if(s)s.style.display="none";}
  ensureVsPeerMesh(){
    if(this.vsPeerMesh||!this.threeScene)return;const group=new THREE.Group();const mat=new THREE.MeshStandardMaterial({color:0x36e6ff,roughness:.35,metalness:.35});const body=new THREE.Mesh(new THREE.BoxGeometry(.22,.34,.07),mat);group.add(body);for(const [x,y] of [[-.19,-.19],[.19,-.19],[-.19,.19],[.19,.19]]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.025,.26,.025),mat);arm.position.set(x*.5,y*.5,0);arm.rotation.z=(x*y>0?1:-1)*Math.PI/4;group.add(arm);}group.visible=false;group.renderOrder=5;this.threeScene.add(group);this.vsPeerMesh=group;
  }
  applyVsPose(pose){if(!pose||!Array.isArray(pose.p)||pose.p.length<3)return;this.ensureVsPeerMesh();if(!this.vsPeerMesh)return;const [x,y,z]=pose.p.map(Number);if(![x,y,z].every(Number.isFinite))return;this.vsPeerMesh.position.set(x,y,z);const q=pose.q;if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))this.vsPeerMesh.quaternion.set(q[0],q[1],q[2],q[3]);this.vsPeerMesh.visible=true;}
  updateVsPose(){if(!this.vsSession||!this.airframe)return;const p=this.airframe.position,q=this.airframe.quaternion;if(!p||!q)return;this.vsSession.setPose({p:[p.x,p.y,p.z],q:[q.x,q.y,q.z,q.w],t:performance.now()});}
'''
    s=s.replace(marker,method+marker)
    # Piggyback on the existing world render hook: one lightweight pose snapshot, transport itself throttles to 20 Hz.
    needle='renderWorldFrame(frame){'
    if needle in s:s=s.replace(needle,needle+'this.updateVsPose();',1)
    else:
        needle='renderFrame(frame){'
        if needle in s:s=s.replace(needle,needle+'this.updateVsPose();',1)
p.write_text(s)
