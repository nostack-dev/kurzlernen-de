import assert from "node:assert/strict";
import * as THREE from "three";
import {LanVsSession} from "../sim/lan_vs.mjs";
import {findClearBuildingLaunchPoint,buildingLaunchPointClear} from "../sim/world_building_collision_physics.mjs";
import {FPV_VIEW_EXTRA_UP_M,installFpvViewHeight} from "../sim/fpv_view_height.mjs";
import {roadRouteKey,buildRoadRoute,mergeRoadRouteRegistry,sampleRoadRoute} from "../sim/world_road_routes.mjs";
import {isDrivableRoadFeature} from "../sim/world_road_feature_filter.mjs";
import {enforceOpaqueBuildingLayers} from "../sim/world_building_visual_guard.mjs";
import {buildBuildingDepthGeometry,syncWorldBuildingDepthOcclusion,buildingDepthOcclusionState} from "../sim/world_building_depth_occlusion.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

{
  const viewport={dataset:{cameraMode:"fpv",fpvCameraUpOffsetM:"0.028"}},camera={position:{x:0,y:0,z:0}},bridge={applyLookCamera(){return true;},airframeFor(){return{quaternion:{x:0,y:0,z:0,w:1}};}};
  globalThis.document={getElementById:id=>id==="viewport"?viewport:null};globalThis.__arondightDiagnostics={presentationDraws:1};globalThis.__arondightRealWorld=bridge;
  assert.equal(FPV_VIEW_EXTRA_UP_M,.020,"FPV view must move exactly two centimetres above the physical camera mount");installFpvViewHeight();bridge.applyLookCamera(null,camera);
  assert.ok(Math.abs(camera.position.z-.020)<1e-12&&camera.position.x===0&&camera.position.y===0,"neutral FPV body-up offset must raise only the optical viewpoint");assert.equal(viewport.dataset.fpvViewUpOffsetM,"0.048","2.8 cm physical mount plus 2.0 cm optical lift must expose a 4.8 cm FPV view height");
  delete globalThis.document;delete globalThis.__arondightDiagnostics;delete globalThis.__arondightRealWorld;
}

{
  const path=[[9,47],[9.001,47],[9.002,47]],reversed=[...path].reverse();assert.equal(roadRouteKey(path),roadRouteKey(reversed),"the same OSM road must keep one stable route id even if feature direction flips");
  const route=buildRoadRoute(path,9,47,{lastSeen:0});assert.ok(route&&!route.closed&&route.length>100,"test road must be a long open route");
  const outbound=sampleRoadRoute(route,5,.82),returning=sampleRoadRoute(route,route.length+5,.82);assert.ok(outbound&&returning&&returning.reverse,"open road must ping-pong instead of teleport-looping from end to start");assert.ok(Math.abs(outbound.y-returning.y)<.05,"a U-turn must keep the same physical lane instead of jumping sideways");
  const registry=new Map();let active=mergeRoadRouteRegistry(registry,[path],9,47,1000,{graceMs:30000});assert.equal(active.length,1);const key=active[0].key;active=mergeRoadRouteRegistry(registry,[],9,47,4000,{graceMs:30000});assert.equal(active.length,1,"brief OSM/minimap refresh gaps must not despawn traffic");assert.equal(active[0].key,key,"route identity must survive feature refresh gaps");active=mergeRoadRouteRegistry(registry,[],9,47,32001,{graceMs:30000});assert.equal(active.length,0,"stale roads may expire only after the full route grace interval");
  const feature=(klass,id="road-main")=>({sourceLayer:"transportation",layer:{id,"source-layer":"transportation"},properties:{class:klass}});assert.equal(isDrivableRoadFeature(feature("residential")),true,"residential streets must carry traffic");assert.equal(isDrivableRoadFeature(feature("service")),true,"service roads must remain drivable");assert.equal(isDrivableRoadFeature(feature("rail","railway")),false,"rail must never receive cars");assert.equal(isDrivableRoadFeature(feature("path","path")),false,"foot/path geometry must never receive cars");assert.equal(isDrivableRoadFeature(feature("cycleway","cycleway")),false,"cycleways must never receive cars");
}

{
  const writes=[],map={getStyle:()=>({layers:[{id:"building-3d",type:"fill-extrusion","source-layer":"building"},{id:"water",type:"fill"}]}),setPaintProperty:(id,name,value)=>writes.push([id,name,value]),getPaintProperty:()=>"rgba(120,130,140,0.35)"};
  assert.equal(enforceOpaqueBuildingLayers(map),1,"exactly the 3D building layer must be hardened");assert.ok(writes.some(x=>x[0]==="building-3d"&&x[1]==="fill-extrusion-opacity"&&x[2]===1),"3D buildings must render fully opaque");assert.ok(writes.some(x=>x[0]==="building-3d"&&x[1]==="fill-extrusion-color"&&x[2]==="rgb(120,130,140)"),"embedded alpha in building color must be stripped");assert.equal(writes.some(x=>x[0]==="water"),false,"non-building layers must not be modified");
  const expression=["interpolate",["linear"],["zoom"],14,"#777777",18,"#dddddd"],expressionWrites=[],expressionMap={getStyle:()=>({layers:[{id:"building-expr",type:"fill-extrusion","source-layer":"building"}]}),setPaintProperty:(id,name,value)=>expressionWrites.push([id,name,value]),getPaintProperty:()=>expression};enforceOpaqueBuildingLayers(expressionMap);assert.equal(expressionWrites.some(x=>x[1]==="fill-extrusion-color"),false,"opaque guard must preserve expression-based building colors instead of flattening them");
}

{
  const geometry=buildBuildingDepthGeometry([{buildingKey:"b",base:0,top:12,points:[[-2,-2],[2,-2],[2,2],[-2,2]]}]);assert.ok(geometry.getAttribute("position")?.count>=30,"depth occluder must contain roof/floor/wall triangles");
  const viewport={dataset:{}},scene=new THREE.Scene(),bridge={active:true,threeScene:scene,buildingCollisionSnapshot:{hash:"depth-test",prisms:[{buildingKey:"b",base:0,top:12,points:[[-2,-2],[2,-2],[2,2],[-2,2]]}]}};globalThis.document={getElementById:id=>id==="viewport"?viewport:null};syncWorldBuildingDepthOcclusion(bridge);const state=buildingDepthOcclusionState(),occluder=state.mesh;assert.ok(occluder?.visible&&occluder.userData.worldBuildingDepthOccluder,"building collision geometry must create a visible-in-depth Three occluder");assert.equal(occluder.material.colorWrite,false,"building occluder must not paint over the MapLibre building pixels");assert.equal(occluder.material.depthWrite,true,"building occluder must write depth so drones/cars/people cannot render through walls");assert.equal(occluder.material.depthTest,true);assert.equal(viewport.dataset.worldBuildingOcclusion,"depth-active");delete globalThis.document;
}

function meshHarness(){
  const rooms=new Map();let serial=0;
  function joinRoom(_config,roomId){
    const group=rooms.get(roomId)||new Set();rooms.set(roomId,group);const id=`player-${++serial}`,actions=new Map();
    const room={id,onPeerJoin:null,onPeerLeave:null,
      makeAction(name){const action={onMessage:null,send(data,{target}={}){for(const peer of group){if(peer===room)continue;if(target&&peer.id!==target)continue;peer._deliver(name,data,id);}return Promise.resolve();}};actions.set(name,action);return action;},
      _deliver(name,data,peerId){actions.get(name)?.onMessage?.(data,{peerId});},
      getSelfId(){return id;},
      getAuthorityId(){return [...group].map(peer=>peer.id).concat(id).sort()[0];},
      getPeers(){return Object.fromEntries([...group].filter(peer=>peer!==room).map(peer=>[peer.id,{connectionState:"connected",iceConnectionState:"connected",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()}]));},
      ping:async()=>2,
      leave(){if(!group.has(room))return;group.delete(room);for(const peer of group)peer.onPeerLeave?.(id);}
    };
    for(const peer of group)peer.onPeerJoin?.(id);group.add(room);queueMicrotask(()=>{for(const peer of group)if(peer!==room)room.onPeerJoin?.(peer.id);});return room;
  }
  return async()=>({joinRoom,getRelaySockets:()=>({})});
}

const loadTransport=meshHarness(),events={a:[],b:[],c:[],d:[]},fx={a:[],b:[],c:[],d:[]};
const make=key=>new LanVsSession({loadTransport,transportName:"MeshTest",joinDiagnosticMs:0,onPeer:()=>{},onGame:(packet,peerId)=>events[key].push({packet,peerId}),onFx:(packet,peerId)=>fx[key].push({packet,peerId})});
const a=make("a"),b=make("b"),c=make("c"),d=make("d");
await a.start("net-four-player");await b.start("net-four-player");await c.start("net-four-player");await d.start("net-four-player");await sleep(25);
for(const session of[a,b,c,d])assert.equal(session.peerCount,3,"four players must remain simultaneously connected in one room");
assert.equal(new Set([a.getAuthorityId(),b.getAuthorityId(),c.getAuthorityId(),d.getAuthorityId()]).size,1,"every participant must elect the same deterministic match authority");
assert.equal(new Set([a.getSelfId(),b.getSelfId(),c.getSelfId(),d.getSelfId()]).size,4,"every player needs a unique network identity");

assert.equal(a.sendGame({type:"state",playerId:a.getSelfId(),hp:75,killed:false,by:"",id:"state-a"}),true);await sleep(5);for(const key of["b","c","d"])assert.equal(events[key].length,1,`broadcast game state must reach ${key}`);
const target=d.getSelfId();assert.equal(b.sendFx({type:"shot",id:"shot-b",from:[1,2,3],dir:[1,0,0],speed:210},{target}),true);await sleep(5);assert.equal(fx.a.length,0);assert.equal(fx.c.length,0);assert.equal(fx.d.length,1,"targeted reliable FX must reach exactly the requested peer");
assert.equal(c.sendFx({type:"explosion",id:"boom-c",p:[4,5,6],playerId:c.getSelfId()}),true);await sleep(5);assert.equal(fx.a.length,1);assert.equal(fx.b.length,1);assert.equal(fx.d.length,2,"explosions must broadcast to every other player");

const oldAuthority=a.getAuthorityId();assert.equal(oldAuthority,a.getSelfId());a.stop();await sleep(8);for(const session of[b,c,d])assert.equal(session.peerCount,2,"authority leaving must not tear down the remaining mesh");const migrated=[b.getAuthorityId(),c.getAuthorityId(),d.getAuthorityId()];assert.equal(new Set(migrated).size,1,"remaining players must converge on the same replacement authority");assert.notEqual(migrated[0],oldAuthority,"authority must migrate away from the disconnected player");

const huge={hash:"huge",prisms:[{buildingKey:"block",base:0,top:30,points:[[-500,-500],[500,-500],[500,500],[-500,500]]}]};const safe=findClearBuildingLaunchPoint(huge,{point:[0,0],clearanceM:1,maxSearchM:2});assert.equal(buildingLaunchPointClear(huge,safe,{clearanceM:1}),true,"guaranteed fallback launch point must be proven clear even when normal search radius cannot escape the building");assert.ok(Math.hypot(safe[0],safe[1])>500,"fallback must leave the full blocking footprint instead of returning the unsafe origin");

b.stop();c.stop();d.stop();
console.log("Four-player VS mesh smoke passed: raised 4.8 cm FPV view, drivable stable road routing, opaque depth-occluding buildings, simultaneous mates, authority migration and guaranteed collision-free WORLD spawn.");
