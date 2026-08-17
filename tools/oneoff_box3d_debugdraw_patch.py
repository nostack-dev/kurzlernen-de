from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one patch target, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


replace_one(
    "sim/control_settings.mjs",
    'export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{},debugGrid=null,xboxControllerToggle=false}={}){',
    'export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{},debugGrid=null,box3dColliderDebug=null,xboxControllerToggle=false}={}){',
)
replace_one(
    "sim/control_settings.mjs",
    '    ${debugGrid?\'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>\':\'\'}',
    '    ${debugGrid?\'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>\':\'\'}\n    ${box3dColliderDebug?\'<label class="phone-settings-toggle"><span>BOX3D COLLIDER DEBUG DRAW</span><input data-box3d-collider-debug type="checkbox"></label><p class="phone-settings-note">OFF by default. Draws the active Box3D airframe, ground reference and WORLD building collision geometry as a render-only wire overlay; it never changes collision, sensors, FC state or physics.</p>\':\'\'}',
)
replace_one(
    "sim/control_settings.mjs",
    'debugGridInput=dialog.querySelector("[data-debug-grid]");',
    'debugGridInput=dialog.querySelector("[data-debug-grid]"),box3dColliderDebugInput=dialog.querySelector("[data-box3d-collider-debug]");',
)
replace_one(
    "sim/control_settings.mjs",
    'if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());',
    'if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());if(box3dColliderDebugInput)box3dColliderDebugInput.checked=Boolean(box3dColliderDebug?.get?.());',
)
replace_one(
    "sim/control_settings.mjs",
    'if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});',
    'if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});if(box3dColliderDebugInput)box3dColliderDebugInput.addEventListener("change",()=>{box3dColliderDebug?.set?.(box3dColliderDebugInput.checked);render();});',
)
replace_one(
    "sim/control_settings.mjs",
    'dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);debugGrid?.set?.(Boolean(debugGrid?.defaultValue));render();onChange({...settings});};',
    'dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);debugGrid?.set?.(Boolean(debugGrid?.defaultValue));box3dColliderDebug?.set?.(Boolean(box3dColliderDebug?.defaultValue));render();onChange({...settings});};',
)

replace_one(
    "sim/world_building_collision_physics.mjs",
    'const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,...snapshot};',
    'const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze([]),...snapshot};',
)
replace_one(
    "sim/world_building_collision_physics.mjs",
    'shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:collisionMask,groupIndex:0};let shapeCount=0,skippedLaunchPrisms=0;',
    'shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:collisionMask,groupIndex:0};let shapeCount=0,skippedLaunchPrisms=0;const activePrisms=[];',
)
replace_one(
    "sim/world_building_collision_physics.mjs",
    'const vertices=[];for(const height of [prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}',
    'const vertices=[];for(const height of [prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;activePrisms.push(prism);}finally{b3.b3DestroyHull(hull);}',
)
replace_one(
    "sim/world_building_collision_physics.mjs",
    'if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,skippedLaunchPrisms,skippedLaunchBuildings,...snapshot};}return{body,shapeCount,skippedLaunchPrisms,skippedLaunchBuildings,...snapshot};',
    'if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze([]),...snapshot};}return{body,shapeCount,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze(activePrisms.slice()),...snapshot};',
)

replace_one(
    "sim/simulator.mjs",
    'import {normalizeBuildingCollisionSnapshot,createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies} from "./world_building_collision_physics.mjs";',
    'import {normalizeBuildingCollisionSnapshot,createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies} from "./world_building_collision_physics.mjs";\nimport {Box3dColliderDebugDraw} from "./box3d_collider_debug.mjs";',
)
replace_one(
    "sim/simulator.mjs",
    'const DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1";',
    'const DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1";\nconst BOX3D_COLLIDER_DEBUG_STORAGE = "arondight45Box3dColliderDebugV1";',
)
replace_one(
    "sim/simulator.mjs",
    'let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});\nglobalThis.__arondightRealWorld?.attachBuildingCollisionSink?.(snapshot=>physics.setWorldBuildingCollisions(snapshot));',
    '''let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});
const box3dColliderDebugDraw=new Box3dColliderDebugDraw(scene);
let box3dColliderDebugEnabled=false;try{box3dColliderDebugEnabled=localStorage.getItem(BOX3D_COLLIDER_DEBUG_STORAGE)==="1";}catch{}
function setBox3dColliderDebugEnabled(enabled){
  box3dColliderDebugEnabled=Boolean(enabled);box3dColliderDebugDraw.setEnabled(box3dColliderDebugEnabled);const viewport=$("viewport");if(viewport){viewport.dataset.box3dColliderDebugDraw=box3dColliderDebugEnabled?"1":"0";viewport.dataset.box3dColliderDebugPrisms=box3dColliderDebugEnabled?String(box3dColliderDebugDraw.activePrismCount):"0";}try{localStorage.setItem(BOX3D_COLLIDER_DEBUG_STORAGE,box3dColliderDebugEnabled?"1":"0");}catch{}return box3dColliderDebugEnabled;
}
setBox3dColliderDebugEnabled(box3dColliderDebugEnabled);
globalThis.__arondightRealWorld?.attachBuildingCollisionSink?.(snapshot=>physics.setWorldBuildingCollisions(snapshot));''',
)
replace_one(
    "sim/simulator.mjs",
    '  debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false},',
    '  debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false},\n  box3dColliderDebug:{get:()=>box3dColliderDebugEnabled,set:setBox3dColliderDebugEnabled,defaultValue:false},',
)
replace_one(
    "sim/simulator.mjs",
    '  worldBuildingCollisionRevision:{get:()=>physics.worldBuildingCollisionRevision,enumerable:true},',
    '  worldBuildingCollisionRevision:{get:()=>physics.worldBuildingCollisionRevision,enumerable:true},\n  box3dColliderDebugEnabled:{get:()=>box3dColliderDebugEnabled,enumerable:true},\n  box3dColliderDebugPrisms:{get:()=>box3dColliderDebugEnabled?box3dColliderDebugDraw.activePrismCount:0,enumerable:true},',
)
replace_one(
    "sim/simulator.mjs",
    'const presentationPose=physics.presentationPose(presentationAlpha);physics.render(presentationPose,presentationDt);updateCamera(presentationPose,renderNow);',
    'const presentationPose=physics.presentationPose(presentationAlpha);physics.render(presentationPose,presentationDt);box3dColliderDebugDraw.syncAirframe(physics.motorPos,AIRFRAME_COLLISION_HALF_Z_M);box3dColliderDebugDraw.syncWorld(physics.worldBuildingCollisionState,physics.worldBuildingCollisionRevision);box3dColliderDebugDraw.updateAirframe(presentationPose);const box3dDebugViewport=$("viewport");if(box3dDebugViewport&&box3dColliderDebugEnabled)box3dDebugViewport.dataset.box3dColliderDebugPrisms=String(box3dColliderDebugDraw.activePrismCount);updateCamera(presentationPose,renderNow);',
)

replace_one(
    "tests/world_building_collision_box3d_test.mjs",
    'assert.equal(buildings.shapeCount,1);assert.equal(buildings.prismCount,3);assert.equal(buildings.skippedLaunchPrisms,2);assert.equal(buildings.skippedLaunchBuildings,1);assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));',
    'assert.equal(buildings.shapeCount,1);assert.equal(buildings.prismCount,3);assert.equal(buildings.skippedLaunchPrisms,2);assert.equal(buildings.skippedLaunchBuildings,1);assert.equal(buildings.activePrisms.length,1);assert.equal(buildings.activePrisms[0].buildingKey,"house");assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));',
)

replace_one(
    "tests/world_building_collision_browser_smoke.mjs",
    'if(!installed.changed||installed.status!=="box3d-active"||installed.footprints!==2||installed.prisms!==9||installed.physicsPrisms!==9)throw new Error(`OSM → bridge → Box3D installation failed: ${JSON.stringify(installed)}`);',
    '''if(!installed.changed||installed.status!=="box3d-active"||installed.footprints!==2||installed.prisms!==9||installed.physicsPrisms!==9)throw new Error(`OSM → bridge → Box3D installation failed: ${JSON.stringify(installed)}`);
  const debugDefault=await page.evaluate(()=>({enabled:globalThis.__arondightDiagnostics.box3dColliderDebugEnabled,prisms:globalThis.__arondightDiagnostics.box3dColliderDebugPrisms,dataset:document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw,toggle:document.querySelector("[data-box3d-collider-debug]")?.checked,stored:localStorage.getItem("arondight45Box3dColliderDebugV1")}));
  if(debugDefault.enabled!==false||debugDefault.prisms!==0||debugDefault.dataset!=="0"||debugDefault.toggle!==false||debugDefault.stored!=="0")throw new Error(`Box3D collider debug draw is not default OFF: ${JSON.stringify(debugDefault)}`);
  await page.evaluate(()=>{const toggle=document.querySelector("[data-box3d-collider-debug]");if(!toggle)throw new Error("Box3D collider debug toggle missing");toggle.checked=true;toggle.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.waitForFunction(()=>globalThis.__arondightDiagnostics.box3dColliderDebugEnabled===true&&globalThis.__arondightDiagnostics.box3dColliderDebugPrisms===9&&document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw==="1",{timeout:5000});
  const debugOn=await page.evaluate(()=>({enabled:globalThis.__arondightDiagnostics.box3dColliderDebugEnabled,prisms:globalThis.__arondightDiagnostics.box3dColliderDebugPrisms,stored:localStorage.getItem("arondight45Box3dColliderDebugV1")}));
  if(!debugOn.enabled||debugOn.prisms!==9||debugOn.stored!=="1")throw new Error(`Box3D collider debug draw did not expose active collision prisms: ${JSON.stringify(debugOn)}`);
  await page.evaluate(()=>{const toggle=document.querySelector("[data-box3d-collider-debug]");toggle.checked=false;toggle.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.waitForFunction(()=>globalThis.__arondightDiagnostics.box3dColliderDebugEnabled===false&&document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw==="0",{timeout:5000});''',
)
