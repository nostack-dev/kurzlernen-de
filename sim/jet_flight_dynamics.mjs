// VTOL fighter flight dynamics — a 6-DOF rigid body in the Box3D world.
//
// Box3D owns the body (mass, inertia, gravity, integration, every collision
// with terrain, buildings and vehicles). Each physics step this module turns
// the body's state into the forces and moments that really act on an
// aircraft and hands them to Box3D:
//   * aerodynamics from coefficients: lift (linear, stall, flat-plate post
//     stall), induced + parasitic + transonic wave drag, side force; pitch,
//     roll and yaw moments with static stability (Cmα, Clβ, Cnβ) and rate
//     damping (Cmq, Clp, Cnr), control surfaces (elevator, ailerons, rudder)
//     with deflection and rate limits — at low dynamic pressure they simply
//     have no authority;
//   * the engine: one thrust vector, nozzles from aft (wing-borne) to down
//     (jet-borne), spool lag, density lapse with altitude, reheat;
//   * reaction control (bleed-air puffers at nose, tail and wing tips) for
//     attitude while jet-borne — only with the nozzles down and the engine up;
//   * the landing gear: three struts as spring-dampers along ray casts into
//     the Box3D world (terrain and roofs), tyre side force, rolling
//     resistance, brakes, nose-wheel steering.
// The pilot never moves the jet directly: a fly-by-wire computer turns the
// stick into surface / puffer / throttle / nozzle commands (dynamic
// inversion with the same aero model: rate command when wing-borne with
// flight-path hold, g and angle-of-attack limits; translational-rate +
// vertical-speed command when jet-borne, like the F-35B). Everything it
// commands is limited by the physics: surfaces saturate, puffers have a
// maximum moment, thrust has a maximum and a spool time.
//
// Body frame: +X right wing, +Y nose, +Z up (world: Z up, gravity -Z).
export const JET_FLIGHT_DYNAMICS_VERSION="jet-6dof-aero-fbw-gear-v1";
const G=9.81;
export const JET_SPEC=Object.freeze({
  massKg:12000,
  // principal inertia about X (pitch), Y (roll), Z (yaw) — a 12 t fighter
  inertia:[1.0e5,1.8e4,1.15e5],
  // collision hulls in the body frame: fuselage (with nose) and the wing plate
  hulls:[
    [-.8,-7.2,-.8, .8,-7.2,-.8, .8,-7.2,.8, -.8,-7.2,.8, -.8,5.4,-.8, .8,5.4,-.8, .8,5.4,.8, -.8,5.4,.8, -.15,9,-.15, .15,9,-.15, .15,9,.15, -.15,9,.15],
    [-6,-3.2,-.2, -6,-4.2,-.2, -.4,1.6,-.2, -.4,-4,-.2, 6,-3.2,-.2, 6,-4.2,-.2, .4,1.6,-.2, .4,-4,-.2, -6,-3.2,.1, -6,-4.2,.1, -.4,1.6,.1, -.4,-4,.1, 6,-3.2,.1, 6,-4.2,.1, .4,1.6,.1, .4,-4,.1],
  ],
  wingArea:26,span:9.2,chord:3.3,
  thrustDry:105000,thrustMax:185000,spoolUpS:.45,spoolDownS:.35,
  CL0:.1,CLa:4.0,alphaStall:.42,CD0:.022,K:.14,CYb:-.8,gearCD:.02,brakeCD:.15,
  Cm0:0,Cma:-.4,Cmq:-12,Cmde:-.9,
  Clb:-.06,Clp:-.35,Clr:.08,Clda:.14,
  Cnb:.12,Cnr:-.25,Cnp:-.03,Cndr:.07,
  deMax:.44,daMax:.4,drMax:.5,surfaceRate:4.0,
  rcsMax:[70000,45000,150000],nozzleRate:1.0,
  gear:[{p:[0,5.2,-.6],load:.212,steer:true},{p:[1.9,-1.4,-.6],load:.394},{p:[-1.9,-1.4,-.6],load:.394}],
  strutRest:1.6,gearHeight:2.05,strutStatic:.15,strutMax:.4,strutZeta:.6,tyreMu:.8,rollMu:.02,brakeMu:.5,
  gLimit:9,gPush:3,alphaLimit:.38,pMax:2.4,qMax:1.2,
  hoverSpeed:14,hoverClimb:10,hoverSink:6,hoverTilt:.35,
  wingBorneV:85,hoverLawV:50,transitionNozzle:1.05,brakingNozzle:1.71,
});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const add=(a,b,s=1)=>{a[0]+=b[0]*s;a[1]+=b[1]*s;a[2]+=b[2]*s;return a;};
function rot(q,v){// rotate v by quaternion q=[x,y,z,w]
  const[x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);
  return[v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];
}
function unrot(q,v){return rot([-q[0],-q[1],-q[2],q[3]],v);}
function normalize(a){const l=len(a);return l>1e-9?[a[0]/l,a[1]/l,a[2]/l]:[0,0,0];}
const rateLimit=(cur,target,maxStep)=>cur+clamp(target-cur,-maxStep,maxStep);
export const airDensity=h=>1.225*Math.exp(-Math.max(0,h)/8500);
const SOUND=340;
function waveCD(m){return Math.exp(-(((m-1.02)/.16)**2))*.012+(m>1.02?.006:0);}

export function createAirframe(spec=JET_SPEC){
  return{spec,mode:"hover",pilot:true,engineOn:true,input:{lift:0,yawIn:0,pitchIn:0,rollIn:0,brake:0},
    lever:0,thrust:0,thrustCmd:0,nozzle:Math.PI/2,de:0,da:0,dr:0,steer:0,vzI:0,gammaHold:null,
    gearDown:true,contacts:0,landed:true,gearImpact:0,gearComp:[0,0,0],tele:{}};
}
export function setFlightMode(af,mode){af.mode=mode==="flight"?"flight":"hover";if(af.mode==="flight")af.lever=Math.max(af.lever,.9);}

// Euler angles (nose-up pitch, right-wing-down roll, heading CCW from +Y) of a body quaternion
function attitude(fwd,right,up){const pitch=Math.asin(clamp(fwd[2],-1,1)),roll=Math.atan2(-right[2],up[2]),heading=Math.atan2(-fwd[0],fwd[1]);return{pitch,roll,heading};}

// The aerodynamic model (also used by the flight computer to invert it).
function aero(af,vb,omegaB,V,rho,de,da,dr){
  const s=af.spec,qbar=.5*rho*V*V,u=vb[1],vs=vb[0],wu=vb[2];
  const alpha=Math.atan2(-wu,u),beta=V>1e-3?Math.asin(clamp(vs/V,-1,1)):0,am=clamp(alpha,-1,1);
  const sig=1/(1+Math.exp(-(Math.abs(alpha)-s.alphaStall)/.04)),CLlin=s.CL0+s.CLa*am,CLfp=Math.sin(2*alpha);
  const CL=(1-sig)*CLlin+sig*CLfp,CD=s.CD0+waveCD(V/SOUND)+(1-sig)*s.K*CLlin*CLlin+sig*2*Math.sin(alpha)**2+(af.gearDown?s.gearCD:0)+(af.speedBrake?s.brakeCD:0),CY=s.CYb*beta;
  const hv=V>1?.5/V:0,qh=omegaB[0]*s.chord*hv,ph=omegaB[1]*s.span*hv,rh=-omegaB[2]*s.span*hv;
  const Cm=s.Cm0+s.Cma*am+s.Cmq*qh+s.Cmde*de,Cl=s.Clb*beta+s.Clp*ph+s.Clr*rh+s.Clda*da,Cn=s.Cnb*beta+s.Cnr*rh+s.Cnp*ph+s.Cndr*dr;
  // body-axis moments: X = pitch (nose up +), Y = roll (right wing down +), Z = -yaw (nose right = -Z)
  return{qbar,alpha,beta,CL,CD,CY,moment:[qbar*s.wingArea*s.chord*Cm,qbar*s.wingArea*s.span*Cl,-qbar*s.wingArea*s.span*Cn],sig};
}

// One physics step. body = {position,velocity,rotation:[x,y,z,w],angularVelocity}; env.raycast(origin,dir,maxLen) -> {distanceM,point,normal}|null
export function airframeStep(af,body,dt,env={}){
  const s=af.spec,m=s.massKg,I=s.inertia,q=body.rotation,pos=body.position,v=body.velocity,w=body.angularVelocity;
  const fwd=rot(q,[0,1,0]),right=rot(q,[1,0,0]),up=rot(q,[0,0,1]),vb=unrot(q,v),omegaB=unrot(q,w),V=len(v),rho=airDensity(pos[2]),inp=af.input,att=attitude(fwd,right,up);
  const force=[0,0,0],torque=[0,0,0];
  // ---------------- landing gear (ray-cast struts)
  af.gearDown=af.mode==="hover"||V<s.wingBorneV||af.contacts>0;
  let contacts=0,gearImpact=0;const steerTarget=V<30?clamp(inp.yawIn,-1,1)*.5:clamp(inp.yawIn,-1,1)*.08;af.steer=rateLimit(af.steer,steerTarget,dt*1.5);
  if(af.gearDown&&env.raycast){
    const down=[-up[0],-up[1],-up[2]],hits=s.gear.map(g=>{const r=rot(q,g.p),attach=[pos[0]+r[0],pos[1]+r[1],pos[2]+r[2]],hit=env.raycast(attach,down,s.strutRest+.4);return hit&&hit.distanceM<s.strutRest?hit:null;}),nContact=hits.filter(Boolean).length;
    for(let i=0;i<s.gear.length;i++){const g=s.gear[i],hit=hits[i];
      af.gearComp[i]=0;if(!hit)continue;
      const comp=s.strutRest-hit.distanceM,n=normalize(hit.normal||[0,0,1]),rc=[hit.point[0]-pos[0],hit.point[1]-pos[1],hit.point[2]-pos[2]],vp=add(cross(w,rc),v),compRate=dot(vp,down);
      const share=g.load*m,k=share*G/s.strutStatic,c=2*s.strutZeta*Math.sqrt(k*share),stiff=comp>s.strutMax?k*12*(comp-s.strutMax):0;
      if(compRate>gearImpact)gearImpact=compRate;
      let N=Math.max(0,k*comp+stiff+c*compRate);af.gearComp[i]=comp;contacts++;
      // tyre: rolling direction in the contact plane (nose wheel steered), side direction across it
      let fw=normalize(add([...fwd],n,-dot(fwd,n)));if(g.steer&&af.steer){const cs=Math.cos(af.steer),sn=Math.sin(af.steer),side=cross(fw,n);fw=normalize([fw[0]*cs+side[0]*sn,fw[1]*cs+side[1]*sn,fw[2]*cs+side[2]*sn]);}
      const sw=cross(fw,n),vf=dot(vp,fw),vsd=dot(vp,sw);
      // the force that stops this contact point within one step: the body's effective mass at the wheel along that direction (translation + rotation), shared by the wheels on the ground
      const mAt=d=>{const u=unrot(q,cross(rc,d));return 1/(1/m+u[0]*u[0]/I[0]+u[1]*u[1]/I[1]+u[2]*u[2]/I[2]);},share3=.8/Math.max(1,nContact),stopL=mAt(fw)*share3/Math.max(1e-3,dt),stopS=mAt(sw)*share3/Math.max(1e-3,dt);
      const brake=clamp(inp.brake,0,1),longMax=(s.rollMu+brake*s.brakeMu)*N,latMax=s.tyreMu*N;
      const Fl=-Math.sign(vf)*Math.min(longMax,Math.abs(vf)*stopL),Fs=-Math.sign(vsd)*Math.min(latMax,Math.abs(vsd)*stopS);
      const F=[n[0]*N+fw[0]*Fl+sw[0]*Fs,n[1]*N+fw[1]*Fl+sw[1]*Fs,n[2]*N+fw[2]*Fl+sw[2]*Fs];add(force,F);add(torque,cross(rc,F));}
  }
  if(contacts>0&&af.contacts===0)af.gearImpact=gearImpact;else af.gearImpact=0;af.contacts=contacts;
  // ---------------- flight computer
  // radar altimeter (wheels above whatever is below: terrain or a roof)
  const radar=env.raycast?env.raycast([pos[0],pos[1],pos[2]],[0,0,-1],400):null,agl=radar?Math.max(0,radar.distanceM-s.gearHeight):400;
  const pilot=af.pilot&&af.engineOn,wFlight=clamp((V-s.hoverLawV)/(s.wingBorneV-s.hoverLawV),0,1),onGround=contacts>=2;
  // nozzles: hover = down; flight = scheduled aft with speed (STOVL below wing-borne speed)
  const nozzleTarget=!af.engineOn?af.nozzle:af.mode==="hover"?(V>s.hoverSpeed+5?s.brakingNozzle:Math.PI/2):s.transitionNozzle*clamp(1-V/(s.wingBorneV-5),0,1);af.nozzle=rateLimit(af.nozzle,nozzleTarget,s.nozzleRate*dt);
  const cn=Math.cos(af.nozzle),sn=Math.sin(af.nozzle),thrustDir=[fwd[0]*cn+up[0]*sn,fwd[1]*cn+up[1]*sn,fwd[2]*cn+up[2]*sn],lapse=Math.pow(rho/1.225,.7)*clamp(af.thrustScale??1,0,1),Tmax=s.thrustMax*lapse;// a damaged engine gives less
  if(af.mode==="flight"&&pilot)af.lever=clamp(af.lever+inp.lift*dt*.55,0,1);
  af.speedBrake=(af.mode==="flight"&&af.lever<=.001&&inp.lift<-.4)||(af.mode==="hover"&&V>30);// hover selected at speed: airbrake + nozzle braking stop
  // jet-borne vertical speed command (thrust magnitude)
  // vertical speed command (jet-borne; in flight mode the left stick is the throttle lever); the sink rate tapers to a soft touchdown
  const vzWant=af.mode==="flight"?0:inp.lift>0?inp.lift*s.hoverClimb:Math.max(inp.lift*s.hoverSink,-Math.min(Math.sqrt(3*agl)+.6,.6*agl+.8));
  af.vzCmd=rateLimit(Number.isFinite(af.vzCmd)?af.vzCmd:v[2],vzWant,11*dt);const vzCmd=af.vzCmd;
  // the engine lags: compare with the vertical speed the current thrust is about to give (predictor); integrate only while unsaturated and airborne
  const azNow=af.thrust*thrustDir[2]/m-G,vzErr=vzCmd-(v[2]+.8*s.spoolUpS*azNow);
  const TvertRaw=m*(G+2.4*vzErr+af.vzI)/Math.max(.25,thrustDir[2]);if(!onGround&&TvertRaw>0&&TvertRaw<Tmax)af.vzI=0;if(onGround&&inp.lift<=.05){af.vzI=0;af.vzCmd=0;}
  const Tvert=onGround&&inp.lift<=.05?0:clamp(TvertRaw,0,Tmax);
  const Tlever=(af.lever>.86?s.thrustDry+(s.thrustMax-s.thrustDry)*(af.lever-.86)/.14:s.thrustDry*af.lever/.86)*lapse;
  // wing-borne: the lever; jet-borne: the vertical-speed loop; in between the vectored part must still hold the jet up
  const support=af.mode==="flight"?clamp(sn*2.5,0,1):1;af.thrustCmd=!af.engineOn?0:clamp(af.mode==="flight"?Tlever+support*Math.max(0,Tvert-Tlever):Tvert,0,Tmax);
  af.thrust+=(af.thrustCmd-af.thrust)*(1-Math.exp(-dt/(af.thrustCmd>af.thrust?s.spoolUpS:s.spoolDownS)));
  add(force,thrustDir,af.thrust);
  // rate commands: hover law (attitude from the translational-rate command) blended into the flight law
  let pC=0,qC=0,rC=0;
  {// hover / jet-borne
    const h=att.heading,fh=[-Math.sin(h),Math.cos(h)],rh=[Math.cos(h),Math.sin(h)],vF=v[0]*fh[0]+v[1]*fh[1],vR=v[0]*rh[0]+v[1]*rh[1];
    const aF=clamp(1.1*(-inp.pitchIn*s.hoverSpeed-vF),-4,4),aR=clamp(1.1*(inp.rollIn*s.hoverSpeed-vR),-4,4);
    const tilt=s.hoverTilt*clamp(.25+agl/8,0,1)*clamp((42-V)/20,.12,1),trc=af.mode==="hover",pitchCmd=trc?clamp(-Math.atan(aF/G),-tilt,tilt):.05+inp.pitchIn*.3,rollCmd=trc?clamp(Math.atan(aR/G),-tilt,tilt):inp.rollIn*.5;// transition (flight selected, still slow): attitude command, the nozzles accelerate it// no tail strikes close to the ground
    const hq=2.6*(pitchCmd-att.pitch),hp=2.6*(rollCmd-att.roll),hr=inp.yawIn*.8;
    pC+=(1-wFlight)*hp;qC+=(1-wFlight)*hq;rC+=(1-wFlight)*hr;
  }
  {// wing-borne: roll rate, pitch rate (g / AoA limited) or flight-path hold, coordinated yaw
    if(wFlight<.05)af.gammaHold=null;const Vs=Math.max(V,30),gamma=V>1?Math.asin(clamp(v[2]/V,-1,1)):0,phi=att.roll;let qf;
    if(Math.abs(inp.pitchIn)>.05){af.gammaHold=null;qf=inp.pitchIn>0?inp.pitchIn*Math.min(s.qMax,s.gLimit*G/Vs):inp.pitchIn*Math.min(.8,s.gPush*G/Vs);}
    else{if(af.mode==="hover")af.gammaHold=Math.asin(clamp(vzCmd/Vs,-.5,.5));/* jet-borne selected: the left stick is a vertical-speed command at any speed */else if(af.gammaHold===null||wFlight<.99)af.gammaHold=wFlight<.99?0:gamma;const level=Math.abs(phi)<1.4?G*Math.sin(phi)*Math.tan(clamp(phi,-1.3,1.3))/Vs:0;qf=Math.abs(phi)<1.4?level+clamp(1.2*(af.gammaHold-gamma),-.15,.15)*Math.cos(phi):0;}
    // stall protection (angle of attack limit) — the jet still runs out of energy, it just does not depart
    const a=Math.atan2(-vb[2],Math.max(.5,vb[1]));if(a>s.alphaLimit)qf=Math.min(qf,2.5*(s.alphaLimit-a));if(a<-.2)qf=Math.max(qf,2.5*(-.2-a));
    const rf=G*Math.sin(phi)*Math.cos(att.pitch)/Vs+inp.yawIn*.35;
    pC+=wFlight*inp.rollIn*s.pMax;qC+=wFlight*qf;rC+=wFlight*rf;
  }
  // body-rate errors -> wanted angular acceleration -> moments (dynamic inversion of the aero model)
  const p=omegaB[1],qq=omegaB[0],r=-omegaB[2];let wantX=I[0]*4.5*(qC-qq),wantY=I[1]*18*(pC-p),wantZ=-I[2]*3.2*(rC-r);
  const beta=V>1?Math.asin(clamp(vb[0]/V,-1,1)):0;wantZ+=-I[2]*wFlight*1.8*beta*Math.min(1,V/60);// sideslip: yaw the nose into the relative wind
  // gyroscopic term (ω × Iω) is part of the body dynamics Box3D integrates: the computer cancels it
  const Iw=[I[0]*omegaB[0],I[1]*omegaB[1],I[2]*omegaB[2]],gyro=cross(omegaB,Iw);wantX+=gyro[0];wantY+=gyro[1];wantZ+=gyro[2];
  const ctl=pilot&&!(onGround&&(af.mode==="hover"||V<40));
  const base=aero(af,vb,omegaB,Math.max(V,1e-3),rho,0,0,0),qS=base.qbar*s.wingArea;
  let deT=0,daT=0,drT=0,rcs=[0,0,0];
  if(ctl){
    if(qS>1){deT=clamp((wantX-base.moment[0])/(qS*s.chord*s.Cmde),-s.deMax,s.deMax);daT=clamp((wantY-base.moment[1])/(qS*s.span*s.Clda),-s.daMax,s.daMax);drT=clamp(-(wantZ-base.moment[2])/(qS*s.span*s.Cndr),-s.drMax,s.drMax);}
    // what the surfaces cannot do, the puffers do (when jet-borne, engine up)
    const avail=Math.sin(af.nozzle)*clamp(af.thrust/(.4*s.thrustMax),0,1),left=[wantX-base.moment[0]-qS*s.chord*s.Cmde*deT,wantY-base.moment[1]-qS*s.span*s.Clda*daT,wantZ-base.moment[2]+qS*s.span*s.Cndr*drT];
    rcs=[clamp(left[0],-s.rcsMax[0]*avail,s.rcsMax[0]*avail),clamp(left[1],-s.rcsMax[1]*avail,s.rcsMax[1]*avail),clamp(left[2],-s.rcsMax[2]*avail,s.rcsMax[2]*avail)];
  }
  af.de=rateLimit(af.de,deT,s.surfaceRate*dt);af.da=rateLimit(af.da,daT,s.surfaceRate*dt);af.dr=rateLimit(af.dr,drT,s.surfaceRate*dt);
  // ---------------- aerodynamics with the real surface positions
  let A=null;
  if(V>.5){A=aero(af,vb,omegaB,V,rho,af.de,af.da,af.dr);const vh=[v[0]/V,v[1]/V,v[2]/V],qS2=A.qbar*s.wingArea;
    const liftDir=normalize(add([...up],vh,-dot(up,vh))),sideDir=normalize(add([...right],vh,-dot(right,vh)));
    add(force,liftDir,qS2*A.CL);add(force,vh,-qS2*A.CD);add(force,sideDir,qS2*A.CY);
    add(torque,rot(q,A.moment));}
  add(torque,rot(q,rcs));
  // ---------------- telemetry
  const nz=dot(force,up)/(m*G);af.landed=contacts>=2&&V<1.5&&af.mode==="hover"&&inp.lift<=.15;
  af.tele={V,agl,mach:V/SOUND,alpha:A?.alpha??0,beta:A?.beta??0,nz,thrust:af.thrust,nozzle:af.nozzle,contacts,pitch:att.pitch,roll:att.roll,heading:att.heading,wFlight,de:af.de,da:af.da,dr:af.dr,rcs,qbar:A?.qbar??0};
  return{force,torque};
}
