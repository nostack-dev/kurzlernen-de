from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1:
        raise SystemExit(f"{path}: expected one marker, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old,new,1))


def replace_between(path, start_marker, end_marker, replacement):
    p=Path(path); text=p.read_text(); start=text.find(start_marker)
    if start<0: raise SystemExit(f"{path}: start marker missing: {start_marker!r}")
    end=text.find(end_marker,start)
    if end<0: raise SystemExit(f"{path}: end marker missing: {end_marker!r}")
    p.write_text(text[:start]+replacement+text[end:])

# ---------------------------------------------------------------------------
# WORLD geometry must match real fill-extrusion solids, including holes.
# geometryPaths remains for minimap line rendering; shot geometry uses polygons.
# ---------------------------------------------------------------------------
replace_once(
    "sim/real_world_bootstrap.mjs",
    'function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1],cross=(yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi;if(cross)inside=!inside;}return inside;}\n',
    'function geometryPolygons(geometry){if(!geometry)return[];const c=geometry.coordinates||[];if(geometry.type==="Polygon")return c.length?[c]:[];if(geometry.type==="MultiPolygon")return c.filter(poly=>Array.isArray(poly)&&poly.length);return[];}\nfunction pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1],cross=(yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi;if(cross)inside=!inside;}return inside;}\nfunction pointInPolygon(x,y,rings){return Boolean(rings.length&&pointInRing(x,y,rings[0])&&!rings.slice(1).some(ring=>pointInRing(x,y,ring)));}\n',
)

# ---------------------------------------------------------------------------
# MapLibre 5.24 custom-layer lifecycle/render contract.
# Existing Mercator vertices are absolute and MUST survive a changed ENU origin.
# ---------------------------------------------------------------------------
replace_once(
    "sim/real_world_bootstrap.mjs",
    'constructor(originLon,originLat){this.id="arondight45-impact-decals";this.type="custom";this.renderingMode="3d";this.originLon=originLon;this.originLat=originLat;this.map=null;this.gl=null;this.program=null;this.buffer=null;this.aPos=-1;this.aUv=-1;this.uMatrix=null;this.vertices=new Float32Array(WORLD_IMPACT_POOL_SIZE*6*5);this.count=0;this.cursor=0;this.writes=0;this.dirty=true;this.lastImpact=null;}',
    'constructor(originLon,originLat){this.id="arondight45-impact-decals";this.type="custom";this.renderingMode="3d";this.originLon=originLon;this.originLat=originLat;this.map=null;this.gl=null;this.program=null;this.buffer=null;this.aPos=-1;this.aUv=-1;this.uMatrix=null;this.vertices=new Float32Array(WORLD_IMPACT_POOL_SIZE*6*5);this.count=0;this.cursor=0;this.writes=0;this.renderCalls=0;this.dirty=true;this.lastImpact=null;}',
)
replace_once(
    "sim/real_world_bootstrap.mjs",
    'setOrigin(lon,lat){if(this.originLon===lon&&this.originLat===lat)return;this.originLon=lon;this.originLat=lat;this.count=0;this.cursor=0;this.vertices.fill(0);this.dirty=true;this.lastImpact=null;}',
    'setOrigin(lon,lat){this.originLon=lon;this.originLat=lat;}',
)

p=Path("sim/real_world_bootstrap.mjs"); text=p.read_text()
on_add_start=text.find('  onAdd(map,gl){',text.find('class WorldImpactLayer'))
on_add_end=text.find('\n  addImpact(point,normal){',on_add_start)
if on_add_start<0 or on_add_end<=on_add_start: raise SystemExit('cannot isolate WorldImpactLayer.onAdd')
new_on_add='''  onAdd(map,gl){this.map=map;this.gl=gl;const webgl2=typeof WebGL2RenderingContext!=="undefined"&&gl instanceof WebGL2RenderingContext,vertexSource=webgl2?`#version 300 es\nin vec3 a_pos;in vec2 a_uv;uniform mat4 u_matrix;out vec2 v_uv;void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_pos,1.0);}`:`attribute vec3 a_pos;attribute vec2 a_uv;uniform mat4 u_matrix;varying vec2 v_uv;void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_pos,1.0);}`,fragmentSource=webgl2?`#version 300 es\nprecision mediump float;in vec2 v_uv;out vec4 outColor;void main(){float r=length(v_uv-vec2(.5));if(r>.5)discard;float edge=smoothstep(.30,.50,r);float alpha=1.0-smoothstep(.47,.50,r);vec3 color=mix(vec3(.018,.016,.014),vec3(.19,.15,.11),edge);outColor=vec4(color*alpha,alpha);}`:`precision mediump float;varying vec2 v_uv;void main(){float r=length(v_uv-vec2(.5));if(r>.5)discard;float edge=smoothstep(.30,.50,r);float alpha=1.0-smoothstep(.47,.50,r);vec3 color=mix(vec3(.018,.016,.014),vec3(.19,.15,.11),edge);gl_FragColor=vec4(color*alpha,alpha);}`,vertex=this.compile(gl,gl.VERTEX_SHADER,vertexSource),fragment=this.compile(gl,gl.FRAGMENT_SHADER,fragmentSource);this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(`WORLD impact program link failed: ${gl.getProgramInfoLog(this.program)||"unknown link error"}`);this.aPos=gl.getAttribLocation(this.program,"a_pos");this.aUv=gl.getAttribLocation(this.program,"a_uv");this.uMatrix=gl.getUniformLocation(this.program,"u_matrix");this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);this.dirty=true;}'''
p.write_text(text[:on_add_start]+new_on_add+text[on_add_end:])

p=Path("sim/real_world_bootstrap.mjs"); text=p.read_text()
render_start=text.find('  render(',text.find('class WorldImpactLayer'))
render_end=text.find('\n  onRemove(',render_start)
if render_start<0 or render_end<=render_start: raise SystemExit('cannot isolate WorldImpactLayer.render')
new_render='''  render(glOrContext,inputLegacy){const gl=glOrContext?.gl||glOrContext,input=glOrContext?.gl?glOrContext:inputLegacy,matrix=input?.modelViewProjectionMatrix||input?.defaultProjectionData?.mainMatrix||(input&&typeof input.length==="number"&&input.length===16?input:null);if(!gl||!matrix||!this.program||!this.buffer||!this.count)return;gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);if(this.dirty){gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices);this.dirty=false;}const stride=5*4;gl.enableVertexAttribArray(this.aPos);gl.vertexAttribPointer(this.aPos,3,gl.FLOAT,false,stride,0);gl.enableVertexAttribArray(this.aUv);gl.vertexAttribPointer(this.aUv,2,gl.FLOAT,false,stride,3*4);gl.uniformMatrix4fv(this.uMatrix,false,matrix);const oldDepthMask=gl.getParameter(gl.DEPTH_WRITEMASK),oldDepthFunc=gl.getParameter(gl.DEPTH_FUNC);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.depthFunc(gl.LEQUAL);gl.drawArrays(gl.TRIANGLES,0,this.count*6);gl.depthMask(oldDepthMask);gl.depthFunc(oldDepthFunc);this.renderCalls++;const viewport=$("viewport");if(viewport)viewport.dataset.worldImpactRenderCalls=String(this.renderCalls);}'''
p.write_text(text[:render_start]+new_render+text[render_end:])

# Missing custom layer means mapDecal=false and THREE fallback; never silently
# write into a CPU layer that MapLibre is not actually rendering.
replace_between(
    "sim/real_world_bootstrap.mjs",
    '  installImpactLayer(){',
    '\n  addVisualShotImpact(',
    '''  installImpactLayer(){\n    if(!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return false;if(!this.worldImpactLayer)this.worldImpactLayer=new WorldImpactLayer(this.originLon,this.originLat);else this.worldImpactLayer.setOrigin(this.originLon,this.originLat);if(this.map.getLayer(this.worldImpactLayer.id))return true;const style=this.map.getStyle(),before=(style.layers||[]).find(layer=>layer.type==="symbol")?.id;try{if(before)this.map.addLayer(this.worldImpactLayer,before);else this.map.addLayer(this.worldImpactLayer);const viewport=$("viewport");if(viewport){viewport.dataset.worldImpactPoolSize=String(WORLD_IMPACT_POOL_SIZE);viewport.dataset.worldImpactDepth="maplibre-3d";}return true;}catch(error){console.warn("WORLD impact depth layer unavailable:",error);try{if(this.map.getLayer(this.worldImpactLayer.id))this.map.removeLayer(this.worldImpactLayer.id);}catch{}return false;}\n  }''',
)
replace_once(
    "sim/real_world_bootstrap.mjs",
    'this.worldShotHit.mapDecal=false;if(this.worldImpactLayer){this.worldShotHit.mapDecal=this.worldImpactLayer.addImpact(this.worldShotPoint,this.worldShotNormal);if(this.worldShotHit.mapDecal)this.worldImpactWrites=this.worldImpactLayer.writes;}',
    'this.worldShotHit.mapDecal=false;if(this.worldImpactLayer&&this.map.getLayer(this.worldImpactLayer.id)){this.worldShotHit.mapDecal=this.worldImpactLayer.addImpact(this.worldShotPoint,this.worldShotNormal);if(this.worldShotHit.mapDecal)this.worldImpactWrites=this.worldImpactLayer.writes;}',
)

# Replace only the building intersection body. Polygon holes are void for roof /
# underside tests, but every ring contributes a vertical wall surface.
p=Path("sim/real_world_bootstrap.mjs"); text=p.read_text()
start=text.find('      if(this.map.getLayer("arondight45-buildings-3d")){',text.find('  addVisualShotImpact('))
end=text.find('\n    }catch(error){',start)
if start<0 or end<=start: raise SystemExit('cannot isolate WORLD building intersection block')
new_build='''      if(this.map.getLayer("arondight45-buildings-3d")){this.worldShotQueries++;const qx=clamp(Number(x)||0,0,Math.max(1,rect.width)),qy=clamp(Number(y)||0,0,Math.max(1,rect.height)),features=this.map.queryRenderedFeatures([qx,qy],{layers:["arondight45-buildings-3d"]});for(const feature of features){const top=clamp(Number(feature.properties?.render_height??feature.properties?.height??8)||8,.5,300),base=clamp(Number(feature.properties?.render_min_height??feature.properties?.min_height??0)||0,0,top);for(const polygon of geometryPolygons(feature.geometry)){const rings=polygon.map(path=>path.map(point=>lngLatToMeters(this.originLon,this.originLat,Number(point[0]),Number(point[1]))).filter(point=>point.every(Number.isFinite))).filter(ring=>ring.length>=3);if(!rings.length)continue;if(Math.abs(d.z)>1e-7){const roofT=(top-o.z)/d.z,roofX=o.x+d.x*roofT,roofY=o.y+d.y*roofT;if(roofT>0&&roofT<bestT&&pointInPolygon(roofX,roofY,rings))consider(roofT,0,0,1);if(base>.02){const baseT=(base-o.z)/d.z,baseX=o.x+d.x*baseT,baseY=o.y+d.y*baseT;if(baseT>0&&baseT<bestT&&pointInPolygon(baseX,baseY,rings))consider(baseT,0,0,-1);}}for(const ring of rings){for(let i=0,j=ring.length-1;i<ring.length;j=i++){const ax=ring[j][0],ay=ring[j][1],bx=ring[i][0],by=ring[i][1],sx=bx-ax,sy=by-ay,den=d.x*sy-d.y*sx;if(Math.abs(den)<1e-9)continue;const qpx=ax-o.x,qpy=ay-o.y,t=(qpx*sy-qpy*sx)/den,u=(qpx*d.y-qpy*d.x)/den;if(t<=0||t>=bestT||u<0||u>1)continue;const z=o.z+d.z*t;if(z<base-.02||z>top+.02)continue;consider(t,sy,-sx,0);}}}}}'''
p.write_text(text[:start]+new_build+text[end:])

# Prefer Three's raycast intersection normal when available; face.normal remains
# the compatibility fallback. Avoid double-transform by detecting the newer field.
replace_once(
    "sim/flight_fire_fx.mjs",
    'if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit?.face?.normal||!hit.object)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}',
    'if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit.object)return false;if(hit.normal)hitNormal.copy(hit.normal).normalize();else{if(!hit?.face?.normal)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}}',
)

# ---------------------------------------------------------------------------
# Deterministic release fixtures: holes, inner wall, underside, real draw call,
# GL re-add persistence and GPS-origin persistence.
# ---------------------------------------------------------------------------
p=Path("tests/world_shot_decal_smoke.mjs"); text=p.read_text()
geo_start=text.find('  const geometry=await page.evaluate(()=>{')
geo_end=text.find('\n\n  const near=',geo_start)
if geo_start<0 or geo_end<=geo_start: raise SystemExit('cannot isolate WORLD geometry fixture')
new_geo='''  const geometry=await page.evaluate(()=>{\n    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect(),map=b.map;\n    const originalGetLayer=map.getLayer.bind(map),originalQuery=map.queryRenderedFeatures.bind(map);\n    const R=6378137,cosLat=Math.max(.01,Math.cos(b.originLat*Math.PI/180));\n    const ll=(east,north)=>[b.originLon+(east/(R*cosLat))*180/Math.PI,b.originLat+(north/R)*180/Math.PI];\n    const outer=[ll(-5,-5),ll(5,-5),ll(5,5),ll(-5,5),ll(-5,-5)],hole=[ll(-2,-2),ll(-2,2),ll(2,2),ll(2,-2),ll(-2,-2)];\n    const building={properties:{render_height:10,render_min_height:0},geometry:{type:"Polygon",coordinates:[outer,hole]}},raised={properties:{render_height:10,render_min_height:3},geometry:{type:"Polygon",coordinates:[outer,hole]}};\n    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;\n    try{\n      map.getLayer=id=>id==="arondight45-buildings-3d"?{id}:originalGetLayer(id);\n      map.queryRenderedFeatures=()=>[building];\n      const wall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));\n      const roof=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:3,y:0,z:20},direction:{x:0,y:0,z:-1}}));\n      const courtyard=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:20},direction:{x:0,y:0,z:-1}}));\n      const innerWall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:5},direction:{x:1,y:0,z:0}}));\n      map.queryRenderedFeatures=()=>[raised];\n      const underside=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:3,y:0,z:1},direction:{x:0,y:0,z:1}}));\n      map.getLayer=id=>id==="arondight45-buildings-3d"?null:originalGetLayer(id);\n      map.queryRenderedFeatures=()=>[];\n      const first=b.addVisualShotImpact(100,100,rect,{origin:{x:2,y:3,z:12},direction:{x:0,y:0,z:-1}}),firstRef=first,ground=snap(first);\n      const second=b.addVisualShotImpact(100,100,rect,{origin:{x:-1,y:4,z:7},direction:{x:0,y:0,z:-1}});\n      return{wall,roof,courtyard,innerWall,underside,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};\n    }finally{map.getLayer=originalGetLayer;map.queryRenderedFeatures=originalQuery;}\n  });'''
p.write_text(text[:geo_start]+new_geo+text[geo_end:])

replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'if(!geometry.roof||!near(geometry.roof.point.x,0,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)\n    throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);',
    'if(!geometry.roof||!near(geometry.roof.point.x,3,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);\n  if(!geometry.courtyard||!near(geometry.courtyard.point.x,0,.03)||!near(geometry.courtyard.point.y,0,.03)||!near(geometry.courtyard.point.z,0,.03)||geometry.courtyard.normal.z<.98)throw new Error(`WORLD courtyard hole was falsely treated as roof: ${JSON.stringify(geometry)}`);\n  if(!geometry.innerWall||!near(geometry.innerWall.point.x,2,.03)||!near(geometry.innerWall.point.y,0,.03)||!near(geometry.innerWall.point.z,5,.03)||geometry.innerWall.normal.x>-.98)throw new Error(`WORLD courtyard inner wall was not hittable: ${JSON.stringify(geometry)}`);\n  if(!geometry.underside||!near(geometry.underside.point.x,3,.03)||!near(geometry.underside.point.y,0,.03)||!near(geometry.underside.point.z,3,.03)||geometry.underside.normal.z>-.98)throw new Error(`WORLD elevated extrusion underside was not hittable: ${JSON.stringify(geometry)}`);',
)

# Make actual custom-layer rendering (not merely addImpact geometry) observable.
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const before=Number(v.dataset.fireWorldHits||0),mapBefore=Number(v.dataset.worldImpactWrites||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:501,pointerType:"touch",clientX:x,clientY:y,button:0}));\n    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));const last=b.worldImpactLayer?.lastImpact,projected=point.clone().project(cam);\n    const result={before,after:Number(v.dataset.fireWorldHits||0),mapBefore,mapAfter:Number(v.dataset.worldImpactWrites||0),impact,last,layer:{exists:Boolean(b.map.getLayer("arondight45-impact-decals")),mode:b.worldImpactLayer?.renderingMode,pool:Number(v.dataset.worldImpactPoolSize||0),depth:v.dataset.worldImpactDepth},projected:{x:projected.x,y:projected.y}};',
    'const before=Number(v.dataset.fireWorldHits||0),mapBefore=Number(v.dataset.worldImpactWrites||0),renderBefore=Number(b.worldImpactLayer?.renderCalls||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:501,pointerType:"touch",clientX:x,clientY:y,button:0}));\n    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");for(let i=0;i<60&&Number(b.worldImpactLayer?.renderCalls||0)<=renderBefore;i++)await new Promise(requestAnimationFrame);const last=b.worldImpactLayer?.lastImpact,projected=point.clone().project(cam);\n    const result={before,after:Number(v.dataset.fireWorldHits||0),mapBefore,mapAfter:Number(v.dataset.worldImpactWrites||0),renderBefore,renderAfter:Number(b.worldImpactLayer?.renderCalls||0),impact,last,layer:{exists:Boolean(b.map.getLayer("arondight45-impact-decals")),mode:b.worldImpactLayer?.renderingMode,pool:Number(v.dataset.worldImpactPoolSize||0),depth:v.dataset.worldImpactDepth},projected:{x:projected.x,y:projected.y}};',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'if(worldVisual.after!==worldVisual.before+1||worldVisual.mapAfter!==worldVisual.mapBefore+1||worldVisual.impact?.kind!=="world"||!worldVisual.last||!worldVisual.layer.exists||worldVisual.layer.mode!=="3d"||worldVisual.layer.pool!==32||worldVisual.layer.depth!=="maplibre-3d"||Math.abs(worldVisual.projected.x)>.01||Math.abs(worldVisual.projected.y)>.01||!near(worldVisual.last.point.x,worldVisual.impact.point.x,.001)||!near(worldVisual.last.point.y,worldVisual.impact.point.y,.001)||!near(worldVisual.last.point.z,worldVisual.impact.point.z,.001))',
    'if(worldVisual.after!==worldVisual.before+1||worldVisual.mapAfter!==worldVisual.mapBefore+1||worldVisual.renderAfter<=worldVisual.renderBefore||worldVisual.impact?.kind!=="world"||!worldVisual.last||!worldVisual.layer.exists||worldVisual.layer.mode!=="3d"||worldVisual.layer.pool!==32||worldVisual.layer.depth!=="maplibre-3d"||Math.abs(worldVisual.projected.x)>.01||Math.abs(worldVisual.projected.y)>.01||!near(worldVisual.last.point.x,worldVisual.impact.point.x,.001)||!near(worldVisual.last.point.y,worldVisual.impact.point.y,.001)||!near(worldVisual.last.point.z,worldVisual.impact.point.z,.001))',
)

# Remove/re-add custom layer to force new GPU resources. CPU impact pool must stay.
reactivation_start='''  await page.click("#soloWorld");\n  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMode==="training",{timeout:5000});\n  await page.setGeolocation({latitude:39.570600,longitude:2.651200,accuracy:4});\n'''
if reactivation_start not in p.read_text(): raise SystemExit('reactivation block anchor missing')
pre='''  const gpuReadd=await page.evaluate(async()=>{const b=globalThis.__arondightRealWorld,id="arondight45-impact-decals",layer=b.worldImpactLayer,before={count:layer.count,writes:layer.writes,renderCalls:layer.renderCalls,vertices:Array.from(layer.vertices.slice(0,30))};b.map.removeLayer(id);const installed=b.installImpactLayer();b.map.triggerRepaint();for(let i=0;i<60&&layer.renderCalls<=before.renderCalls;i++)await new Promise(requestAnimationFrame);return{installed,same:b.worldImpactLayer===layer,count:layer.count,writes:layer.writes,renderCalls:layer.renderCalls,vertices:Array.from(layer.vertices.slice(0,30)),exists:Boolean(b.map.getLayer(id))};});\n  if(!gpuReadd.installed||!gpuReadd.same||!gpuReadd.exists||gpuReadd.count!==worldVisual.mapAfter||gpuReadd.writes!==worldVisual.mapAfter||gpuReadd.renderCalls<=worldVisual.renderAfter)throw new Error(`WORLD impact pool did not survive custom-layer GPU re-add: ${JSON.stringify(gpuReadd)}`);\n\n  const persistBefore=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,l=b.worldImpactLayer;return{count:l.count,writes:l.writes,vertices:Array.from(l.vertices.slice(0,30))};});\n'''+reactivation_start
p.write_text(p.read_text().replace(reactivation_start,pre,1))
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const reactivated=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");return{originLat:b.originLat,originLon:b.originLon,layerLat:b.worldImpactLayer?.originLat,layerLon:b.worldImpactLayer?.originLon,count:b.worldImpactLayer?.count,exists:Boolean(b.map.getLayer("arondight45-impact-decals")),pool:Number(v.dataset.worldImpactPoolSize||0)};});\n  if(!reactivated.exists||reactivated.pool!==32||reactivated.count!==0||!near(reactivated.originLat,reactivated.layerLat,1e-9)||!near(reactivated.originLon,reactivated.layerLon,1e-9))throw new Error(`WORLD impact layer did not rebase cleanly after GPS reactivation: ${JSON.stringify(reactivated)}`);',
    'const reactivated=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),l=b.worldImpactLayer;return{originLat:b.originLat,originLon:b.originLon,layerLat:l?.originLat,layerLon:l?.originLon,count:l?.count,writes:l?.writes,vertices:Array.from(l?.vertices?.slice(0,30)||[]),exists:Boolean(b.map.getLayer("arondight45-impact-decals")),pool:Number(v.dataset.worldImpactPoolSize||0)};});\n  if(!reactivated.exists||reactivated.pool!==32||reactivated.count!==persistBefore.count||reactivated.writes!==persistBefore.writes||JSON.stringify(reactivated.vertices)!==JSON.stringify(persistBefore.vertices)||!near(reactivated.originLat,reactivated.layerLat,1e-9)||!near(reactivated.originLon,reactivated.layerLon,1e-9))throw new Error(`WORLD impacts were erased or moved by GPS reactivation: before=${JSON.stringify(persistBefore)} after=${JSON.stringify(reactivated)}`);',
)

# ---------------------------------------------------------------------------
# Static invariants must catch all reviewed regressions before browser launch.
# ---------------------------------------------------------------------------
p=Path("tests/architecture_invariants.mjs"); text=p.read_text()
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","this.vertices.fill(0)"])requireText("sim/real_world_bootstrap.mjs",marker);',
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","defaultProjectionData?.mainMatrix","worldImpactRenderCalls","geometryPolygons","pointInPolygon","consider(baseT,0,0,-1)"])requireText("sim/real_world_bootstrap.mjs",marker);\nforbidText("sim/real_world_bootstrap.mjs","this.vertices.fill(0)","changing GPS origin must not erase absolute-Mercator WORLD impact history");',
)
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))"])requireText("sim/flight_fire_fx.mjs",marker);',
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))","if(hit.normal)hitNormal.copy(hit.normal)"])requireText("sim/flight_fire_fx.mjs",marker);',
)

# Documentation: state the physical acknowledgement contract precisely.
p=Path("REAL_WORLD_DIGITAL_TWIN.md"); text=p.read_text()
needle='MapLibre custom 3D layer'
if needle not in text: raise SystemExit('digital twin WORLD impact marker missing')
if 'polygon holes / courtyards' not in text:
    text += '\n- WORLD impact geometry respects polygon holes / courtyards, vertical inner walls and non-zero extrusion bases; changing GPS origin does not erase already-authored absolute-Mercator impact marks.\n'
p.write_text(text)

print('final map impact render/geometry hardening applied')
