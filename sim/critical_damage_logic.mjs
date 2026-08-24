const PROFILES=Object.freeze({
  car:Object.freeze({ratio:.20,delayMs:2450,acceleratedMs:620}),
  bus:Object.freeze({ratio:.20,delayMs:3100,acceleratedMs:720}),
  "police-drone":Object.freeze({ratio:.34,delayMs:2200,acceleratedMs:560}),
  drone:Object.freeze({ratio:.28,delayMs:2050,acceleratedMs:540}),
});

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export function criticalDamageProfile(kind){
  return PROFILES[String(kind||"")]||null;
}

export function isCriticalDamage(kind,hp,maxHp){
  const profile=criticalDamageProfile(kind),maximum=Math.max(0,Number(maxHp)||0),remaining=clamp(hp,0,maximum);
  return Boolean(profile&&maximum>0&&remaining<=maximum*profile.ratio);
}

export function criticalDetonationAt(kind,now=0){
  const profile=criticalDamageProfile(kind);
  return Number(now)+(profile?.delayMs||0);
}

export function accelerateCriticalDetonation(kind,currentAt,now=0){
  const profile=criticalDamageProfile(kind);
  if(!profile)return Number(currentAt)||Number(now);
  return Math.min(Number(currentAt)||Infinity,Number(now)+profile.acceleratedMs);
}

export const CRITICAL_DAMAGE_PROFILES=PROFILES;
