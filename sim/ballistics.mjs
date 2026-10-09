// Projectile momentum: what a bullet really hands to what it hits. A bullet that stops in a
// body transfers its whole momentum p = m·v (N·s) at the hit point, along its flight path —
// no "knockback" multipliers, no upward bias. (Hollywood flings people with pistols; physics
// moves a 28 kg dog by ~0.1 m/s with a 9 mm round. What kills is the wound, not the push.)
export const PROJECTILES=Object.freeze({
  "9mm":{massKg:.008,speedMps:360},      // Glock 17 / SMG (9×19 mm, 124 gr)
  "5.56":{massKg:.004,speedMps:940},     // drone gun (5.56×45 mm)
  ".50bmg":{massKg:.0458,speedMps:890},  // anti-materiel sniper rifle (12.7×99 mm, 706 gr): 41 N·s
});
export function projectileMomentumNs(kind="9mm"){const p=PROJECTILES[kind]||PROJECTILES["9mm"];return p.massKg*p.speedMps;}
export function bulletImpulse(direction,kind="9mm"){const d=direction||{x:0,y:0,z:0},x=Number(d.x??d[0])||0,y=Number(d.y??d[1])||0,z=Number(d.z??d[2])||0,l=Math.hypot(x,y,z)||1,p=projectileMomentumNs(kind);return[x/l*p,y/l*p,z/l*p];}
