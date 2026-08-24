export const GAMEPLAY_FUN_VERSION="skill-risk-bank-contracts-v1";
export const GAMEPLAY_COMBO_WINDOW_MS=5500;
export const GAMEPLAY_OVERDRIVE_MS=8000;
export const GAMEPLAY_MOMENTUM_TARGET=4;

export const GAMEPLAY_CONTRACTS=Object.freeze([
  Object.freeze({id:"hot-escape",name:"HOT ESCAPE",hint:"REACH 2★ · BREAK SIGHT · ESCAPE",target:1,reward:800}),
  Object.freeze({id:"drone-hunter",name:"DRONE HUNTER",hint:"DESTROY 2 POLICE DRONES",target:2,reward:950}),
  Object.freeze({id:"emp-chain",name:"EMP CHAIN",hint:"DISABLE 3 DRONES WITH EMP",target:3,reward:850}),
  Object.freeze({id:"vehicle-chaos",name:"VEHICLE CHAOS",hint:"DESTROY 3 CARS OR BUSES",target:3,reward:700}),
  Object.freeze({id:"untouchable",name:"UNTOUCHABLE",hint:"ESCAPE 2★+ WITHOUT DAMAGE",target:1,reward:1200}),
]);

const WORLD_POINTS=Object.freeze({person:90,car:150,bus:260,bird:60,player:340});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const rounded=value=>Math.max(0,Math.round((Number(value)||0)/10)*10);
const finiteNow=value=>Number.isFinite(Number(value))?Number(value):0;
const contractAt=index=>GAMEPLAY_CONTRACTS[((Math.floor(Number(index)||0)%GAMEPLAY_CONTRACTS.length)+GAMEPLAY_CONTRACTS.length)%GAMEPLAY_CONTRACTS.length];

export function createGameplayState({contractIndex=0,highScore=0}={}){
  return{score:0,atRisk:0,highScore:Math.max(0,Math.floor(Number(highScore)||0)),stars:0,maxStars:0,combo:0,bestCombo:0,comboExpiresAt:-Infinity,momentum:0,overdriveUntil:-Infinity,contractIndex:((Math.floor(Number(contractIndex)||0)%GAMEPLAY_CONTRACTS.length)+GAMEPLAY_CONTRACTS.length)%GAMEPLAY_CONTRACTS.length,contractProgress:0,contractComplete:false,contractsCompleted:0,runDamage:0,mercy:0,lastAward:0,lastLabel:"READY",eventSerial:0};
}

export function gameplayContract(state){return contractAt(state?.contractIndex);}
export function gameplayPoliceDamageScale(state){return[1,.88,.76][clamp(Math.floor(Number(state?.mercy)||0),0,2)];}
export function gameplayMultiplier(state,{stars=state?.stars,now=0}={}){
  const heat=clamp(stars,0,5),combo=clamp(state?.combo,0,20),base=1+heat*.25+Math.floor(combo/2)*.20,overdrive=finiteNow(now)<Number(state?.overdriveUntil)?1.75:1;return Math.min(4.5,base*overdrive);
}

function updateClock(state,event){
  const next={...state},now=finiteNow(event.now);next.stars=clamp(event.stars??next.stars,0,5);next.maxStars=Math.max(next.maxStars,next.stars);if(next.combo>0&&now>=next.comboExpiresAt){next.combo=0;next.comboExpiresAt=-Infinity;}return{next,now};
}

function contractDelta(state,event){
  const contract=gameplayContract(state),stars=Math.max(Number(event.stars)||0,state.maxStars,state.stars);
  if(contract.id==="hot-escape")return event.type==="escape"&&stars>=2?1:0;
  if(contract.id==="drone-hunter")return event.type==="policeKill"?1:0;
  if(contract.id==="emp-chain")return event.type==="emp"?Math.max(0,Math.floor(Number(event.affected)||0)):0;
  if(contract.id==="vehicle-chaos")return event.type==="worldKill"&&(event.kind==="car"||event.kind==="bus")?1:0;
  if(contract.id==="untouchable")return event.type==="escape"&&stars>=2&&state.runDamage===0?1:0;
  return 0;
}

function progressContract(state,event,effects){
  if(state.contractComplete)return state;const contract=gameplayContract(state),delta=contractDelta(state,event);if(delta<=0)return state;const next={...state,contractProgress:Math.min(contract.target,state.contractProgress+delta)};if(next.contractProgress>=contract.target){next.contractComplete=true;next.contractsCompleted++;next.score+=contract.reward;next.highScore=Math.max(next.highScore,next.score);effects.push({type:"contractComplete",name:contract.name,reward:contract.reward});}else effects.push({type:"contractProgress",name:contract.name,progress:next.contractProgress,target:contract.target});return next;
}

function skillAward(state,event,{base,label,momentum=1}={}){
  const effects=[],clock=updateClock(state,event),now=clock.now;let next=clock.next;next.combo+=1;next.bestCombo=Math.max(next.bestCombo,next.combo);next.comboExpiresAt=now+GAMEPLAY_COMBO_WINDOW_MS;next.momentum+=Math.max(0,Math.floor(Number(momentum)||0));let surgeBonus=0;
  if(next.momentum>=GAMEPLAY_MOMENTUM_TARGET){next.momentum-=GAMEPLAY_MOMENTUM_TARGET;next.overdriveUntil=now+GAMEPLAY_OVERDRIVE_MS;surgeBonus=250+Math.min(250,next.combo*25);effects.push({type:"overdrive",durationMs:GAMEPLAY_OVERDRIVE_MS,bonus:surgeBonus});}
  const multiplier=gameplayMultiplier(next,{stars:next.stars,now}),award=rounded((Number(base)||0)*multiplier+surgeBonus);next.atRisk+=award;next.lastAward=award;next.lastLabel=String(label||"SKILL");next.eventSerial++;effects.push({type:"award",label:next.lastLabel,points:award,multiplier,combo:next.combo,atRisk:next.atRisk});next=progressContract(next,event,effects);return{state:next,effects};
}

function rotateContract(state,effects,type){const next={...state,contractIndex:(state.contractIndex+1)%GAMEPLAY_CONTRACTS.length,contractProgress:0,contractComplete:false};effects.push({type,name:gameplayContract(next).name});return next;}

export function reduceGameplay(state,event={}){
  const current=state||createGameplayState(),type=String(event.type||"tick");
  if(type==="worldKill"){const kind=String(event.kind||"unknown"),base=WORLD_POINTS[kind]||100;return skillAward(current,{...event,type,kind},{base,label:kind==="person"?"TARGET DOWN":kind==="bus"?"BUS WRECKED":kind==="car"?"CAR WRECKED":"HIT CONFIRMED"});}
  if(type==="policeKill")return skillAward(current,{...event,type},{base:430,label:"POLICE DRONE DOWN",momentum:2});
  if(type==="emp"&&Number(event.affected)>0)return skillAward(current,{...event,type},{base:120*Math.floor(Number(event.affected)),label:`EMP ×${Math.floor(Number(event.affected))}`,momentum:Number(event.affected)>=2?2:1});
  const effects=[],clock=updateClock(current,event),now=clock.now;let next=clock.next;
  if(type==="escape"){
    const peak=Math.max(next.maxStars,next.stars,Number(event.stars)||0),payout=rounded(next.atRisk+peak*220+Math.max(0,next.combo-1)*35);next=progressContract(next,{...event,type,stars:peak},effects);next.score+=payout;next.atRisk=0;next.highScore=Math.max(next.highScore,next.score);next.combo=0;next.comboExpiresAt=-Infinity;next.momentum=Math.min(next.momentum,GAMEPLAY_MOMENTUM_TARGET-1);next.maxStars=0;next.stars=0;next.runDamage=0;next.mercy=Math.max(0,next.mercy-1);next.lastAward=payout;next.lastLabel="ESCAPED";next.eventSerial++;effects.unshift({type:"bank",points:payout,peakStars:peak,score:next.score});return{state:next,effects};
  }
  if(type==="damage"){
    const broken=next.combo,amount=Math.max(0,Number(event.amount)||0);next.runDamage+=amount;next.combo=0;next.comboExpiresAt=-Infinity;next.momentum=Math.max(0,next.momentum-1);if(broken>1)effects.push({type:"comboBreak",combo:broken});return{state:next,effects};
  }
  if(type==="droneDestroyed"){
    const lost=rounded(next.atRisk*.20);next.atRisk=Math.max(0,next.atRisk-lost);next.combo=0;next.comboExpiresAt=-Infinity;next.momentum=0;next.mercy=Math.min(2,next.mercy+1);next.lastLabel="DRONE LOST";effects.push({type:"setback",label:"DRONE LOST",lost,insured:next.atRisk,mercy:next.mercy});return{state:next,effects};
  }
  if(type==="playerDeath"){
    const insured=rounded(next.atRisk*.50),lost=Math.max(0,next.atRisk-insured);next.score+=insured;next.atRisk=0;next.highScore=Math.max(next.highScore,next.score);next.combo=0;next.comboExpiresAt=-Infinity;next.momentum=0;next.mercy=2;next.lastLabel="BUSTED";effects.push({type:"insurance",insured,lost,score:next.score,mercy:next.mercy});return{state:next,effects};
  }
  if(type==="cycleContract")next=rotateContract(next,effects,"contractChanged");
  else if(type==="advanceContract"&&next.contractComplete)next=rotateContract(next,effects,"contractChanged");
  else if(type==="reset"){const lost=next.atRisk;next={...next,atRisk:0,combo:0,comboExpiresAt:-Infinity,momentum:0,overdriveUntil:-Infinity,maxStars:0,stars:0,runDamage:0,lastAward:0,lastLabel:"RUN RESET"};if(lost>0)effects.push({type:"setback",label:"RUN RESET",lost,insured:0,mercy:next.mercy});}
  void now;return{state:next,effects};
}
