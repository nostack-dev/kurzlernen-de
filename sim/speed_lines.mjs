// Synthwave speed streaks: radial neon lines rush from the screen centre to
// the edges when the camera moves fast (drone dive, car at speed, nitro…).
// A half-resolution 2D canvas over the 3D view, drawn only while fast —
// effectively free when standing still.

export const SPEED_LINES_VERSION="radial-neon-streaks-v1";
const START_MPS=13,FULL_MPS=40,COUNT=26;
let installed=false,canvas=null,ctx=null,last=performance.now(),lastPos=null,speed=0,streaks=[];

const bridge=()=>globalThis.__arondightRealWorld||null;
function ensure(){
  if(canvas?.isConnected)return true;const view=document.getElementById("viewport");if(!view)return false;
  canvas=document.createElement("canvas");canvas.id="speedLines";canvas.setAttribute("aria-hidden","true");canvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;mix-blend-mode:normal";view.appendChild(canvas);ctx=canvas.getContext("2d");return true;
}
function spawn(i){const a=Math.random()*Math.PI*2;return{a,r:.15+Math.random()*.5,len:.08+Math.random()*.22,v:.9+Math.random()*1.4,c:i%3===0?"255,79,216":"127,243,255"};}
function frame(now){
  requestAnimationFrame(frame);const dt=Math.min(.1,(now-last)/1000);last=now;const cam=bridge()?.threeCamera;if(!cam||!ensure())return;
  const p=cam.position;if(lastPos&&dt>0){const d=Math.hypot(p.x-lastPos.x,p.y-lastPos.y,p.z-lastPos.z)/dt;speed+=(Math.min(d,90)-speed)*Math.min(1,dt*4);}lastPos={x:p.x,y:p.y,z:p.z};
  const k=Math.max(0,Math.min(1,(speed-START_MPS)/(FULL_MPS-START_MPS)));
  const w=canvas.clientWidth>>1,h=canvas.clientHeight>>1;if(!w||!h)return;
  if(k<=0){if(canvas.dataset.on==="1"){ctx.clearRect(0,0,canvas.width,canvas.height);canvas.dataset.on="0";}return;}
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  canvas.dataset.on="1";ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation="lighter";ctx.lineCap="round";
  while(streaks.length<COUNT)streaks.push(spawn(streaks.length));
  const cx=w/2,cy=h/2,R=Math.hypot(cx,cy);
  for(let i=0;i<streaks.length;i++){const s=streaks[i];s.r+=s.v*dt*(.6+1.8*k);if(s.r>1.15){streaks[i]=spawn(i);continue;}
    const r0=s.r*R,r1=(s.r+s.len*(.5+k))*R,ca=Math.cos(s.a),sa=Math.sin(s.a),alpha=k*Math.min(1,s.r*1.6)*.55;
    ctx.strokeStyle=`rgba(${s.c},${alpha.toFixed(3)})`;ctx.lineWidth=.8+1.6*k*s.r;ctx.beginPath();ctx.moveTo(cx+ca*r0,cy+sa*r0);ctx.lineTo(cx+ca*r1,cy+sa*r1);ctx.stroke();}
  ctx.globalCompositeOperation="source-over";
}
export function installSpeedLines(){if(installed||typeof window==="undefined")return;installed=true;requestAnimationFrame(frame);}
installSpeedLines();
