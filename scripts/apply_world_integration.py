from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise RuntimeError(f'{label}: marker not found in {path}')
    p.write_text(s.replace(old, new, 1))
    print(f'patched {label}')


def replace_block(path, start_marker, end_marker, new_block, label):
    p = Path(path)
    s = p.read_text()
    start = s.find(start_marker)
    if start < 0:
        raise RuntimeError(f'{label}: start marker not found in {path}')
    end = s.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'{label}: end marker not found in {path}')
    p.write_text(s[:start] + new_block + s[end:])
    print(f'patched {label}')


# OSM physical dimensions + source properties for material styling.
replace_once(
    'sim/world_building_collisions.mjs',
    'const properties=feature?.properties||{},top=clamp(Number(properties.render_height??properties.height??8)||8,.5,300),base=clamp(Number(properties.render_min_height??properties.min_height??0)||0,0,Math.max(0,top-.1)),featureId=stableFeatureId(feature);',
    'const properties=feature?.properties||{},levels=Number(properties.levels??properties["building:levels"]),minLevels=Number(properties.min_level??properties["building:min_level"]),top=clamp(Number(properties.render_height??properties.height??(Number.isFinite(levels)?levels*3:8))||8,.5,300),base=clamp(Number(properties.render_min_height??properties.min_height??(Number.isFinite(minLevels)?minLevels*3:0))||0,0,Math.max(0,top-.1)),featureId=stableFeatureId(feature);',
    'building height fallback',
)
replace_once(
    'sim/world_building_collisions.mjs',
    'const candidate={key,outer,holes,base,top,center:centerPoint,distance,area};',
    'const candidate={key,outer,holes,base,top,center:centerPoint,distance,area,properties:Object.freeze({...properties})};',
    'building properties',
)

# Box3D uses the same DEM triangle surface as WORLD rendering and owns spawn queries.
replace_once(
    'sim/simulator.mjs',
    'import {batteryOcvVoltage,batteryVoltageUnderLoad,scaleCurrentsToPackLimit,solveStaticPropulsionAuthority,MOTOR_BEARING_DRAG_NM_PER_RAD_S} from "./propulsion_authority.mjs";',
    'import {batteryOcvVoltage,batteryVoltageUnderLoad,scaleCurrentsToPackLimit,solveStaticPropulsionAuthority,MOTOR_BEARING_DRAG_NM_PER_RAD_S} from "./propulsion_authority.mjs";\nimport {normalizeTerrainSnapshot} from "./world_terrain.mjs";\nimport {createWorldTerrainCollision,destroyWorldTerrainCollision} from "./world_terrain_physics.mjs";\nimport {findSafeSpawn as searchSafeSpawn} from "./safe_spawn.mjs";',
    'sim terrain imports',
)
replace_once(
    'sim/simulator.mjs',
    'this.world=null;this.body=null;this.group=null;this.rotors=[];this.worldBuildingCollisionSnapshot=normalizeBuildingCollisionSnapshot(null);',
    'this.world=null;this.body=null;this.group=null;this.rotors=[];this.worldTerrainSnapshot=null;this.worldTerrainCollisionState=null;this.flatGroundBody=null;this.worldTerrainRevision=0;this.worldBuildingCollisionSnapshot=normalizeBuildingCollisionSnapshot(null);',
    'sim terrain state',
)
replace_once(
    'sim/simulator.mjs',
    'if(this.world){this.worldBuildingCollisionState=null;b3.b3DestroyWorld(this.world);}',
    'if(this.world){this.worldBuildingCollisionState=null;this.worldTerrainCollisionState=null;this.flatGroundBody=null;b3.b3DestroyWorld(this.world);}',
    'sim world reset state',
)
replace_once(
    'sim/simulator.mjs',
    'const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(this.world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.baseMaterial.friction=.75;groundShape.baseMaterial.restitution=.03;groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,TERRAIN_HALF,TERRAIN_HALF,.05);',
    'this.rebuildWorldGround();',
    'sim ground creation',
)

p = Path('sim/simulator.mjs')
s = p.read_text()
marker = '  setWorldBuildingCollisions(value)'
idx = s.find(marker)
if idx < 0:
    raise RuntimeError('sim safe spawn methods: insertion marker missing')
methods = '''  setWorldTerrain(value){const snapshot=normalizeTerrainSnapshot(value);const oldHash=this.worldTerrainSnapshot?.hash||"",nextHash=snapshot?.hash||"";if(oldHash===nextHash)return false;this.worldTerrainSnapshot=snapshot;this.rebuildWorldGround();return true;}\n  rebuildWorldGround(){\n    if(!this.world)return;destroyWorldTerrainCollision(b3,this.worldTerrainCollisionState);this.worldTerrainCollisionState=null;try{if(this.flatGroundBody&&b3.b3Body_IsValid(this.flatGroundBody))b3.b3DestroyBody(this.flatGroundBody);}catch{}this.flatGroundBody=null;\n    if(this.worldTerrainSnapshot)this.worldTerrainCollisionState=createWorldTerrainCollision(b3,this.world,this.worldTerrainSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,friction:.78,restitution:.02});\n    else{const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];this.flatGroundBody=b3.b3CreateBody(this.world,groundDef);const groundShape=b3.b3DefaultShapeDef();groundShape.baseMaterial.friction=.75;groundShape.baseMaterial.restitution=.03;groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,groupIndex:0};b3.b3CreateBoxShape(this.flatGroundBody,groundShape,TERRAIN_HALF,TERRAIN_HALF,.05);}\n    this.worldTerrainRevision++;\n  }\n  safeSpawnProbe(x,y){\n    if(!this.world)return null;const current=this.position?.()||[0,0,0],terrainMax=Number(this.worldTerrainSnapshot?.maxZ)||0,top=Math.max(250,terrainMax+160,Number(current[2]||0)+120),distance=Math.max(900,top+650),ray=[0,0,-distance],cast=category=>{const filter=b3.b3DefaultQueryFilter();filter.categoryBits=category;filter.maskBits=COLLISION_TERRAIN;return b3.b3World_CastRayClosest(this.world,[x,y,top],ray,filter);},terrain=cast(QUERY_RANGEFINDER),obstacle=cast(QUERY_CAMERA);if(!terrain?.hit||!obstacle?.hit)return null;const terrainZ=Number(terrain.point?.[2]),obstructionZ=Number(obstacle.point?.[2]),normalZ=Number(terrain.normal?.[2]);if(![terrainZ,obstructionZ,normalZ].every(Number.isFinite))return null;return{terrainZ,obstructionZ,normalZ};\n  }\n  findSafeSpawn({around=[0,0,0],mode="initial",seed=1}={}){const clearanceRadiusM=this.p.span/2+this.p.propD/2+.04;return searchSafeSpawn({around,mode,seed,clearanceRadiusM,supportM:AIRFRAME_GROUND_SUPPORT_M,separationM:.025,probe:(x,y)=>this.safeSpawnProbe(x,y)});}\n'''
s = s[:idx] + methods + s[idx:]
p.write_text(s)
print('patched sim terrain + safe spawn methods')

replace_once(
    'sim/simulator.mjs',
    'globalThis.__arondightRealWorld?.attachCameraCollisionResolver?.((anchor,desired)=>physics.resolveCameraPath(anchor,desired));',
    'globalThis.__arondightRealWorld?.attachCameraCollisionResolver?.((anchor,desired)=>physics.resolveCameraPath(anchor,desired));\nglobalThis.__arondightRealWorld?.attachTerrainCollisionSink?.(snapshot=>physics.setWorldTerrain(snapshot));\nglobalThis.__arondightRealWorld?.attachSafeSpawnResolver?.(request=>physics.findSafeSpawn(request));\nglobalThis.__arondightRealWorld?.attachSpawnApplySink?.(initial=>{resetSimulation(initial);return initial;});',
    'sim bridge terrain/spawn wiring',
)

# WORLD bridge: one Mapterhorn DEM source drives MapLibre terrain and Box3D sampling.
replace_once(
    'sim/real_world_bootstrap.mjs',
    'import {buildingFootprintsFromFeatures,buildingFootprintHash,buildingCollisionPrismsFromFootprints} from "./world_building_collisions.mjs";',
    'import {buildingFootprintsFromFeatures,buildingFootprintHash,buildingCollisionPrismsFromFootprints} from "./world_building_collisions.mjs";\nimport {buildTerrainSnapshot,terrainHeightAt,raycastTerrainSnapshot,WORLD_TERRAIN_HALF_EXTENT_M,WORLD_TERRAIN_GRID_SIZE,WORLD_TERRAIN_REBUILD_DISTANCE_M,WORLD_TERRAIN_SYNC_MIN_MS} from "./world_terrain.mjs";\nimport {WorldDemSampler,WORLD_DEM_ZOOM,WORLD_DEM_TILE_SIZE,WORLD_DEM_TILE_URL,WORLD_DEM_ENCODING,WORLD_DEM_ATTRIBUTION} from "./world_dem_sampler.mjs";\nimport {WorldBuildingVisualLayer} from "./world_building_visuals.mjs";',
    'bridge terrain imports',
)
replace_once(
    'sim/real_world_bootstrap.mjs',
    'const WORLD_IMAGERY_MAX_ZOOM=19;',
    'const WORLD_IMAGERY_MAX_ZOOM=19;\nconst WORLD_TERRAIN_SOURCE_ID="arondight45-world-dem";\nconst WORLD_TERRAIN_HILLSHADE_LAYER_ID="arondight45-world-hillshade";',
    'bridge terrain constants',
)
replace_once(
    'sim/real_world_bootstrap.mjs',
    'this.buildingSourceId=null;this.buildingCollisionSink=null;this.buildingCollisionSnapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionDirty=true;this.buildingCollisionLastSyncMs=-Infinity;this.buildingCollisionLastCenter=[Infinity,Infinity];this.buildingCollisionRevisions=0;this.cameraCollisionResolver=null;',
    'this.buildingSourceId=null;this.buildingCollisionSink=null;this.buildingCollisionSnapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionDirty=true;this.buildingCollisionLastSyncMs=-Infinity;this.buildingCollisionLastCenter=[Infinity,Infinity];this.buildingCollisionRevisions=0;this.cameraCollisionResolver=null;this.terrainCollisionSink=null;this.safeSpawnResolver=null;this.spawnApplySink=null;this.demSampler=new WorldDemSampler();this.terrainSnapshot=null;this.terrainOriginElevationM=null;this.terrainLastSyncMs=-Infinity;this.terrainLastCenter=[Infinity,Infinity];this.terrainSyncPromise=null;this.terrainRevisions=0;this.buildingVisualLayer=null;this.lastSafeSpawn=null;',
    'bridge terrain state',
)
replace_once(
    'sim/real_world_bootstrap.mjs',
    'this.threeRenderer=renderer;this.threeScene=scene;this.threeCamera=camera;if(this.flightPixelRatio===null)this.flightPixelRatio=renderer.getPixelRatio();if(this.flightShadowEnabled===null)this.flightShadowEnabled=renderer.shadowMap.enabled;',
    'this.threeRenderer=renderer;this.threeScene=scene;this.threeCamera=camera;if(this.flightPixelRatio===null)this.flightPixelRatio=renderer.getPixelRatio();if(this.flightShadowEnabled===null)this.flightShadowEnabled=renderer.shadowMap.enabled;\n    if(this.buildingVisualLayer?.scene!==scene){this.buildingVisualLayer?.destroy?.();this.buildingVisualLayer=new WorldBuildingVisualLayer(scene);this.buildingVisualLayer.setVisible(this.active);}',
    'bridge textured building layer',
)

p = Path('sim/real_world_bootstrap.mjs')
s = p.read_text()
marker = '  attachBuildingCollisionSink(sink){'
idx = s.find(marker)
if idx < 0:
    raise RuntimeError('bridge terrain methods: marker missing')
terrain_methods = '''  addTerrainPresentation(){\n    if(!this.map)return;try{if(!this.map.getSource(WORLD_TERRAIN_SOURCE_ID))this.map.addSource(WORLD_TERRAIN_SOURCE_ID,{type:"raster-dem",tiles:[WORLD_DEM_TILE_URL],encoding:WORLD_DEM_ENCODING,tileSize:WORLD_DEM_TILE_SIZE,maxzoom:WORLD_DEM_ZOOM,attribution:WORLD_DEM_ATTRIBUTION});this.map.setTerrain({source:WORLD_TERRAIN_SOURCE_ID,exaggeration:1});if(!this.map.getLayer(WORLD_TERRAIN_HILLSHADE_LAYER_ID)){const before=(this.map.getStyle()?.layers||[]).find(layer=>layer.type==="line")?.id,layer={id:WORLD_TERRAIN_HILLSHADE_LAYER_ID,type:"hillshade",source:WORLD_TERRAIN_SOURCE_ID,paint:{"hillshade-exaggeration":.18,"hillshade-shadow-color":"#273326","hillshade-highlight-color":"#f4edd7","hillshade-accent-color":"#596555"}};if(before)this.map.addLayer(layer,before);else this.map.addLayer(layer);}}catch(error){throw Error(`REAL WORLD DEM presentation failed: ${error?.message||error}`);}\n  }\n  attachTerrainCollisionSink(sink){this.terrainCollisionSink=typeof sink==="function"?sink:null;if(this.terrainCollisionSink)this.terrainCollisionSink(this.terrainSnapshot);return Boolean(this.terrainCollisionSink);}\n  attachSafeSpawnResolver(resolver){this.safeSpawnResolver=typeof resolver==="function"?resolver:null;return Boolean(this.safeSpawnResolver);}\n  attachSpawnApplySink(sink){this.spawnApplySink=typeof sink==="function"?sink:null;return Boolean(this.spawnApplySink);}\n  clearTerrainPhysics(){this.terrainSnapshot=null;this.terrainLastCenter=[Infinity,Infinity];this.terrainLastSyncMs=-Infinity;this.terrainCollisionSink?.(null);const viewport=$("viewport");if(viewport){viewport.dataset.worldTerrainStatus="inactive";viewport.dataset.worldTerrainTriangles="0";delete viewport.dataset.worldTerrainRangeM;}return true;}\n  async initializeTerrainOrigin(){if(!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))throw Error("WORLD DEM origin missing");const elevation=await this.demSampler.sample(this.originLon,this.originLat);if(!Number.isFinite(elevation))throw Error("WORLD DEM returned no origin elevation");this.terrainOriginElevationM=elevation;const viewport=$("viewport");if(viewport){viewport.dataset.worldTerrainOriginElevationM=elevation.toFixed(3);viewport.dataset.worldTerrainSource=`mapterhorn-z${WORLD_DEM_ZOOM}-terrarium`;}return elevation;}\n  async syncTerrainPhysics(force=false){\n    if(!this.terrainCollisionSink||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat)||!Number.isFinite(this.terrainOriginElevationM))return false;if(this.terrainSyncPromise)return this.terrainSyncPromise;const now=performance.now(),airframe=this.airframeFor(this.threeScene),center=[Number(airframe?.position?.x)||0,Number(airframe?.position?.y)||0],moved=Math.hypot(center[0]-this.terrainLastCenter[0],center[1]-this.terrainLastCenter[1]);if(!force&&now-this.terrainLastSyncMs<WORLD_TERRAIN_SYNC_MIN_MS&&moved<WORLD_TERRAIN_REBUILD_DISTANCE_M)return false;\n    const half=WORLD_TERRAIN_HALF_EXTENT_M,size=WORLD_TERRAIN_GRID_SIZE,step=2*half/(size-1),points=[];for(let row=0;row<size;row++)for(let col=0;col<size;col++){const x=center[0]-half+col*step,y=center[1]-half+row*step;points.push(metersToLngLat(this.originLon,this.originLat,x,y));}\n    this.terrainSyncPromise=(async()=>{const heights=await this.demSampler.sampleMany(points);if(heights.some(value=>!Number.isFinite(value)))throw Error("WORLD DEM grid has missing samples");let index=0;const snapshot=buildTerrainSnapshot({originElevationM:this.terrainOriginElevationM,center,halfExtentM:half,gridSize:size,sampleMsl:()=>heights[index++]});if(!snapshot)throw Error("WORLD DEM snapshot build failed");this.terrainSnapshot=snapshot;this.terrainCollisionSink(snapshot);this.terrainLastCenter=center;this.terrainLastSyncMs=performance.now();this.terrainRevisions++;this.buildingCollisionDirty=true;const viewport=$("viewport");if(viewport){viewport.dataset.worldTerrainStatus="box3d-active";viewport.dataset.worldTerrainTriangles=String(snapshot.indices.length/3);viewport.dataset.worldTerrainRangeM=(snapshot.maxZ-snapshot.minZ).toFixed(3);viewport.dataset.worldTerrainRevision=String(this.terrainRevisions);}return true;})().catch(error=>{const viewport=$("viewport");if(viewport)viewport.dataset.worldTerrainStatus="error";console.warn("WORLD DEM physics sync failed:",error);return false;}).finally(()=>{this.terrainSyncPromise=null;});return this.terrainSyncPromise;\n  }\n  async waitForBuildingCollisionData(timeoutMs=12000){if(!this.map||!this.buildingSourceId)throw Error("WORLD building vector source unavailable");const started=performance.now();while(performance.now()-started<timeoutMs){let loaded=false;try{loaded=this.map.isSourceLoaded?.(this.buildingSourceId)===true;}catch{}if(loaded){this.buildingCollisionDirty=true;this.syncBuildingCollisions(true);return true;}await new Promise(resolve=>setTimeout(resolve,120));}throw Error("WORLD building vector tiles did not become ready");}\n  relocateSafeSpawn({mode="initial",around=null,seed=1}={}){if(typeof this.safeSpawnResolver!=="function"||typeof this.spawnApplySink!=="function")return null;const airframe=this.airframeFor(this.threeScene),anchor=Array.isArray(around)?around:[Number(airframe?.position?.x)||0,Number(airframe?.position?.y)||0,Number(airframe?.position?.z)||0],resolved=this.safeSpawnResolver({around:anchor,mode,seed});const viewport=$("viewport");if(!resolved){if(viewport){viewport.dataset.worldSpawnSafe="0";viewport.dataset.worldSpawnMode=mode;}return null;}const yaw=mode==="respawn"?((Number(seed)>>>0)%360):0;this.spawnApplySink({x:resolved.x,y:resolved.y,z:resolved.z,yaw_deg:yaw});this.lastSafeSpawn=resolved;if(viewport){viewport.dataset.worldSpawnSafe="1";viewport.dataset.worldSpawnMode=mode;viewport.dataset.worldSpawnOffsetM=Number(resolved.offsetM||0).toFixed(3);viewport.dataset.worldSpawnGroundM=Number(resolved.groundZ||0).toFixed(3);if(mode==="respawn")viewport.dataset.vsLastRespawnOffsetM=Number(resolved.offsetM||0).toFixed(3);}return resolved;}\n'''
s = s[:idx] + terrain_methods + s[idx:]
p.write_text(s)
print('patched bridge terrain methods')

replace_block(
    'sim/real_world_bootstrap.mjs',
    '  clearBuildingCollisions(){',
    '  buildingCollisionFeatures(){',
    '''  clearBuildingCollisions(){\n    const snapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionSnapshot=snapshot;this.buildingCollisionDirty=true;this.buildingCollisionLastCenter=[Infinity,Infinity];this.buildingCollisionSink?.(snapshot);this.buildingVisualLayer?.clear?.();this.buildingVisualLayer?.setVisible?.(false);const viewport=$("viewport");if(viewport){viewport.dataset.worldBuildingCollisionStatus="inactive";viewport.dataset.worldBuildingCollisionFootprints="0";viewport.dataset.worldBuildingCollisionPrisms="0";viewport.dataset.worldBuildingVisualMeshes="0";}return snapshot;\n  }\n''',
    'bridge clear buildings',
)
replace_block(
    'sim/real_world_bootstrap.mjs',
    '  syncBuildingCollisions(force=false){',
    '  addBuildings(){',
    '''  syncBuildingCollisions(force=false){\n    if(!this.active||!this.map||!this.buildingCollisionSink||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat)||!this.terrainSnapshot)return false;const now=performance.now();if(!force&&now-this.buildingCollisionLastSyncMs<WORLD_BUILDING_COLLISION_SYNC_MS)return false;const airframe=this.airframeFor(this.threeScene),center=[Number(airframe?.position?.x)||0,Number(airframe?.position?.y)||0],moved=Math.hypot(center[0]-this.buildingCollisionLastCenter[0],center[1]-this.buildingCollisionLastCenter[1]);if(!force&&!this.buildingCollisionDirty&&moved<20)return false;this.buildingCollisionLastSyncMs=now;\n    const features=this.buildingCollisionFeatures();if(!features.length){let loaded=false;try{loaded=this.map.isSourceLoaded?.(this.buildingSourceId)===true;}catch{}const viewport=$("viewport");if(!loaded){if(viewport)viewport.dataset.worldBuildingCollisionStatus="waiting-for-vector-tiles";return false;}const snapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionSink(snapshot);this.buildingCollisionSnapshot=snapshot;this.buildingVisualLayer?.clear?.();this.buildingVisualLayer?.setVisible?.(true);this.buildingCollisionDirty=false;this.buildingCollisionLastCenter=center;if(viewport){viewport.dataset.worldBuildingCollisionStatus="no-nearby-buildings";viewport.dataset.worldBuildingVisualMeshes="0";}return true;}\n    let footprints=buildingFootprintsFromFeatures(features,{project:(longitude,latitude)=>lngLatToMeters(this.originLon,this.originLat,longitude,latitude),center});footprints=footprints.map(footprint=>{const terrain=terrainHeightAt(this.terrainSnapshot,footprint.center[0],footprint.center[1]);if(!Number.isFinite(terrain))return footprint;return{...footprint,base:Number(footprint.base)+terrain,top:Number(footprint.top)+terrain};});const hash=buildingFootprintHash(footprints);if(hash===this.buildingCollisionSnapshot.hash){this.buildingCollisionDirty=false;this.buildingCollisionLastCenter=center;this.buildingVisualLayer?.setVisible?.(true);return false;}\n    const prisms=buildingCollisionPrismsFromFootprints(footprints,(outer,holes)=>THREE.ShapeUtils.triangulateShape(outer.map(point=>new THREE.Vector2(...point)),holes.map(ring=>ring.map(point=>new THREE.Vector2(...point))))),snapshot=Object.freeze({hash,footprintCount:footprints.length,prismCount:prisms.length,prisms});this.buildingCollisionSink(snapshot);this.buildingCollisionSnapshot=snapshot;this.buildingVisualLayer?.update?.(footprints,hash);this.buildingVisualLayer?.setVisible?.(true);this.buildingCollisionDirty=false;this.buildingCollisionLastCenter=center;this.buildingCollisionRevisions++;const viewport=$("viewport");if(viewport){viewport.dataset.worldBuildingCollisionStatus=prisms.length?"box3d-active":"no-nearby-buildings";viewport.dataset.worldBuildingCollisionFootprints=String(footprints.length);viewport.dataset.worldBuildingCollisionPrisms=String(prisms.length);viewport.dataset.worldBuildingCollisionRevision=String(this.buildingCollisionRevisions);viewport.dataset.worldBuildingVisualMeshes=String(this.buildingVisualLayer?.meshCount||0);}return true;\n  }\n''',
    'bridge terrain-relative buildings',
)
replace_block(
    'sim/real_world_bootstrap.mjs',
    '  addBuildings(){',
    '  addVisualShotImpact(',
    '''  addBuildings(){\n    if(!this.map)return;const style=this.map.getStyle(),sourceId=Object.entries(style.sources||{}).find(([,source])=>source?.type==="vector")?.[0];if(!sourceId){console.warn("OpenFreeMap style has no vector source for buildings");return;}this.buildingSourceId=sourceId;this.buildingCollisionDirty=true;const existing=this.map.getLayer("arondight45-buildings-3d");if(existing)return;const before=(style.layers||[]).find(layer=>layer.type==="symbol")?.id,layer={id:"arondight45-buildings-3d",type:"fill",source:sourceId,"source-layer":"building",minzoom:14,paint:{"fill-color":"#ffffff","fill-opacity":0}};try{if(before)this.map.addLayer(layer,before);else this.map.addLayer(layer);}catch(error){console.warn("OpenFreeMap building query layer unavailable:",error);}\n  }\n''',
    'bridge building query layer',
)
replace_block(
    'sim/real_world_bootstrap.mjs',
    '  addVisualShotImpact(',
    '  async createMap(',
    '''  addVisualShotImpact(x,y,rect,ray){\n    if(!this.active||!ray?.origin||!ray?.direction)return null;const o=ray.origin,d=ray.direction;let bestT=Infinity,bestNx=0,bestNy=0,bestNz=1;const consider=(t,nx,ny,nz)=>{if(!(t>0)||t>=bestT||!Number.isFinite(t))return;const nLen=Math.hypot(nx,ny,nz)||1;nx/=nLen;ny/=nLen;nz/=nLen;if(nx*d.x+ny*d.y+nz*d.z>0){nx=-nx;ny=-ny;nz=-nz;}bestT=t;bestNx=nx;bestNy=ny;bestNz=nz;};this.worldShotQueries++;\n    for(const prism of this.buildingCollisionSnapshot?.prisms||[]){const ring=prism.points||[],base=Number(prism.base)||0,top=Number(prism.top)||0;if(ring.length<3)continue;if(Math.abs(d.z)>1e-7){const t=(top-o.z)/d.z,px=o.x+d.x*t,py=o.y+d.y*t;if(t>0&&t<bestT&&pointInRing(px,py,ring))consider(t,0,0,1);}for(let i=0,j=ring.length-1;i<ring.length;j=i++){const ax=ring[j][0],ay=ring[j][1],bx=ring[i][0],by=ring[i][1],sx=bx-ax,sy=by-ay,den=d.x*sy-d.y*sx;if(Math.abs(den)<1e-9)continue;const qpx=ax-o.x,qpy=ay-o.y,t=(qpx*sy-qpy*sx)/den,u=(qpx*d.y-qpy*d.x)/den;if(t<=0||t>=bestT||u<0||u>1)continue;const z=o.z+d.z*t;if(z<base-.02||z>top+.02)continue;consider(t,sy,-sx,0);}}\n    const terrain=raycastTerrainSnapshot(this.terrainSnapshot,o,d,1200);if(terrain&&terrain.distance<bestT)consider(terrain.distance,...terrain.normal);if(!Number.isFinite(bestT))return null;this.worldShotPoint.set(o.x+d.x*bestT,o.y+d.y*bestT,o.z+d.z*bestT);this.worldShotNormal.set(bestNx,bestNy,bestNz);const viewport=$("viewport");if(viewport)viewport.dataset.worldShotQueries=String(this.worldShotQueries);return this.worldShotHit;\n  }\n''',
    'bridge shot/beacon terrain ray',
)

replace_once('sim/real_world_bootstrap.mjs','this.applyFlightPalette();this.stripFlightClutter();this.addWorldImagery();','this.applyFlightPalette();this.stripFlightClutter();this.addWorldImagery();this.addTerrainPresentation();','bridge add DEM presentation')
replace_once('sim/real_world_bootstrap.mjs','attribution.textContent="Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community · Map © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors";','attribution.textContent="Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community · Terrain © Mapterhorn contributors · Map © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors";','bridge attribution')
replace_once('sim/real_world_bootstrap.mjs','const minimumDistance=fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM);let focusDistance=minimumDistance;if(!fpv&&dir.z<-.02&&p.z>0){const ground=-p.z/dir.z;','const minimumDistance=fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM);let focusDistance=minimumDistance;const terrainBelow=terrainHeightAt(this.terrainSnapshot,p.x,p.y);if(!fpv&&dir.z<-.02&&Number.isFinite(terrainBelow)&&p.z>terrainBelow){const ground=(terrainBelow-p.z)/dir.z;','bridge camera terrain focus')
replace_once('sim/real_world_bootstrap.mjs','if(typeof this.map.calculateCameraOptionsFromTo!=="function")throw Error("MapLibre eye/target camera API unavailable");const eye=metersToLngLat(this.originLon,this.originLat,p.x,p.y),options=this.map.calculateCameraOptionsFromTo(new LngLat(eye[0],eye[1]),p.z,new LngLat(center[0],center[1]),target.z),zoom=Number(options.zoom),view={...options,center,elevation:target.z,roll:clamp(roll,-85,85)};','if(typeof this.map.calculateCameraOptionsFromTo!=="function")throw Error("MapLibre eye/target camera API unavailable");const eye=metersToLngLat(this.originLon,this.originLat,p.x,p.y),datum=Number(this.terrainOriginElevationM)||0,eyeElevation=datum+p.z,targetElevation=datum+target.z,options=this.map.calculateCameraOptionsFromTo(new LngLat(eye[0],eye[1]),eyeElevation,new LngLat(center[0],center[1]),targetElevation),zoom=Number(options.zoom),view={...options,center,elevation:targetElevation,roll:clamp(roll,-85,85)};','bridge absolute MSL camera')
replace_once('sim/real_world_bootstrap.mjs','await this.createMap(longitude,latitude);this.active=true;this.loading=false;','await this.createMap(longitude,latitude);await this.initializeTerrainOrigin();this.active=true;','bridge activation DEM origin')
replace_once('sim/real_world_bootstrap.mjs','this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.buildingCollisionDirty=true;this.renderLookHud();this.syncBuildingCollisions(true);','this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.buildingCollisionDirty=true;this.renderLookHud();await this.syncTerrainPhysics(true);if(!this.terrainSnapshot)throw Error("REAL WORLD DEM physics unavailable");await this.waitForBuildingCollisionData();this.syncBuildingCollisions(true);const safeSpawn=this.relocateSafeSpawn({mode:"initial",around:[0,0,0],seed:1});if(!safeSpawn)throw Error("REAL WORLD has no safe ray-traced spawn near the GPS origin");this.loading=false;','bridge activation gates')
replace_once('sim/real_world_bootstrap.mjs','if(changed){this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.lastMapSyncFrameSerial=-1;this.lastViewportSize="";this.clearBuildingCollisions();this.map?.jumpTo?.({center:[next.lon,next.lat],zoom:19,pitch:55,bearing:0});this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;}','if(changed){this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.lastMapSyncFrameSerial=-1;this.lastViewportSize="";this.clearBuildingCollisions();this.clearTerrainPhysics();this.terrainOriginElevationM=null;this.map?.jumpTo?.({center:[next.lon,next.lat],zoom:19,pitch:55,bearing:0});this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;if(this.active)this.initializeTerrainOrigin().then(()=>this.syncTerrainPhysics(true)).then(()=>this.waitForBuildingCollisionData()).then(()=>{this.syncBuildingCollisions(true);this.relocateSafeSpawn({mode:"initial",around:[0,0,0],seed:2});}).catch(error=>console.warn("WORLD VS terrain re-anchor failed:",error));}','bridge VS terrain reanchor')
replace_once('sim/real_world_bootstrap.mjs','this.active=false;this.loading=false;this.lastMapSyncFrameSerial=-1;this.clearBuildingCollisions();this.resetLook(true);','this.active=false;this.loading=false;this.lastMapSyncFrameSerial=-1;this.clearBuildingCollisions();this.clearTerrainPhysics();this.terrainOriginElevationM=null;this.buildingVisualLayer?.setVisible?.(false);this.relocateSafeSpawn({mode:"initial",around:[0,0,0],seed:1});this.resetLook(true);','bridge deactivate terrain')
replace_once('sim/real_world_bootstrap.mjs','fail(error){this.loading=false;this.active=false;this.status(`REAL WORLD unavailable · ${error?.message||error}`,"bad");}','fail(error){this.loading=false;this.active=false;this.clearBuildingCollisions();this.clearTerrainPhysics();this.terrainOriginElevationM=null;this.buildingVisualLayer?.setVisible?.(false);this.status(`REAL WORLD unavailable · ${error?.message||error}`,"bad");}','bridge fail cleanup')
replace_once('sim/real_world_bootstrap.mjs','if(!this.active)return false;\n    this.syncBuildingCollisions();','if(!this.active)return false;\n    this.syncTerrainPhysics();\n    this.syncBuildingCollisions();','bridge runtime terrain sync')
replace_once('sim/real_world_bootstrap.mjs','if(killed){clearTimeout(this.vsRespawnTimer);this.vsRespawnTimer=setTimeout(()=>{if(!this.vsSession)return;this.vsLocalDead=false;this.vsLocalHealth=100;this.updateVsCombatHud(true);this.vsSession.sendCombat({type:"respawn",hp:100});},2200);}return;','if(killed){const airframe=this.airframeFor(this.threeScene),deathPosition=[Number(airframe?.position?.x)||0,Number(airframe?.position?.y)||0,Number(airframe?.position?.z)||0],baseSeed=(Date.now()^this.vsCombatSeq^Math.round(deathPosition[0]*31)^Math.round(deathPosition[1]*131))>>>0;clearTimeout(this.vsRespawnTimer);const attemptRespawn=attempt=>{if(!this.vsSession)return;const spawn=this.relocateSafeSpawn({mode:"respawn",around:deathPosition,seed:(baseSeed+attempt*0x9e3779b9)>>>0});if(!spawn){if(attempt<5)this.vsRespawnTimer=setTimeout(()=>attemptRespawn(attempt+1),600);return;}this.vsLocalDead=false;this.vsLocalHealth=100;this.updateVsCombatHud(true);this.vsSession.sendCombat({type:"respawn",hp:100,p:[spawn.x,spawn.y,spawn.z],offsetM:spawn.offsetM});};this.vsRespawnTimer=setTimeout(()=>attemptRespawn(0),2200);}return;','bridge offset combat respawn')
replace_once('sim/real_world_bootstrap.mjs','viewport.dataset.worldProvider="openfreemap-esri-imagery"','viewport.dataset.worldProvider="openfreemap-esri-mapterhorn-dem"','bridge provider diagnostic')

# Exercise the actual 2.2 s kill timer and relocation in the existing browser combat gate.
replace_once(
    'tests/vs_combat_browser_smoke.mjs',
    'const localDeath={hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,deaths:bridge.vsDeaths,respawnHud:document.querySelector("#vsRespawnHud")?.textContent||"",respawnHidden:Boolean(document.querySelector("#vsRespawnHud")?.hidden),respawnState:viewport.dataset.vsRespawnState||"",soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0,audioStartedCount:Number(viewport.dataset.vsExplosionAudioStartedCount)||0,audioState:viewport.dataset.vsExplosionAudioState||"",flashLocal:Boolean(document.querySelector("#vsExplosionFlash")?.classList.contains("local"))};\n    const dataset={hp:viewport.dataset.vsLocalHealth,mate:viewport.dataset.vsPeerHealth,kills:viewport.dataset.vsKills,deaths:viewport.dataset.vsDeaths};bridge.stopVs();return{hitOk,shot,markerBefore,localBeacon,remoteBeacon,staleHold,killed,peerRespawn,hpAfterFirst,hpAfterDuplicate,state,localDeath,dataset};',
    'const localDeathPosition=[own.position.x,own.position.y,own.position.z],localDeath={hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,deaths:bridge.vsDeaths,respawnHud:document.querySelector("#vsRespawnHud")?.textContent||"",respawnHidden:Boolean(document.querySelector("#vsRespawnHud")?.hidden),respawnState:viewport.dataset.vsRespawnState||"",soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0,audioStartedCount:Number(viewport.dataset.vsExplosionAudioStartedCount)||0,audioState:viewport.dataset.vsExplosionAudioState||"",flashLocal:Boolean(document.querySelector("#vsExplosionFlash")?.classList.contains("local"))};await sleep(2450);const respawnAirframe=bridge.airframeFor?.(bridge.threeScene)||bridge.airframe,localRespawnPosition=[respawnAirframe.position.x,respawnAirframe.position.y,respawnAirframe.position.z],respawnPacket=[...sent].reverse().find(p=>p.type==="respawn"),localRespawn={hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,offset:Math.hypot(localRespawnPosition[0]-localDeathPosition[0],localRespawnPosition[1]-localDeathPosition[1]),datasetOffset:Number(viewport.dataset.vsLastRespawnOffsetM),packet:respawnPacket||null};\n    const dataset={hp:viewport.dataset.vsLocalHealth,mate:viewport.dataset.vsPeerHealth,kills:viewport.dataset.vsKills,deaths:viewport.dataset.vsDeaths};bridge.stopVs();return{hitOk,shot,markerBefore,localBeacon,remoteBeacon,staleHold,killed,peerRespawn,hpAfterFirst,hpAfterDuplicate,state,localDeath,localRespawn,dataset};',
    'combat browser respawn sampling',
)
replace_once(
    'tests/vs_combat_browser_smoke.mjs',
    'if(result.localDeath.soundCount<2||result.localDeath.audioStartedCount<2||result.localDeath.audioState!=="running"||!result.localDeath.flashLocal)throw new Error(`local destruction audio/visual feedback missing: ${JSON.stringify(result.localDeath)}`);if(result.dataset.kills!=="1"||result.dataset.deaths!=="1")throw new Error(`combat score dataset failed: ${JSON.stringify(result.dataset)}`);',
    'if(result.localDeath.soundCount<2||result.localDeath.audioStartedCount<2||result.localDeath.audioState!=="running"||!result.localDeath.flashLocal)throw new Error(`local destruction audio/visual feedback missing: ${JSON.stringify(result.localDeath)}`);if(result.localRespawn.hp!==100||result.localRespawn.dead||result.localRespawn.offset<18||result.localRespawn.datasetOffset<18||result.localRespawn.packet?.type!=="respawn"||result.localRespawn.packet?.offsetM<18)throw new Error(`local physical safe respawn did not move away from death: ${JSON.stringify(result.localRespawn)}`);if(result.dataset.kills!=="1"||result.dataset.deaths!=="1")throw new Error(`combat score dataset failed: ${JSON.stringify(result.dataset)}`);',
    'combat browser respawn assertion',
)

print('WORLD integration patch complete')
