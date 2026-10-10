// Persistent pedestrians. Every person is an agent with a home street, a body position, a heading,
// a walking pace and a destination: a point on the sidewalk network (its own street, or another
// street reachable over the junctions). It walks there continuously, crosses where its way changes
// sides, waits a little on arrival and then picks the next destination. Nothing ever moves a person
// except its own legs: no rebinding to other routes, no snapping, no following the player around.
// Pure logic (no three.js): the population module renders, physicalizes and gates them.
export const PEDESTRIAN_AGENTS_VERSION="persistent-goal-pedestrians-v1";
const LOOK_M=1.4,ARRIVE_M=.35,CATCHUP_M=1.6,JUNCTION_M=3.5,JUNCTION_DEDUPE_M=8,MAX_HOPS=3,TURN_RATE=4.5,CROSS_GAP_M=2.5,CARRIAGEWAY_M=2.6;

export function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
// per-agent deterministic random stream (mulberry32): the same street gives the same people
// making the same choices on every device
export function agentRandom(a){let t=(a.rs=(a.rs+0x6D2B79F5)>>>0);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function angleTo(a,b){let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;}

// point on a route at distance s, shifted sideways (left of the drawing direction = +offset); no allocation
export function routePointInto(route,s,offset,out){
  const segs=route.segments,n=segs.length;let lo=0,hi=n-1;const d=clamp(s,0,route.length);
  while(lo<hi){const mid=(lo+hi+1)>>1;if(segs[mid].start<=d)lo=mid;else hi=mid-1;}
  const g=segs[lo],t=clamp((d-g.start)/g.d,0,1),tx=g.dx/g.d,ty=g.dy/g.d;
  out.x=g.a[0]+g.dx*t-ty*offset;out.y=g.a[1]+g.dy*t+tx*offset;out.tx=tx;out.ty=ty;return out;
}
// nearest point of the route: s along it and the signed lateral offset (left = +)
export function projectOnRoute(route,x,y,out){
  let best=Infinity,bs=0,bl=0;
  for(const g of route.segments){const t=clamp(((x-g.a[0])*g.dx+(y-g.a[1])*g.dy)/(g.d*g.d),0,1),px=g.a[0]+g.dx*t,py=g.a[1]+g.dy*t,dd=(x-px)**2+(y-py)**2;
    if(dd<best){best=dd;bs=g.start+g.d*t;bl=((x-px)*-g.dy+(y-py)*g.dx)/g.d;}}
  out.s=bs;out.lateral=bl;out.distance=Math.sqrt(best);return out;
}
function bbox(route){if(route._bb)return route._bb;let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const p of route.points){a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]);}
  Object.defineProperty(route,"_bb",{value:[a,b,c,d],enumerable:false});return route._bb;}
// where two streets meet (cross, or one ends at the other): s on each
function addJunction(out,B,sa,sb,x,y){for(const j of out)if(j.other===B.key&&Math.abs(j.s-sa)<JUNCTION_DEDUPE_M)return;out.push({s:sa,other:B.key,os:sb,x,y});}
// an end point (px,py) of one street (ps along it) within a few metres of segment g of the other;
// onB: the point is A's and g is B's (else the other way round)
function endNear(px,py,g,onB,ps,out,A,B){const t=clamp(((px-g.a[0])*g.dx+(py-g.a[1])*g.dy)/(g.d*g.d),0,1),qx=g.a[0]+g.dx*t,qy=g.a[1]+g.dy*t;if((px-qx)**2+(py-qy)**2>=JUNCTION_M*JUNCTION_M)return;const gs=g.start+g.d*t;if(onB)addJunction(out,B,ps,gs,qx,qy);else addJunction(out,B,gs,ps,qx,qy);}
function junctionsBetween(A,B,out){
  const a=bbox(A),b=bbox(B),M=JUNCTION_M;if(a[0]-M>b[2]||b[0]-M>a[2]||a[1]-M>b[3]||b[1]-M>a[3])return;
  for(const g of A.segments){const gx0=Math.min(g.a[0],g.c[0])-M,gx1=Math.max(g.a[0],g.c[0])+M,gy0=Math.min(g.a[1],g.c[1])-M,gy1=Math.max(g.a[1],g.c[1])+M;if(gx0>b[2]||gx1<b[0]||gy0>b[3]||gy1<b[1])continue;
    for(const h of B.segments){if(Math.max(h.a[0],h.c[0])<gx0||Math.min(h.a[0],h.c[0])>gx1||Math.max(h.a[1],h.c[1])<gy0||Math.min(h.a[1],h.c[1])>gy1)continue;
      const den=g.dx*h.dy-g.dy*h.dx,ex=h.a[0]-g.a[0],ey=h.a[1]-g.a[1];
      if(Math.abs(den)>1e-9){const t=(ex*h.dy-ey*h.dx)/den,u=(ex*g.dy-ey*g.dx)/den;if(t>=0&&t<=1&&u>=0&&u<=1){addJunction(out,B,g.start+g.d*t,h.start+h.d*u,g.a[0]+g.dx*t,g.a[1]+g.dy*t);continue;}}
      // T-junction: an end of one street within a few metres of the other
      endNear(g.a[0],g.a[1],h,true,g.start,out,A,B);endNear(g.c[0],g.c[1],h,true,g.start+g.d,out,A,B);endNear(h.a[0],h.a[1],g,false,h.start,out,A,B);endNear(h.c[0],h.c[1],g,false,h.start+h.d,out,A,B);}}
}
// The sidewalk network: the streets people currently live on plus where they meet.
// Kept incrementally: a street added or rebuilt is intersected with the others once.
export function createPedestrianNetwork(){
  const routes=new Map(),junctions=new Map();
  function drop(key){junctions.delete(key);for(const list of junctions.values())for(let i=list.length-1;i>=0;i--)if(list[i].other===key)list.splice(i,1);}
  function link(route){const mine=[];junctions.set(route.key,mine);for(const other of routes.values()){if(other===route)continue;const tmp=[];junctionsBetween(route,other,tmp);if(!tmp.length)continue;let theirs=junctions.get(other.key);if(!theirs)junctions.set(other.key,theirs=[]);
      for(const j of tmp){mine.push(j);theirs.push({s:j.os,other:route.key,os:j.s,x:j.x,y:j.y});}}}
  return{routes,junctions,
    // returns true when the network changed
    sync(list){let changed=false;const keep=new Set(),added=[];for(const r of list){if(!r?.segments?.length||r.length<4)continue;keep.add(r.key);if(routes.get(r.key)!==r){if(routes.has(r.key))drop(r.key);routes.set(r.key,r);added.push(r);changed=true;}}
      for(const key of[...routes.keys()])if(!keep.has(key)){routes.delete(key);drop(key);changed=true;}for(const r of added)link(r);return changed;},
    get(key){return routes.get(key)||null;}};
}

const P={x:0,y:0,tx:0,ty:0},Q={x:0,y:0,tx:0,ty:0},J={s:0,lateral:0,distance:0},J2={s:0,lateral:0,distance:0};
// at a junction, walking on along the sidewalk means stepping onto the side street's carriageway:
// that is a crossing as well. Returns the side street's centre point there, or null.
function sideStreetAhead(a,route,nx,ny,net){const links=net.junctions.get(route.key);if(!links)return null;
  for(const j of links){if(Math.abs(j.s-a.s)>9)continue;const r2=net.get(j.other);if(!r2)continue;projectOnRoute(r2,nx,ny,J2);if(J2.distance>=CARRIAGEWAY_M)continue;projectOnRoute(r2,a.x,a.y,J);if(J.distance<CARRIAGEWAY_M)continue;routePointInto(r2,J2.s,0,Q);return Q;}return null;}
function sideNearest(route,s,off,x,y){routePointInto(route,s,off,P);const a=(P.x-x)**2+(P.y-y)**2;routePointInto(route,s,-off,P);return(P.x-x)**2+(P.y-y)**2<a?-1:1;}
function setDest(a,net){const last=a.legs[a.legs.length-1],route=last&&net.get(last.route);if(!route){a.dest=null;return;}routePointInto(route,last.toS,(last.side||a.side)*a.off,P);a.dest??={x:0,y:0};a.dest.x=P.x;a.dest.y=P.y;}
function pickS(a,route,avoid){const len=route.length;if(len<6)return len/2;for(let k=0;k<6;k++){const s=2+agentRandom(a)*(len-4);if(avoid==null||Math.abs(s-avoid)>Math.min(14,len/3))return s;}return clamp(len-(avoid??0),2,len-2);}

// Decide where to go next. Mostly somewhere on a street reachable over the junctions (up to three
// streets away, home street preferred so a neighbourhood keeps its people), sometimes further along
// the same street; now and then cross over to the other sidewalk first.
export function planTrip(a,net,now=0){
  const cur=net.get(a.route);a.legs.length=0;a.li=0;if(!cur){a.state="wait";a.waitUntil=now+1000;a.dest=null;return false;}
  a.trip++;a.state="walk";a.s=clamp(a.s,0,cur.length);
  if(agentRandom(a)<.2){a.side=-a.side;a.legs.push({route:cur.key,fromS:a.s,toS:a.s,side:a.side});}
  const links=net.junctions.get(cur.key);
  if(agentRandom(a)<.35||!links?.length){a.legs.push({route:cur.key,fromS:a.s,toS:pickS(a,cur,a.s),side:a.side});setDest(a,net);return true;}
  // breadth-first over the junction graph from where the person stands
  const seen=new Map([[cur.key,null]]),order=[cur.key];let frontier=[cur.key];
  for(let hop=0;hop<MAX_HOPS&&frontier.length;hop++){const next=[];for(const key of frontier)for(const j of net.junctions.get(key)||[]){if(seen.has(j.other)||!net.routes.has(j.other))continue;seen.set(j.other,{from:key,j});order.push(j.other);next.push(j.other);}frontier=next;}
  let target=order.length>1?order[1+Math.floor(agentRandom(a)*(order.length-1))]:cur.key;
  if(a.home!==cur.key&&seen.has(a.home)&&agentRandom(a)<.4)target=a.home;
  const path=[];for(let k=target;seen.get(k);k=seen.get(k).from)path.unshift(seen.get(k));
  let s=a.s,key=cur.key,side=a.side;
  for(const step of path){a.legs.push({route:key,fromS:s,toS:step.j.s,side});key=step.j.other;s=step.j.os;side=0;/* side picked on arrival at the corner: nearest sidewalk */}
  const last=net.get(key);a.legs.push({route:key,fromS:s,toS:pickS(a,last,path.length?null:s),side});setDest(a,net);return true;
}

function turn(a,yaw,dt){a.yaw+=clamp(angleTo(a.yaw,yaw),-TURN_RATE*dt,TURN_RATE*dt);}
function detach(a,net,now){const L=a.leader;a.leader=null;const route=net.get(L?.route)||net.get(a.home);if(!route){a.state="wait";a.waitUntil=now+1000;return;}
  projectOnRoute(route,a.x,a.y,J);a.route=route.key;a.s=J.s;a.side=J.lateral>=0?1:-1;a.legs.length=0;a.state="wait";a.waitUntil=now+500+agentRandom(a)*2500;}
// One simulation step. dt may be large for far, unseen people (cheap low-rate update):
// the motion is still bounded by walking pace, so a person never covers more ground than it could walk.
// a free move (fleeing, fighting) never goes through a wall: blocked straight ahead, it slides along
// it (the first open direction within ±100°), and a fleeing person keeps that new heading
function freeMove(a,ux,uy,step,{keep=false}={}){const at=globalThis.__arondightBuildingAt;if(!at||!(step>0)){a.x+=ux*step;a.y+=uy*step;return true;}
  const r=.3;for(const ang of[0,.5,-.5,1.0,-1.0,1.6,-1.6]){const c=Math.cos(ang),s=Math.sin(ang),dx=ux*c-uy*s,dy=ux*s+uy*c,nx=a.x+dx*step,ny=a.y+dy*step;if(at(nx+dx*r,ny+dy*r))continue;a.x=nx;a.y=ny;if(keep&&ang){a.fleeX=dx;a.fleeY=dy;}return true;}
  return false;}
export function stepAgent(a,dt,now,net){
  if(dt<=0)return;
  // angry (bumped into, punched): go for the player and box; calms down after a while or when he is far
  if(a.fightUntil){const W=globalThis.__arondightWalkMode,foe=a.foe&&a.foe.alive&&!a.foe.knocked?a.foe:null;if(a.foe&&!foe){a.foe=null;a.fightUntil=0;}
    // the target: another pedestrian he got into it with, or the player
    const T=foe?{x:foe.x,y:foe.y,z:foe.z,npc:true}:(W?.mode==="foot"&&!W.dead&&W.position?{x:W.position.x,y:W.position.y,z:W.position.z,npc:false}:null);
    if(now<a.fightUntil&&T){const dx=T.x-a.x,dy=T.y-a.y,d=Math.hypot(dx,dy);
      const arm=armsOf(a);
      // a gangster with a gun keeps his distance (6-14 m) and fires a cheap pistol: aimed, but a moving target is hard to hit
      if(arm==="gun"&&d<45){turn(a,Math.atan2(dy,dx),dt*3.4);a.state="fight";const want=d>14?1:d<6?-1:0,top=want>0?2.6:want<0?1.5:0;a.v+=clamp(top-a.v,-3*dt,2.4*dt);if(want)freeMove(a,dx/d*want,dy/d*want,a.v*dt);
        if(now-(a.lastShot||0)>(820+agentRandom(a)*520)&&d<32&&Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-a.yaw),Math.cos(Math.atan2(dy,dx)-a.yaw)))<.3){a.lastShot=now;a.lastPunch=now;a.punchHand=1;try{window.dispatchEvent(new CustomEvent("arondight:pedestrian-shot",{detail:{id:a.id,from:[a.x,a.y,a.z],yaw:a.yaw,distanceM:d,target:T.npc?{id:foe.id,x:T.x,y:T.y,z:T.z}:null,playerSpeedMps:T.npc?0:Math.hypot(W.velocity?.x||0,W.velocity?.y||0)}}));}catch{}}
        return;}
      if(d<35){turn(a,Math.atan2(dy,dx),dt*3);a.state="fight";if(arm==="knife"&&d>.85&&d<1.6&&now-(a.lastPunch||0)>600)a.v=Math.max(a.v,2.4);if(d>(arm==="knife"?.8:.95)){a.v+=clamp(Math.min(2.8,a.speed+1.3)-a.v,-3*dt,2.4*dt);const step=Math.min(d-.9,a.v*dt);freeMove(a,dx/d,dy/d,step);}
        else if(arm==="knife"){a.v=Math.max(0,a.v-5*dt);if(now-(a.lastPunch||0)>(640+agentRandom(a)*300)){a.lastPunch=now;a.punchHand=1;
          // a stab: ~16 % of the player's health
          if(T.npc){try{window.dispatchEvent(new CustomEvent("arondight:pedestrian-brawl",{detail:{id:a.id,foeId:foe.id,weapon:"knife",dir:[dx/d,dy/d]}}));}catch{}}
          else{globalThis.__arondightPlayerDamageModel?.damage?.(16,"knife:pedestrian");W.push?.({x:dx/d*.6,y:dy/d*.6,z:0});try{window.dispatchEvent(new CustomEvent("arondight:pedestrian-stab",{detail:{id:a.id,at:[W.position.x,W.position.y,W.position.z]}}));}catch{}}}}
        else{a.v=Math.max(0,a.v-5*dt);if(now-(a.lastPunch||0)>(780+agentRandom(a)*380)){a.lastPunch=now;a.punchHand=-(a.punchHand||-1);
          // a punch of an untrained adult: ~8 % of the player's health, a shove of ~1.5 m/s
          if(T.npc){try{window.dispatchEvent(new CustomEvent("arondight:pedestrian-brawl",{detail:{id:a.id,foeId:foe.id,weapon:"fists",dir:[dx/d,dy/d]}}));}catch{}}
          else{globalThis.__arondightPlayerDamageModel?.damage?.(8,"punch:pedestrian");W.push?.({x:dx/d*1.5,y:dy/d*1.5,z:0});}try{window.dispatchEvent(new CustomEvent("arondight:pedestrian-punch",{detail:{id:a.id}}));}catch{}}}
        return;}}
    a.fightUntil=0;a.annoy=0;a.foe=null;const route=net.get(a.route)||net.get(a.home);if(route){projectOnRoute(route,a.x,a.y,J);a.route=route.key;a.s=J.s;a.side=J.lateral>=0?1:-1;}a.legs.length=0;a.state="wait";a.waitUntil=now+1200;return;}
  // frightened (a shot, a blast): run away from it, then calm down and find the way again
  if(a.fleeUntil){if(now<a.fleeUntil){/* the first seconds after a fright are a real sprint (≈4.5 m/s, what an untrained adult manages), then a fast run */const top=now<(a.fleeBurstUntil||0)?Math.max(a.fleeSpeed,4.5):a.fleeSpeed;a.v+=clamp(top-a.v,-3*dt,3.2*dt);if(!freeMove(a,a.fleeX,a.fleeY,a.v*dt,{keep:true})){a.fleeX=-a.fleeX;a.fleeY=-a.fleeY;}turn(a,Math.atan2(a.fleeY,a.fleeX),dt*3);a.state="flee";return;}
    a.fleeUntil=0;a.crossing=false;const L=a.leader;a.leader=null;if(L&&L.alive&&!L.removed){a.leader=L;a.state=L.state;return;}const route=net.get(a.route)||net.get(a.home);if(route){projectOnRoute(route,a.x,a.y,J);a.route=route.key;a.s=J.s;a.side=J.lateral>=0?1:-1;}a.legs.length=0;a.state="wait";a.waitUntil=now+800+agentRandom(a)*1500;return;}
  if(a.leader){const L=a.leader;if(!L.alive||L.removed||L.knocked){detach(a,net,now);return;}
    // companions walk beside / behind their leader, on their own legs (bounded pace, no snapping),
    // always on the house side of the leader, never on the road side
    const c=Math.cos(L.yaw),s=Math.sin(L.yaw),lr=net.get(L.route);let ox=-s,oy=c;
    if(lr){routePointInto(lr,L.s,0,P);const nx=L.x-P.x,ny=L.y-P.y,nd=Math.hypot(nx,ny);if(nd>.5){ox=nx/nd;oy=ny/nd;}}
    const side=Math.abs(a.lat),tx=L.x+c*a.fwd+ox*side,ty=L.y+s*a.fwd+oy*side,dx=tx-a.x,dy=ty-a.y,d=Math.hypot(dx,dy);
    const want=d>.2?Math.min(a.speed*1.9,Math.max(L.v,d*1.2)):L.v;a.v+=clamp(want-a.v,-3*dt,2*dt);const step=Math.min(d,a.v*dt);
    if(d>1e-6){a.x+=dx/d*step;a.y+=dy/d*step;}turn(a,a.v>.25&&d>.2?Math.atan2(dy,dx):L.yaw,dt);a.state=L.state;a.trip=L.trip;a.dest=L.dest;a.route=L.route;return;}
  if(a.state==="wait"){a.v=Math.max(0,a.v-3*dt);if(now>=a.waitUntil)planTrip(a,net,now);return;}
  let leg=a.legs[a.li];if(!leg){a.state="wait";a.waitUntil=now+800;return;}
  let route=net.get(leg.route);if(!route){// the street left the network (far away): stand and re-plan on the nearest known one
    a.state="wait";a.waitUntil=now+1500;a.legs.length=0;const home=net.get(a.home);if(home){projectOnRoute(home,a.x,a.y,J);a.route=home.key;a.s=J.s;}return;}
  if(a.route!==leg.route){a.route=leg.route;a.s=clamp(leg.fromS,0,route.length);}
  if(!leg.side)leg.side=sideNearest(route,a.s,a.off,a.x,a.y);a.side=leg.side;
  const toS=clamp(leg.toS,0,route.length),ds=toS-a.s,dir=ds>=0?1:-1,look=Math.min(Math.abs(ds),LOOK_M);
  routePointInto(route,a.s+dir*look,a.side*a.off,P);
  // a street to cross first: wait at the kerb until the road is clear (cars do not stop for them)
  const gap=Math.hypot(P.x-a.x,P.y-a.y);if(gap>CROSS_GAP_M&&!a.crossing&&(projectOnRoute(route,a.x,a.y,J).lateral>=0?1:-1)!==a.side){if(net.crossingClear&&!net.crossingClear(a.x,a.y,P.x,P.y)){a.v=Math.max(0,a.v-4*dt);turn(a,Math.atan2(P.y-a.y,P.x-a.x),dt);
      // no gap for a long time: give up on this way and go somewhere else
      a.kerbSince||=now;if(now-a.kerbSince>15000){a.kerbSince=0;a.legs.length=0;a.state="wait";a.waitUntil=now+500;}return;}a.crossing=true;a.kerbSince=0;}else if(gap<1)a.crossing=false;
  a.v+=clamp((a.crossing?a.speed*1.15:a.speed)-a.v,-3*dt,1.5*dt);
  const dx=P.x-a.x,dy=P.y-a.y,d=Math.hypot(dx,dy),step=Math.min(d,a.v*dt);
  if(net.crossingClear&&d>1e-6&&!a.crossing){const look=Math.max(step,.4),c=sideStreetAhead(a,route,a.x+dx/d*look,a.y+dy/d*look,net);
    if(c){if(!net.crossingClear(a.x,a.y,2*c.x-a.x,2*c.y-a.y)){a.v=Math.max(0,a.v-4*dt);a.kerbSince||=now;if(now-a.kerbSince>15000){a.kerbSince=0;a.legs.length=0;a.state="wait";a.waitUntil=now+500;}return;}a.crossing=true;a.kerbSince=0;}}
  if(d>1e-6){a.x+=dx/d*step;a.y+=dy/d*step;if(d>.05)turn(a,Math.atan2(dy,dx),dt);}
  // the point ahead moves on only while the body keeps up with it (corners, crossings): a carrot, not a rail
  if(Math.hypot(P.x-a.x,P.y-a.y)<CATCHUP_M)a.s+=dir*Math.min(Math.abs(ds),a.v*dt);
  if(Math.abs(toS-a.s)<.05&&Math.hypot(P.x-a.x,P.y-a.y)<ARRIVE_M){a.li++;const nx=a.legs[a.li];
    if(!nx){a.state="wait";a.waitUntil=now+(2+agentRandom(a)*7)*1000;return;}
    if(nx.route!==a.route){const r2=net.get(nx.route);if(r2){a.route=nx.route;a.s=clamp(nx.fromS,0,r2.length);}}}
}

// The people who live on a street: a count proportional to its length (stable spatial density), at
// seeded places; one in three walks with company (pairs and small groups).
export function seedRouteAgents(route,{spacingM=14,cap=30,salt=""}={}){
  const out=[],rk=hashText(`${salt}:${route.key}`),n=clamp(Math.round(route.length/spacingM),1,cap),tag=rk.toString(36);
  for(let i=0;i<n;){const lead=makeAgent(`person-${tag}-${i}`,hashText(`${rk}:${i}`),route,(i+.5)/n*route.length);out.push(lead);i++;
    const r=agentRandom(lead),size=r<.62?1:r<.9?2:3;
    for(let k=1;k<size&&i<n;k++,i++){const f=makeAgent(`person-${tag}-${i}`,hashText(`${rk}:${i}`),route,lead.s);f.leader=lead;f.fwd=k===1?0:-1.3;f.lat=(k===1?-.75:-.35)*lead.side;
      routePointInto(route,lead.s,0,P);const c=Math.cos(lead.yaw),s=Math.sin(lead.yaw),nx=lead.x-P.x,ny=lead.y-P.y,nd=Math.hypot(nx,ny)||1,side=Math.abs(f.lat);f.x=lead.x+c*f.fwd+nx/nd*side;f.y=lead.y+s*f.fwd+ny/nd*side;f.yaw=lead.yaw;f.speed=lead.speed;out.push(f);}}
  return out;
}
export function makeAgent(id,seed,route,s){
  const a={id,seed,rs:seed,home:route.key,route:route.key,s:clamp(s,0,route.length),side:seed&1?1:-1,off:3.4+((seed>>>3)%9)*.06,x:0,y:0,yaw:0,v:0,speed:1.0+((seed>>>7)%66)/100,
    legs:[],li:0,trip:0,dest:null,state:"wait",waitUntil:0,leader:null,fwd:0,lat:0,alive:true,removed:false,knocked:false,crossing:false,kerbSince:0,fleeUntil:0,fleeX:0,fleeY:0,fleeSpeed:0};
  routePointInto(route,a.s,a.side*a.off,P);a.x=P.x;a.y=P.y;a.yaw=Math.atan2(P.ty,P.tx)+(seed&2?Math.PI:0);a.waitUntil=0;return a;
}
// something frightening happened at (x,y): run away from it for a few seconds
export function frighten(a,x,y,now,{ms=5600,strength=1}={}){let dx=a.x-x,dy=a.y-y,d=Math.hypot(dx,dy);if(d<.3){const t=agentRandom(a)*Math.PI*2;dx=Math.cos(t);dy=Math.sin(t);d=1;}a.fleeX=dx/d;a.fleeY=dy/d;a.fleeSpeed=Math.min(3.3,a.speed+1.1+.5*strength); /* an everyday person running away: 2.5-3.3 m/s, not a sprinter */a.fleeUntil=now+ms*(.8+.4*agentRandom(a));if(strength>=1.2)a.fleeBurstUntil=now+1500+agentRandom(a)*900;}
// annoyed by the player (bumped, shoved, punched). Everyone has a temper (fixed per person):
// most people are fearful (they back off when bumped and run when hit), about a quarter run at
// once, and only a few (~15 %) are aggressive and square up — a punch makes those fight back.
export function temperOf(a){if(a.temper===undefined){const r=agentRandom(a);a.temper=r<.15?"aggressive":r<.4?"runner":"fearful";}return a.temper;}
// what an aggressive one carries (fixed per person): most only fists, some a knife (~30 %), very
// few a gun (~7 %) — across all people about 1 in 22 carries a knife and 1 in 100 a gun
export function armsOf(a){if(a.arms===undefined){const t=temperOf(a);let h=Math.imul((agentRandom(a)*4294967296)>>>0^0x9e3779b9,2654435761)>>>0;h^=h>>>15;const r=(h%10000)/10000;a.arms=t!=="aggressive"?"fists":r<.07?"gun":r<.37?"knife":"fists";}return a.arms;}
// the weapon to draw on the person while fighting (character_model weapons)
export function fightWeapon(a){if(!a?.fightUntil)return"none";const arm=armsOf(a);return arm==="gun"?"pistol":arm==="knife"?"knife":"none";}
export function provoke(a,now,{punched=false,shot=false,by=null}={}){if(!a?.alive||a.knocked)return"none";a.annoy=(a.annoy||0)+(punched?2:1);const temper=temperOf(a),W=globalThis.__arondightWalkMode;
  if(a.fightUntil){a.fightUntil=now+(by?9000:20000);if(by)a.foe=by;return"fight";}
  if(temper==="aggressive"&&(punched||a.annoy>=2||shot&&armsOf(a)!=="fists")){a.fightUntil=now+(by?9000:20000);a.foe=by||null;a.leader=null;a.fleeUntil=0;return"fight";}
  const src=by?{x:by.x,y:by.y}:W?.position;
  const run=ms=>{if(src)frighten(a,src.x,src.y,now,{ms,strength:punched?1.6:1});return"flee";};
  if(temper==="runner")return run(punched?7000:4500);
  if(punched||a.annoy>=3)return run(punched?5500:4000);
  return"annoyed";}
// a fighter's arm for the animation: + right / - left jab extension 0..1
export function punchPose(a,now){const t=now-(a.lastPunch||-1e9);if(t>320)return 0;const e=t<110?t/110:1-(t-110)/210;return(a.punchHand||1)*Math.max(0,e);}
// re-place an agent whose origin frame moved (all coordinates shift together)
export function shiftAgent(a,dx,dy){a.x+=dx;a.y+=dy;if(a.dest){a.dest.x+=dx;a.dest.y+=dy;}}
