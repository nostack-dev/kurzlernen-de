const SIZE_CSS=96;
const ZOOM=2.25;
const MAX_DPR=2;
const DRAW_INTERVAL_MS=1000/30;
const EDGE_PAD=8;
const HUD_TOP_PAD=48;
const FINGER_GAP=18;

let installed=false,active=false,clientX=0,clientY=0,lastDraw=-Infinity,root=null,canvas=null,ctx=null,hookedScene=null,previousAfterRender=null,afterRenderHook=null;

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
  const style=document.createElement("style");style.dataset.footAimMagnifier="finger-preview-v3";style.textContent=`
    #footLookZone,#footLookZone *,#footReticle,#footAimMagnifier,#viewport canvas{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}
    #footLookZone{touch-action:none!important}
    #footAimMagnifier{position:absolute;z-index:10025;width:${SIZE_CSS}px;height:${SIZE_CSS}px;border-radius:50%;overflow:hidden;pointer-events:none;display:none;box-sizing:border-box;border:1.5px solid rgba(236,249,255,.96);background:#08141bcc;box-shadow:0 3px 12px #0009,0 0 0 1px rgba(80,205,255,.28);transform:translateZ(0);contain:strict}
    #footAimMagnifier.active{display:block}
    #footAimMagnifier canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
    #footAimMagnifier::before,#footAimMagnifier::after{content:"";position:absolute;left:50%;top:50%;z-index:2;background:#fff0c7e8;box-shadow:0 0 3px #000;transform:translate(-50%,-50%)}
    #footAimMagnifier::before{width:20px;height:1px}#footAimMagnifier::after{width:1px;height:20px}
    #footAimMagnifier .dot{position:absolute;left:50%;top:50%;z-index:3;width:3px;height:3px;border:1px solid #fff0c7;border-radius:50%;transform:translate(-50%,-50%)}
  `;document.head.appendChild(style);
}
function resize(){if(!canvas)return;const dpr=Math.max(1,Math.min(MAX_DPR,Number(devicePixelRatio)||1)),size=Math.round(SIZE_CSS*dpr);if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}}
function ensureRoot(){
  const view=viewport();if(!view)return null;if(root?.isConnected&&root.parentElement===view)return root;
  root=document.createElement("div");root.id="footAimMagnifier";root.setAttribute("aria-hidden","true");root.innerHTML='<canvas aria-hidden="true"></canvas><i class="dot"></i>';canvas=root.querySelector("canvas");ctx=canvas?.getContext("2d",{alpha:true,desynchronized:true})||null;view.appendChild(root);resize();return root;
}
function sourceCanvases(){
  const b=bridge(),sources=[],map=b?.map?.getCanvas?.(),three=b?.threeRenderer?.domElement;
  if(map?.isConnected)sources.push({canvas:map,kind:"map"});
  if(three?.isConnected&&three!==map)sources.push({canvas:three,kind:"three"});
  if(!sources.length)for(const candidate of viewport()?.querySelectorAll?.("canvas")||[]){if(candidate!==canvas&&candidate.width>=128&&candidate.height>=96)sources.push({canvas:candidate,kind:"fallback"});}
  return sources;
}
function place(point){
  if(!root||!point)return;const maxLeft=Math.max(EDGE_PAD,point.width-SIZE_CSS-EDGE_PAD),maxTop=Math.max(HUD_TOP_PAD,point.height-SIZE_CSS-EDGE_PAD);
  const left=clamp(point.x-SIZE_CSS*.5,EDGE_PAD,maxLeft);let top=point.y-SIZE_CSS-FINGER_GAP,placement="above-finger";
  if(top<HUD_TOP_PAD){top=point.y+FINGER_GAP;placement="below-finger-fallback";}top=clamp(top,HUD_TOP_PAD,maxTop);
  root.style.left=`${left.toFixed(1)}px`;root.style.top=`${top.toFixed(1)}px`;
  const view=viewport();if(view){view.dataset.walkAimMagnifierPlacement=placement;view.dataset.walkAimMagnifierPoint=`${point.x.toFixed(1)},${point.y.toFixed(1)}`;}
}
function drawSource(source,point){
  if(!ctx||!canvas||!source||!point)return false;const sxScale=source.width/Math.max(1,point.width),syScale=source.height/Math.max(1,point.height),crop=SIZE_CSS/ZOOM,sw=crop*sxScale,sh=crop*syScale,cx=point.x*sxScale,cy=point.y*syScale,sx=clamp(cx-sw*.5,0,Math.max(0,source.width-sw)),sy=clamp(cy-sh*.5,0,Math.max(0,source.height-sh));ctx.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return true;
}
function draw(now=performance.now()){
  if(!active||!isFoot()||now-lastDraw<DRAW_INTERVAL_MS)return;lastDraw=now;const point=logicalPoint(clientX,clientY);if(!point||!ensureRoot()||!ctx)return;resize();place(point);ctx.clearRect(0,0,canvas.width,canvas.height);let rendered=0;const kinds=[];
  for(const source of sourceCanvases())try{if(drawSource(source.canvas,point)){rendered++;kinds.push(source.kind);}}catch{}
  const view=viewport();if(view){view.dataset.walkAimMagnifier="finger-preview-v3";view.dataset.walkAimMagnifierActive="1";view.dataset.walkAimMagnifierFrame=rendered?"rendered":"source-unavailable";view.dataset.walkAimMagnifierSources=kinds.join("+");view.dataset.walkAimMagnifierZoom=ZOOM.toFixed(2);view.dataset.walkAimMagnifierSizePx=String(SIZE_CSS);}
}
function hookScene(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(hookedScene===scene&&scene.onAfterRender===afterRenderHook)return true;
  if(hookedScene&&afterRenderHook&&hookedScene.onAfterRender===afterRenderHook)hookedScene.onAfterRender=previousAfterRender||(()=>{});
  hookedScene=scene;previousAfterRender=typeof scene.onAfterRender==="function"?scene.onAfterRender:null;afterRenderHook=function(...args){previousAfterRender?.apply(this,args);if(active)draw(performance.now());};scene.onAfterRender=afterRenderHook;return true;
}
function show(detail={}){clientX=Number(detail.clientX);clientY=Number(detail.clientY);if(!isFoot()){hide("non-foot");return;}active=true;ensureRoot()?.classList.add("active");hookScene();const view=viewport();if(view){view.dataset.walkAimMagnifier="finger-preview-v3";view.dataset.walkAimMagnifierActive="1";view.dataset.walkAimMagnifierNativeIos="suppressed";}}
function hide(reason="release"){active=false;root?.classList.remove("active");const view=viewport();if(view){view.dataset.walkAimMagnifierActive="0";view.dataset.walkAimMagnifierRelease=reason;}}
function onAim(event){const detail=event?.detail||{};if(detail.active===false)hide(String(detail.source||"release"));else show(detail);}
function protectedSurface(event){return event?.composedPath?.().some(node=>node instanceof Element&&(node.id==="footLookZone"||node.id==="footReticle"||node.id==="footAimMagnifier"||node.matches?.("#viewport canvas")))||false;}
function suppressNative(event){if(isFoot()&&protectedSurface(event))event.preventDefault();}
function frame(now=performance.now()){const hooked=hookScene();if(active&&!hooked)draw(now);requestAnimationFrame(frame);}

export function installAimMagnifierOverlay(){
  if(installed)return;installed=true;ensureStyle();ensureRoot();addEventListener("arondight:foot-screen-aim",onAim);addEventListener("arondight:player-mode",()=>{if(!isFoot())hide("mode-change");});addEventListener("blur",()=>hide("blur"),true);addEventListener("pagehide",()=>hide("pagehide"),true);document.addEventListener("visibilitychange",()=>{if(document.hidden)hide("hidden");},true);for(const type of["contextmenu","selectstart","dragstart"])document.addEventListener(type,suppressNative,{capture:true,passive:false});const view=viewport();if(view){view.dataset.walkAimMagnifier="finger-preview-v3";view.dataset.walkAimMagnifierActive="0";view.dataset.walkAimMagnifierZoom=ZOOM.toFixed(2);view.dataset.walkAimMagnifierSizePx=String(SIZE_CSS);}requestAnimationFrame(frame);
}

installAimMagnifierOverlay();
