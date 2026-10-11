// Pure state machine, shared by tests and elected-peer seat coordinator.
const id = s => typeof s === 'string' && s.length > 0 && s.length <= 128 && !s.includes('|');
const roles = new Set(['pilot', 'passenger']);
export class JetSeatTable {
  constructor(){ this.rows = new Map(); this.revision = 0; }
  key(owner, jetId){ return `${owner}|${jetId}`; }
  get(owner, jetId){ const r=this.rows.get(this.key(owner,jetId)); return r ? {...r}: {owner,jetId,pilot:null,passenger:null}; }
  seatOf(player){for(const row of this.rows.values())for(const seat of roles)if(row[seat]===player)return {...row,seat};return null;}
  claim({owner,jetId,player,seat}){
    if(!id(owner)||!id(jetId)||!id(player)||!roles.has(seat))return {ok:false,reason:'invalid'};
    if(seat==='pilot'&&player!==owner)return {ok:false,reason:'owner-only-pilot'};
    const before=this.seatOf(player),key=this.key(owner,jetId),current=this.get(owner,jetId);
    if(before&&!(before.owner===owner&&before.jetId===jetId&&before.seat===seat))return {ok:false,reason:'already-seated'};
    if(current[seat]===player)return {ok:true,row:current,changed:false};
    if(current[seat])return {ok:false,reason:'seat-occupied'};
    if(seat==='passenger'&&!current.pilot)return {ok:false,reason:'no-pilot'};
    current[seat]=player;this.rows.set(key,current);this.revision++;
    return {ok:true,row:{...current},changed:true};
  }
  release({owner,jetId,player,seat}){
    if(!id(owner)||!id(jetId)||!id(player)||!roles.has(seat))return {ok:false,reason:'invalid'};
    const key=this.key(owner,jetId),current=this.rows.get(key);
    if(!current||current[seat]!==player)return {ok:false,reason:'not-occupant'};
    current[seat]=null;
    if(seat==='pilot')current.passenger=null; // failsafe: no unmanaged flight
    if(!current.pilot&&!current.passenger)this.rows.delete(key);
    this.revision++;return {ok:true,row:this.get(owner,jetId),changed:true};
  }
  drop(player){
    let changed=false;
    for(const [key,r] of this.rows){
      if(r.pilot===player){this.rows.delete(key);changed=true;continue;}
      if(r.passenger===player){r.passenger=null;changed=true;}
    }
    if(changed)this.revision++;return changed;
  }
  snapshot(){return {revision:this.revision,rows:[...this.rows.values()].map(r=>({...r}))};}
  load(value){
    if(!value||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.rows)||value.rows.length>64)return false;
    const incoming=new Map(),players=new Set();
    for(const r of value.rows){
      if(!id(r?.owner)||!id(r.jetId)||!id(r.pilot)||r.pilot!==r.owner || (r.passenger!=null&&!id(r.passenger)))return false;
      if(r.passenger===r.pilot||players.has(r.pilot)||(r.passenger&&players.has(r.passenger)))return false;
      const k=this.key(r.owner,r.jetId);if(incoming.has(k))return false;
      players.add(r.pilot);if(r.passenger)players.add(r.passenger);
      incoming.set(k,{owner:r.owner,jetId:r.jetId,pilot:r.pilot,passenger:r.passenger||null});
    }
    this.rows=incoming;this.revision=value.revision;return true;
  }
}
