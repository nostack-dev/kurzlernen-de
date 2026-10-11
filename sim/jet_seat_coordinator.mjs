import {JetSeatTable} from './jet_seat_table.mjs';
import {VS_PEER_EVENT} from './lan_vs.mjs';
export const JET_SEATS_VERSION='peer-authority-seats-v1';
const isId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
export class JetSeatCoordinator {
  constructor(getSession){
    this.getSession=getSession;this.table=new JetSeatTable();this.room=null;this.action=null;this.nonce=0;
    this.pending=new Map();this.lastAuthority='';this.appliedAuthority='';this.lastSync=0;
    globalThis.addEventListener?.(VS_PEER_EVENT,e=>{
      if(e?.detail?.type==='leave'&&this.host()&&this.table.drop(String(e.detail.peerId||'')))this.broadcast();
    });
  }
  session(){return this.getSession?.()||null;}
  active(){const s=this.session();return s?.active||s;}
  self(){return String(this.session()?.getSelfId?.()||this.active()?.getSelfId?.()||(!this.room?'solo':''));}
  authority(){return String(this.session()?.getAuthorityId?.()||this.active()?.getAuthorityId?.()||'');}
  host(){return !!this.self()&&this.self()===this.authority();}
  get(owner,jetId){return this.table.get(owner,jetId);}
  occupant(player){return this.table.seatOf(player);}
  emit(){globalThis.dispatchEvent?.(new CustomEvent('arondight:jet-seats',{detail:this.table.snapshot()}));}
  ensure(){
    const room=this.active()?.room||null;
    if(room!==this.room){
      for(const p of this.pending.values()){clearTimeout(p.timer);p.resolve({ok:false,reason:'room-changed'});}
      this.pending.clear();this.room=room;this.action=null;this.lastAuthority='';this.appliedAuthority='';this.lastSync=0;
      this.table=new JetSeatTable();
      if(room?.makeAction){try{const a=room.makeAction('jet-seats-v1');a.onMessage=(packet,meta)=>this.receive(packet,meta?.peerId);this.action=a;}catch(e){console.warn('Jet seat transport unavailable',e);}}
    }
    const leader=this.authority();
    if(leader&&leader!==this.lastAuthority){this.lastAuthority=leader;this.lastSync=0;}
    return this.action;
  }
  send(packet,target){
    if(!this.action?.send)return false;
    try{Promise.resolve(this.action.send(packet,target?{target}:{})).catch(()=>{});return true;}catch{return false;}
  }
  broadcast(){this.emit();if(this.action)this.send({v:1,op:'state',...this.table.snapshot()});}
  apply(packet,peerId){
    if(!this.authority()||peerId!==this.authority())return;
    if(this.appliedAuthority===peerId&&packet.revision<this.table.revision)return;
    if(this.table.load(packet)){this.appliedAuthority=peerId;this.emit();}
  }
  receive(packet,peerId){
    if(!packet||packet.v!==1||!isId(peerId))return;
    if(packet.op==='state'){if(!this.host())this.apply(packet,peerId);return;}
    if(packet.op==='ack'){
      if(peerId!==this.authority())return;
      this.apply(packet,peerId);
      const waiting=this.pending.get(packet.id);
      if(!waiting)return;clearTimeout(waiting.timer);this.pending.delete(packet.id);
      waiting.resolve({ok:packet.ok===true,reason:packet.reason||'',row:this.table.get(waiting.owner,waiting.jetId)});
      return;
    }
    if(packet.op==='hello'){if(this.host())this.send({v:1,op:'state',...this.table.snapshot()},peerId);return;}
    if(!this.host()||!['claim','release'].includes(packet.op)||!isId(packet.id))return;
    const {owner,jetId,seat}=packet;
    const result=packet.op==='claim'?this.table.claim({owner,jetId,seat,player:peerId}):this.table.release({owner,jetId,seat,player:peerId});
    this.send({v:1,op:'ack',id:packet.id,ok:result.ok,reason:result.reason||'',...this.table.snapshot()},peerId);
    if(result.changed)this.broadcast();
  }
  command(op,owner,jetId,seat){
    this.ensure();const self=this.self();
    if(!isId(self)||!isId(owner)||!isId(jetId)||!['pilot','passenger'].includes(seat))return Promise.resolve({ok:false,reason:'invalid'});
    // No session: single-player runs locally. Existing connected rooms fail closed.
    if(!this.room)return Promise.resolve(op==='claim'?this.table.claim({owner,jetId,seat,player:self}):this.table.release({owner,jetId,seat,player:self}));
    if(this.host()){
      const result=op==='claim'?this.table.claim({owner,jetId,seat,player:self}):this.table.release({owner,jetId,seat,player:self});
      if(result.changed)this.broadcast();return Promise.resolve(result);
    }
    if(!this.action||!isId(this.authority()))return Promise.resolve({ok:false,reason:'authority-unavailable'});
    const nonce=`${self}-${Date.now().toString(36)}-${(++this.nonce).toString(36)}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.pending.delete(nonce);resolve({ok:false,reason:'timeout'});},3000);
      this.pending.set(nonce,{resolve,timer,owner,jetId});
      if(!this.send({v:1,op,id:nonce,owner,jetId,seat},this.authority())){
        clearTimeout(timer);this.pending.delete(nonce);resolve({ok:false,reason:'send-failed'});
      }
    });
  }
  claim(owner,jetId,seat){return this.command('claim',owner,jetId,seat);}
  release(owner,jetId,seat){return this.command('release',owner,jetId,seat);}
  tick(now=performance.now()){
    this.ensure();if(!this.action)return;
    if(now-this.lastSync<1500)return;this.lastSync=now;
    if(this.host())this.broadcast();else this.send({v:1,op:'hello'},this.authority());
  }
}
