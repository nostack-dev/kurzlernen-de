const SOFTWARE_RENDERER_RE=/(swiftshader|llvmpipe|software raster|software renderer)/i;
const ANDROID_RE=/android/i;
const HONOR_RE=/(?:\bhonor\b|\bhuawei\b|magicos)/i;

export function renderPlatformProfile({userAgent="",devicePixelRatio=1,rendererName=""}={}){
  const ua=String(userAgent||""),android=ANDROID_RE.test(ua),honor=HONOR_RE.test(ua),software=SOFTWARE_RENDERER_RE.test(String(rendererName||""));
  const nativePixelRatio=Math.max(.25,Number(devicePixelRatio)||1),pixelRatioCeiling=software?Math.min(nativePixelRatio,.30):android?Math.min(nativePixelRatio,1):Math.min(nativePixelRatio,1.25);
  return Object.freeze({android,honor,software,pixelRatioCeiling,stableBackbuffer:android||honor,canvasDesynchronized:false});
}

export function quantizedViewportSize(width,height){
  const even=value=>Math.max(2,Math.round(Math.max(1,Number(value)||1)/2)*2);
  return Object.freeze({width:even(width),height:even(height)});
}

export function viewportSizeChanged(previous,next){
  return !previous||previous.width!==next.width||previous.height!==next.height;
}
