from pathlib import Path
p=Path('sim/real_world_bootstrap.mjs')
s=p.read_text()
if 'LanVsSession' not in s:
    raise SystemExit('VS integration base missing')
old='const lat=Number(this.lastLocation?.coords?.latitude??this.originLat),lon=Number(this.lastLocation?.coords?.longitude??this.originLon);const roomId=nearbyRoomKey(lat,lon);'
new='let lat=Number(this.lastLocation?.coords?.latitude??this.originLat),lon=Number(this.lastLocation?.coords?.longitude??this.originLon);if(!Number.isFinite(lat)||!Number.isFinite(lon)){try{this.lastLocation=await geolocate();lat=Number(this.lastLocation.coords.latitude);lon=Number(this.lastLocation.coords.longitude);}catch{if(button)button.textContent="FIND MATE · VS";if(status)status.textContent="GPS is needed to find a nearby mate";return;}}const roomId=nearbyRoomKey(lat,lon);'
s=s.replace(old,new)
old='applyVsPose(pose){if(!pose||!Array.isArray(pose.p)||pose.p.length<3)return;this.ensureVsPeerMesh();if(!this.vsPeerMesh)return;const [x,y,z]=pose.p.map(Number);if(![x,y,z].every(Number.isFinite))return;this.vsPeerMesh.position.set(x,y,z);const q=pose.q;if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))this.vsPeerMesh.quaternion.set(q[0],q[1],q[2],q[3]);this.vsPeerMesh.visible=true;}\n  updateVsPose(){if(!this.vsSession||!this.airframe)return;const p=this.airframe.position,q=this.airframe.quaternion;if(!p||!q)return;this.vsSession.setPose({p:[p.x,p.y,p.z],q:[q.x,q.y,q.z,q.w],t:performance.now()});}'
new='applyVsPose(pose){if(!pose||!Array.isArray(pose.p)||pose.p.length<3)return;this.ensureVsPeerMesh();if(!this.vsPeerMesh)return;let [x,y,z]=pose.p.map(Number);if(Array.isArray(pose.g)&&pose.g.length===2&&Number.isFinite(this.originLon)&&Number.isFinite(this.originLat)){const local=lngLatToMeters(this.originLon,this.originLat,Number(pose.g[0]),Number(pose.g[1]));x=local[0];y=local[1];}if(![x,y,z].every(Number.isFinite))return;this.vsPeerMesh.position.set(x,y,z);const q=pose.q;if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))this.vsPeerMesh.quaternion.set(q[0],q[1],q[2],q[3]);this.vsPeerMesh.visible=true;}\n  updateVsPose(){if(!this.vsSession||!this.airframe)return;const p=this.airframe.position,q=this.airframe.quaternion;if(!p||!q)return;const pose={p:[p.x,p.y,p.z],q:[q.x,q.y,q.z,q.w],t:performance.now()};if(this.active&&Number.isFinite(this.originLon)&&Number.isFinite(this.originLat))pose.g=metersToLngLat(this.originLon,this.originLat,p.x,p.y);this.vsSession.setPose(pose);}'
s=s.replace(old,new)
needle='renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);'
if 'renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();' not in s:
    s=s.replace(needle,'renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();')
p.write_text(s)
