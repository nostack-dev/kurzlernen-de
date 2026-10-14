// Another player's drone, drawn like your own (same 225 mm quad, same frame: nose toward −x) instead
// of a glowing box: carbon arms, motors, spinning translucent props, skids, red nose and FPV camera.
// The player's colour is on the canopy, the motor bells and an LED ring, so you can tell mates apart
// without the whole craft turning into a neon blob. Only parts tagged vsAccent take the colour.
import * as THREE from "three";
const ARM=.225/(2*Math.SQRT2),PROP_D=.127;
export function buildPeerDroneModel(color=0x36e6ff){
  const g=new THREE.Group();g.name="VS_PEER_DRONE";
  const carbon=new THREE.MeshStandardMaterial({color:0x22272e,metalness:.35,roughness:.45}),dark=new THREE.MeshStandardMaterial({color:0x14181d,metalness:.3,roughness:.5});
  const accent=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.35,metalness:.25,roughness:.35});accent.userData.vsAccent=true;
  const led=new THREE.MeshBasicMaterial({color,toneMapped:false});led.userData.vsAccent=true;led.userData.vsLed=true;
  const add=(m,x=0,y=0,z=0)=>{m.position.set(x,y,z);m.castShadow=true;m.userData.flightFireIgnore=true;g.add(m);return m;};
  add(new THREE.Mesh(new THREE.BoxGeometry(.11,.075,.03),carbon),0,0,.0);                 // frame plate
  add(new THREE.Mesh(new THREE.BoxGeometry(.085,.06,.026),accent),.005,0,.027);            // canopy in the player's colour
  const ring=add(new THREE.Mesh(new THREE.TorusGeometry(.03,.004,6,24),led),.005,0,.042);ring.castShadow=false;
  const rotors=[];
  for(const[sx,sy]of[[-1,-1],[-1,1],[1,1],[1,-1]]){
    const x=sx*ARM,y=sy*ARM,len=Math.hypot(x,y);
    const arm=add(new THREE.Mesh(new THREE.BoxGeometry(len,.014,.008),carbon),x/2,y/2,0);arm.rotation.z=Math.atan2(y,x);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.014,.016,.022,16).rotateX(Math.PI/2),dark),x,y,.012);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,.008,16).rotateX(Math.PI/2),accent),x,y,.026); // motor bell
    const disc=add(new THREE.Mesh(new THREE.CircleGeometry(PROP_D/2,28),new THREE.MeshBasicMaterial({color:0xd8e2ea,transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide})),x,y,.031);disc.castShadow=false;
    const blade=add(new THREE.Mesh(new THREE.BoxGeometry(PROP_D,.01,.002),new THREE.MeshStandardMaterial({color:0x101418,roughness:.6})),x,y,.032);rotors.push(blade);
  }
  for(const y of[-.03,.03]){const skid=add(new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.12,8),dark),0,y,-.03);skid.rotation.z=Math.PI/2;}
  const nose=add(new THREE.Mesh(new THREE.ConeGeometry(.012,.04,12),new THREE.MeshStandardMaterial({color:0xff4f65,emissive:0x66121f,emissiveIntensity:.4})),-.072,0,.004);nose.rotation.z=Math.PI/2;
  add(new THREE.Mesh(new THREE.BoxGeometry(.028,.026,.022),dark),-.05,0,.022);               // FPV camera
  g.userData.vsRotors=rotors;return g;
}
// spin the props (called per frame by the owner of the mesh)
export function spinPeerDrone(g,dt,throttle=1){for(const r of g?.userData?.vsRotors||[])r.rotation.z+=dt*(60+90*throttle)*(r.position.x*r.position.y>0?1:-1);}
