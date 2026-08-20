import {VS_GAME_EVENT} from "./lan_vs.mjs";

const CLOCK_SYNC_MS=2000;
const MAX_CLOCK_SKEW_MS=120000;
let installed=false,timer=0,clockSeq=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function session(){return bridge()?.vsSession||null;}
function viewport(){return globalThis.document?.getElementById?.("viewport")||null;}
function selfId(s){try{return String(s?.getSelfId?.()||"");}catch{return"";}}
function authorityId(s){try{return String(s?.getAuthorityId?.()||"");}catch{return"";}}

function publishClock(){
  const b=bridge(),s=session(),self=selfId(s),authority=authorityId(s);if(!b||!s||!self||authority!==self||typeof s.sendGame!=="function")return false;
  const peers=typeof s.getPeerIds==="function"?s.getPeerIds():[];if(Array.isArray(peers)&&!peers.length)return false;
  const hp=Math.max(0,Math.min(100,Math.round(Number(b.vsLocalHealth) || 0))),killed=Boolean(b.vsLocalDead||hp<=0),worldT=Date.now();
  s.sendGame({type:"state",playerId:self,hp,killed,by:"",id:`world-clock-${worldT.toString(36)}-${(++clockSeq).toString(36)}`,clockOnly:true,worldT});
  const view=viewport();if(view){view.dataset.worldClockAuthority=self;view.dataset.worldClockPublished=String((Number(view.dataset.worldClockPublished)||0)+1);}return true;
}

function onGame(event){
  const packet=event?.detail?.packet,peerId=String(event?.detail?.peerId||""),s=session(),authority=authorityId(s);if(packet?.type!=="state"||packet.clockOnly!==true||!Number.isFinite(Number(packet.worldT))||!peerId||peerId!==authority||authority===selfId(s))return;
  const observed=Number(packet.worldT)-Date.now();if(Math.abs(observed)>MAX_CLOCK_SKEW_MS)return;const b=bridge();if(!b)return;const previous=Number(b.__vsWorldClockOffsetMs),next=Number.isFinite(previous)?previous*.78+observed*.22:observed;b.__vsWorldClockOffsetMs=next;
  const view=viewport();if(view){view.dataset.worldClockAuthority=authority;view.dataset.worldClockOffsetMs=next.toFixed(1);view.dataset.worldClockSynced="1";}
}

export function worldPopulationEpochSeconds(nowMs=Date.now(),b=bridge()){const offset=Number(b?.__vsWorldClockOffsetMs);return(Number(nowMs)+(Number.isFinite(offset)?offset:0))/1000;}
export function installWorldPopulationClock(){if(installed)return;installed=true;globalThis.addEventListener?.(VS_GAME_EVENT,onGame);publishClock();timer=globalThis.setInterval?.(publishClock,CLOCK_SYNC_MS)||0;}
export function worldPopulationClockState(){return{installed,timer,offsetMs:Number(bridge()?.__vsWorldClockOffsetMs)||0};}
