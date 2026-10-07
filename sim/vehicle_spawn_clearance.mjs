// Separating-axis test in metres. Reject overlapping spawn footprints before
// introducing a rigid body; the solver must not eject stacked spawn vehicles.
export function vehicleFootprintsOverlap(a,b,margin=.35){
  const axes=p=>[[Math.cos(p.yaw),Math.sin(p.yaw)],[-Math.sin(p.yaw),Math.cos(p.yaw)]],aa=axes(a),bb=axes(b),dx=b.x-a.x,dy=b.y-a.y;
  const radius=(p,basis,u)=>p.half[0]*Math.abs(basis[0][0]*u[0]+basis[0][1]*u[1])+p.half[1]*Math.abs(basis[1][0]*u[0]+basis[1][1]*u[1]);
  return [...aa,...bb].every(u=>Math.abs(dx*u[0]+dy*u[1])<radius(a,aa,u)+radius(b,bb,u)+margin);
}
