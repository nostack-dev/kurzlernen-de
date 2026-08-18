const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,Number(value)||0));
const positive=(value,name)=>{const n=Number(value);if(!(n>0))throw new Error(`${name} must be positive`);return n;};
export const MOTOR_BEARING_DRAG_NM_PER_RAD_S=1.5e-7;
export function batteryOcvVoltage(soc,cells=4){const s=clamp(soc,0,1),n=positive(cells,'batteryCells');return n*Math.min(4.2,3.2625+.9*s+.0375*Math.tanh((s-.12)*18));}
export function batteryVoltageUnderLoad(ocv,totalCurrentA,internalResistanceOhm,cells=4){const n=positive(cells,'batteryCells'),v=Number(ocv)-Math.max(0,Number(totalCurrentA)||0)*positive(internalResistanceOhm,'batteryR');return clamp(v,3*n,4.2*n);}
export function scaleCurrentsToPackLimit(currents,maxPackCurrentA){const max=positive(maxPackCurrentA,'batteryMaxCurrentA'),total=currents.reduce((sum,value)=>sum+Math.max(0,Number(value)||0),0);if(total<=max||total<=1e-12)return total;const scale=max/total;for(let i=0;i<currents.length;i++)currents[i]*=scale;return max;}
export function solveStaticPropulsionAuthority(params){
  const mass=positive(params.mass,'mass'),kv=positive(params.kv,'kv'),R=positive(params.R,'R'),Cq=positive(params.Cq,'Cq'),Ct=positive(params.Ct,'Ct'),rho=positive(params.rho,'rho'),D=positive(params.propD,'propD'),cells=positive(params.batteryCells,'batteryCells'),batteryR=positive(params.batteryR,'batteryR'),motorLimit=Math.min(positive(params.motorCurrentLimitA,'motorCurrentLimitA'),positive(params.escCurrentLimitA,'escCurrentLimitA')),packLimit=positive(params.batteryMaxCurrentA,'batteryMaxCurrentA');
  const backEmf=60/(2*Math.PI*kv),torqueConstant=backEmf,ocv=batteryOcvVoltage(1,cells),propD4=D**4,propD5=D**5;
  let voltage=ocv,omega=0,current=0,totalCurrentA=0;
  for(let outer=0;outer<32;outer++){
    const perMotorPackLimit=packLimit/4,currentLimit=Math.min(motorLimit,perMotorPackLimit),noLoad=Math.max(1,voltage/backEmf);let lo=0,hi=noLoad;
    for(let i=0;i<64;i++){
      const mid=(lo+hi)/2,n=mid/(2*Math.PI),amps=clamp((voltage-backEmf*mid)/R,0,currentLimit),motorTorque=torqueConstant*amps,loadTorque=Cq*rho*n*n*propD5+MOTOR_BEARING_DRAG_NM_PER_RAD_S*mid;
      if(motorTorque>loadTorque)lo=mid;else hi=mid;
    }
    omega=(lo+hi)/2;current=clamp((voltage-backEmf*omega)/R,0,currentLimit);totalCurrentA=Math.min(packLimit,current*4);const nextVoltage=batteryVoltageUnderLoad(ocv,totalCurrentA,batteryR,cells);if(Math.abs(nextVoltage-voltage)<1e-8){voltage=nextVoltage;break;}voltage=.55*voltage+.45*nextVoltage;
  }
  const n=omega/(2*Math.PI),perMotorThrustN=Ct*rho*n*n*propD4,totalThrustN=4*perMotorThrustN,gravity=9.80665,thrustToWeight=totalThrustN/(mass*gravity),idealVerticalAccelerationMps2=totalThrustN/mass-gravity;
  return Object.freeze({voltageV:voltage,totalCurrentA,motorCurrentA:current,rpm:n*60,perMotorThrustN,totalThrustN,thrustToWeight,idealVerticalAccelerationMps2});
}
