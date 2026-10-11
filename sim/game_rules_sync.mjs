// First joiner decides initial rules. Changing a rule requires unanimous approval
// from the fixed roster at proposal time; abstention, leave or timeout means no change.
import {VS_FX_EVENT,VS_PEER_EVENT} from "./lan_vs.mjs";
import {GAME_RULE_KEYS,worldOption,setHostRules,hostRulesActive,WORLD_OPTIONS_EVENT} from "./world_options.mjs";
import {createBallot,vote} from "./rules_vote_engine.mjs";
export const GAME_RULES_SYNC_VERSION="unanimous-rules-v1";
const SEND_MS=4000;let installed=false,lastSent=-Infinity,serial=0,lastHostAt=0,ballot=null,remoteBallot=null,committing=false,epoch=0,statusMessage="Änderungen nur einstimmig";
const bridge=()=>globalThis.__arondightRealWorld||null;
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
const mp=()=>globalThis.__arondightVsMultiplayer||null;
const connected=()=>Boolean(mp()?.connected);
const host=()=>String(mp()?.authority||"");
const self=()=>String(mp()?.self||"");
const amAuthority=()=>connected()&&host()===self();
const peers=()=>[self(),...(session()?.getPeerIds?.()||[])].filter(Boolean).sort();
const ownRules=()=>Object.fromEntries(GAME_RULE_KEYS.map(k=>[k,worldOption(k)]));
function emit(kind,data={},target){const s=session();if(!s)return false;return s.sendFx({type:"impact",objectId:"game-rules",kind,id:`gr-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],...data},target?{target}:{});}
function send(){emit("world-sync-rules",{rules:ownRules()});}
function announce(text){
  statusMessage=text;
  // Rule controls belong exclusively to the title WORLD / in-game pause menus.
  // Announce state changes; never inject voting controls into the live viewport.
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("arondight:rules-vote-change",{detail:{text,pending:Boolean(remoteBallot)}}));
}
function clearBallot(reason){ballot=null;remoteBallot=null;announce(reason);}
function propose(key,value){
  if(!connected()||!GAME_RULE_KEYS.includes(key)||typeof value!=="boolean")return false;
  if(amAuthority())return begin(key,value);
  return emit("rules-propose",{key,value},host());
}
function begin(key,value){
  if(!amAuthority()||ballot||worldOption(key)===value)return false;
  const members=peers();if(members.length<2)return false;
  ballot=createBallot({id:`${self()}-${Date.now()}-${++epoch}`,key,value,host:self(),members});
  emit("rules-ballot",{ballot:{id:ballot.id,key,value,members:ballot.members,expires:ballot.expires}});
  announce(`${key}: ${value?'EIN':'AUS'} · Abstimmung 1/${members.length}`);
  return true;
}
function reply(approve){if(!remoteBallot||!connected()||self()===host())return false;
  const id=remoteBallot.id;remoteBallot=null;announce(approve?'JA gesendet':'NEIN gesendet');return emit("rules-vote",{ballotId:id,approve:Boolean(approve)},host());}
function onFx(e){const pk=e?.detail?.packet,from=String(e?.detail?.peerId||"");if(pk?.objectId!=="game-rules"||!from||!connected())return;
  if(pk.kind==="world-sync-rules"){
    if(from!==host()||amAuthority()||!pk.rules)return;
    lastHostAt=performance.now();setHostRules(pk.rules);return;
  }
  if(pk.kind==="rules-propose"){
    if(!amAuthority()||!GAME_RULE_KEYS.includes(pk.key)||typeof pk.value!=="boolean"||!peers().includes(from))return;
    begin(pk.key,pk.value);return;
  }
  if(pk.kind==="rules-ballot"){
    const b=pk.ballot;if(from!==host()||amAuthority()||!b||!GAME_RULE_KEYS.includes(b.key)||typeof b.value!=="boolean"||!Array.isArray(b.members)||b.members.join("|")!==peers().join("|")||b.expires<=Date.now()||b.expires>Date.now()+30000)return;
    remoteBallot=b;announce(`${b.key}: ${b.value?'EIN':'AUS'}? Deine Stimme fehlt.`);return;
  }
  if(pk.kind==="rules-vote"){
    if(!amAuthority()||!ballot||ballot.id!==pk.ballotId)return;
    const result=vote(ballot,from,pk.approve,peers());
    if(result==="approved"){
      const{key,value}=ballot;ballot=null;committing=true;
      try{globalThis.__arondightWorldOptions?.set(key,value);}finally{committing=false;}
      send();emit("rules-result",{ballotId:pk.ballotId,result:"approved"});announce("Einstimmig angenommen");
    }else if(result==="rejected"||result==="cancelled"){
      emit("rules-result",{ballotId:pk.ballotId,result});clearBallot("Abgelehnt / abgebrochen");
    }else if(result==="pending")announce(`${ballot.key}: ${ballot.yes.size}/${ballot.members.length} JA`);
    return;
  }
  if(pk.kind==="rules-result"&&from===host()&&!amAuthority()){
    remoteBallot=null;announce(pk.result==="approved"?"Angenommen":"Abgelehnt / abgebrochen");
  }
}
function tick(){const now=performance.now(),m=mp();
  if(amAuthority()){if(hostRulesActive())setHostRules(null);if(now-lastSent>SEND_MS){lastSent=now;send();}}
  else if(hostRulesActive()&&(!m?.connected||now-lastHostAt>20000))setHostRules(null);
  if(ballot&&(Date.now()>=ballot.expires||peers().join("|")!==ballot.members.join("|"))){emit("rules-result",{ballotId:ballot.id,result:"cancelled"});clearBallot("Abstimmung abgelaufen / Spielerwechsel");}
  if(remoteBallot&&(!connected()||Date.now()>=remoteBallot.expires||remoteBallot.members.join("|")!==peers().join("|")))clearBallot("Abstimmung abgelaufen / Spielerwechsel");
  setTimeout(tick,1000);
}
function mount(){announce(statusMessage);}
export function installGameRulesSync(){if(installed||typeof window==="undefined")return;installed=true;
  addEventListener(VS_FX_EVENT,onFx);
  addEventListener(VS_PEER_EVENT,()=>{lastSent=-Infinity;if(ballot||remoteBallot)clearBallot("Spielerwechsel: Abstimmung beendet");});
  addEventListener(WORLD_OPTIONS_EVENT,e=>{if(GAME_RULE_KEYS.includes(e?.detail?.key)&&amAuthority()&&!committing){lastSent=-Infinity;send();}});
  const initialize=()=>{mount();};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialize,{once:true});else initialize();tick();
  globalThis.__arondightRulesVote={propose,vote:reply,get ballot(){return ballot;},get remoteBallot(){return remoteBallot;},get isCommitting(){return committing;},get status(){return statusMessage;}};
}
installGameRulesSync();
