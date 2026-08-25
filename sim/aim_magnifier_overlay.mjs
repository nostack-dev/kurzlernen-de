const MAGNIFIER_SIZE_CSS=148;
const MAGNIFIER_ZOOM=2.25;
const MAX_DEVICE_PIXEL_RATIO=2;
const DRAW_INTERVAL_MS=1000/30;
const EDGE_PAD_CSS=10;
const HUD_TOP_PAD_CSS=78;
const FINGER_GAP_CSS=34;

let installed=false,active=false,clientX=0,clientY=0,lastDrawMs=-Infinity,root=null,canvas=null,ctx=null;
let hookedScene=null,previousSceneAfterRender=null,sceneAfterRenderHook=null;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const bridge=()=>globalThis.__arondightRealWorld||null;
const isFoot=()=>walk()?.mode==="foot"&&!walk()?.dead;

function logicalPoint(x,y){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(Number(x))?Number(x):screen.left+screen.width/2,cy=Number.isFinite(Number(y))?Number(y):screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape";
  const px=rotated?cy-screen.top:cx-screen.left,py=rotated?screen.right-cx:cy-screen.top;
  return{x:clamp(px,0,width),y:clamp(py,0,height),width,height};
}

function ensureStyle(){
  if(document.querySelector("style[data-foot-aim-magnifier]"))return;
  const style=document.createElement("style");style.dataset.footAimMagnifier="custom-v1";style.textContent=`
    #footLookZone,#footLookZone *,#footReticle,#viewport canvas{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}
    #footLookZone{touch-action:none!important}
    #footAimMagnifier{position:absolute;z-index:10025;width:${MAGNIFIER_SIZE_CSS}px;height:${MAGNIFIER_SIZE_CSS}px;border-radius:50%;overflow:hidden;pointer-events:none;display:none;box-sizing:border-box;border:2px solid rgba(255,221,151,.88);background:rgba(5,13,22,.92);box-shadow:0 10px 28px rgba(0,0,0,.48),0 0 0 1px rgba(108,214,255,.22),inset 0 0 22px rgba(32,116,164,.18);transform:translateZ(0);contain:strict;-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
    #footAimMagnifier.active{display:block}
    #footAimMagnifier canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
    #footAimMagnifier .aim-mag-vignette{position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 18px rgba(0,0,0,.36);pointer-events:none}
    #footAimMagnifier .aim-mag-crosshair::before,#footAimMagnifier .aim-mag-crosshair::after{content:"";position:absolute;left:50%;top:50%;background:rgba(255,225,164,.96);box-shadow:0 0 4px rgba(0,0,0,.8);transform:translate(-50%,-50%)}
    #footAimMagnifier .aim-mag-crosshair::before{width:24px;height:1px}
    #footAimMagnifier .aim-mag-crosshair::after{width:1px;height:24px}
    #footAimMagnifier .aim-mag-dot{position:absolute;left:50%;top:50%;width:4px;height:4px;border:1px solid rgba(255,225,164,.98);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 5px rgba(0,0,0,.9)}
    #footAimMagnifier .aim-mag-label{position:absolute;right:9px;bottom:7px;padding:2px 5px;border-radius:5px;background:rgba(4,11,18,.68);font:800 7px/1 system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:rgba(209,241,255,.92)}
  `;document.head.appendChild(style);
}

function ensureRoot(){
  const view=viewport();if(!view)return null;if(root?.isConnected&&root.parentElement===view)return root;
  root=document.createElement("div");root.id="footAimMagnifier";root.setAttribute("aria-hidden","true");root.innerHTML=`<canvas aria-hidden="true"></canvas><div class="aim-mag-vignette"></div><div class="aim-mag-crosshair"></div><div class="aim-mag-dot"></div><div class="aim-mag-label">${MAGNIFIER_ZOOM.toFixed(2)}× AIM</div>`;canvas=root.querySelector("canvas");ctx=canvas?.getContext("2d",{alpha:true,desynchronized:true})||null;view.appendChild(root);resizeBackingStore();return root;
}

function resizeBackingStore(){
  if(!canvas)return;const ratio=Math.max(1,Math.min(MAX_DEVICE_PIXEL_RATIO,Number(devicePixelRatio)||1)),size=Math.max(1,Math.round(MAGNIFIER_SIZE_CSS*ratio));if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
}

function sourceCanvases(){
  const b=bridge(),sources=[];const mapCanvas=b?.map?.getCanvas?.(),threeCanvas=b?.threeRenderer?.domElement;
  if(mapCanvas?.isConnected)sources.push({canvas:mapCanvas,kind:"map"});
  if(threeCanvas?.isConnected&&threeCanvas!==mapCanvas)sources.push({canvas:threeCanvas,kind:"three"});
  if(!sources.length){const view=viewport();for(const candidate of view?.querySelectorAll?.("canvas")||[]){if(candidate===canvas||candidate.width<128||candidate.height<96)continue;sources.push({canvas:candidate,kind:"fallback"});}}
  return sources;
}

function place(point){
  if(!root||!point)return;const size=MAGNIFIER_SIZE_CSS,maxLeft=Math.max(EDGE_PAD_CSS,point.width-size-EDGE_PAD_CSS),maxTop=Math.max(HUD_TOP_PAD_CSS,point.height-size-EDGE_PAD_CSS),preferLeft=point.x>point.width*.54,preferAbove=point.y>point.height*.38;
  let left=preferLeft?point.x-size-FINGER_GAP_CSS:point.x+FINGER_GAP_CSS,top=preferAbove?point.y-size-FINGER_GAP_CSS:point.y+FINGER_GAP_CSS;
  left=clamp(left,EDGE_PAD_CSS,maxLeft);top=clamp(top,HUD_TOP_PAD_CSS,maxTop);
  const cx=left+size*.5,cy=top+size*.5,minDistance=size*.62,distance=Math.hypot(cx-point.x,cy-point.y);
  if(distance<minDistance){const direction=preferLeft?-1:1;left=clamp(point.x+direction*(size+FINGER_GAP_CSS),EDGE_PAD_CSS,maxLeft);}
  root.style.left=`${left.toFixed(1)}px`;root.style.top=`${top.toFixed(1)}px`;
  const view=viewport();if(view){view.dataset.walkAimMagnifierPlacement=preferLeft?(preferAbove?"left-above":"left-below"):(preferAbove?"right-above":"right-below");view.dataset.walkAimMagnifierPoint=`${point.x.toFixed(1)},${point.y.toFixed(1)}`;}
}

function drawSource(source,point){
  if(!ctx||!canvas||!source||!point)return false;const cssWidth=Math.max(1,point.width),cssHeight=Math.max(1,point.height),scaleX=source.width/cssWidth,scaleY=source.height/cssHeight,cropCss=MAGNIFIER_SIZE_CSS/MAGNIFIER_ZOOM,sourceW=cropCss*scaleX,sourceH=cropCss*scaleY,centerX=point.x*scaleX,centerY=point.y*scaleY,sx=clamp(centerX-sourceW*.5,0,Math.max(0,source.width-sourceW)),sy=clamp(centerY-sourceH*.5,0,Math.max(0,source.height-sourceH));
  ctx.drawImage(source,sx,sy,sourceW,sourceH,0,0,canvas.width,canvas.height);return true;
}

function draw(now){
  if(!active||!isFoot()||now-lastDrawMs<DRAW_INTERVAL_MS)return;lastDrawMs=now;const point=logicalPoint(clientX,clientY);if(!point||!ensureRoot()||!ctx)return;resizeBackingStore();place(point);ctx.clearRect(0,0,canvas.width,canvas.height);let rendered=0,sourceKinds=[];
  for(const source of sourceCanvases()){try{if(drawSource(source.canvas,point)){rendered++;sourceKinds.push(source.kind);}}catch{}}
  const view=viewport();if(view){view.dataset.walkAimMagnifierFrame=rendered?"rendered":"source-unavailable";view.dataset.walkAimMagnifierSources=sourceKinds.join("+");view.dataset.walkAimMagnifierZoom=MAGNIFIER_ZOOM.toFixed(2);view.dataset.walkAimMagnifierCapture="scene-after-render-v2";}
}

function ensureSceneRenderHook(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(hookedScene===scene&&scene.onAfterRender===sceneAfterRenderHook)return true;
  if(hookedScene&&sceneAfterRenderHook&&hookedScene.onAfterRender===sceneAfterRenderHook)hookedScene.onAfterRender=previousSceneAfterRender||(()=>{});
  hookedScene=scene;previousSceneAfterRender=typeof scene.onAfterRender==="function"?scene.onAfterRender:null;sceneAfterRenderHook=function(...args){previousSceneAfterRender?.apply(this,args);if(active)draw(performance.now());};scene.onAfterRender=sceneAfterRenderHook;return true;
}

function show(detail={}){
  if(!isFoot())return;clientX=Number(detail.clientX);clientY=Number(detail.clientY);active=true;ensureRoot()?.classList.add("active");ensureSceneRenderHook();const view=viewport();if(view){view.dataset.walkAimMagnifier="custom-canvas-touch-preview-v1";view.dataset.walkAimMagnifierActive="1";view.dataset.walkAimMagnifierNativeIos="suppressed-webkit-callout+selection-guards-v1";view.dataset.walkAimMagnifierCapture="scene-after-render-v2";}
}

function hide(reason="release"){
  active=false;root?.classList.remove("active");const view=viewport();if(view){view.dataset.walkAimMagnifierActive="0";view.dataset.walkAimMagnifierRelease=reason;}
}

function onAim(event){const detail=event?.detail||{};if(detail.active===false){hide(String(detail.source||"release"));return;}show(detail);}
function isProtectedAimSurface(event){return event?.composedPath?.().some(node=>node instanceof Element&&(node.id==="footLookZone"||node.id==="footReticle"||node.id==="footAimMagnifier"||node.matches?.("#viewport canvas")))||false;}
function preventNativeIosLoupe(event){if(isFoot()&&isProtectedAimSurface(event))event.preventDefault();}
function frame(now=performance.now()){const hooked=ensureSceneRenderHook();if(active&&!hooked)draw(now);requestAnimationFrame(frame);}

export function installAimMagnifierOverlay(){
  if(installed)return;installed=true;ensureStyle();ensureRoot();addEventListener("arondight:foot-screen-aim",onAim);addEventListener("arondight:player-mode",()=>{if(!isFoot())hide("mode-change");});addEventListener("blur",()=>hide("blur"),true);addEventListener("pagehide",()=>hide("pagehide"),true);document.addEventListener("visibilitychange",()=>{if(document.hidden)hide("hidden");},true);for(const type of["contextmenu","selectstart","dragstart"])document.addEventListener(type,preventNativeIosLoupe,{capture:true,passive:false});requestAnimationFrame(frame);
  const view=viewport();if(view){view.dataset.walkAimMagnifier="custom-canvas-touch-preview-v1";view.dataset.walkAimMagnifierNativeIos="suppressed-webkit-callout+selection-guards-v1";view.dataset.walkAimMagnifierZoom=MAGNIFIER_ZOOM.toFixed(2);view.dataset.walkAimMagnifierCapture="scene-after-render-v2";}
}

installAimMagnifierOverlay();
