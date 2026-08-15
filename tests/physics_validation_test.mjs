import assert from "node:assert/strict";
import {
  PHYSICS_VALIDATION_SCHEMA,
  angleErrorDeg,
  calibrationEvidence,
  evaluatePhysicsValidation,
  partitionCalibrationLog,
  summarizeValidationComparisons,
  validationSummary,
} from "../sim/physics_validation.mjs";

const samples=Array.from({length:100},(_,index)=>{
  const time_s=index*.2,collective=1100+(index%50)*12,differential=index%2?80:-80;
  return{
    time_s,
    motor1_us:collective+differential,
    motor2_us:collective-differential,
    motor3_us:collective+differential*.5,
    motor4_us:collective-differential*.5,
    x:time_s*.8,
    y:Math.sin(time_s)*.4,
    z:1.5+Math.sin(time_s*.4),
    vx:.8,
    vy:Math.cos(time_s)*.4,
    vz:Math.cos(time_s*.4)*.4,
    roll_deg:Math.sin(time_s)*8,
    pitch_deg:Math.cos(time_s*.7)*10,
    yaw_deg:170+time_s*4,
    battery_v:16.8-time_s*.05,
    current_a:7+Math.sin(time_s)*2,
  };
});

assert.equal(angleErrorDeg(-179,179),2,"wrapped yaw error crosses ±180 without a 358° residual");
assert.equal(angleErrorDeg(179,-179),-2,"wrapped yaw error is symmetric");

const partition=partitionCalibrationLog(samples);
assert.equal(partition.splitIndex,69);
assert.equal(partition.training.at(-1),partition.holdout[0],"one boundary sample is shared as holdout initial condition");
assert.equal(partition.training.length+partition.holdout.length,samples.length+1,"no trajectory sample is dropped by the chronological split");

const comparisons=partition.holdout.slice(1).map(measured=>({
  measured,
  simulated:{
    ...measured,
    x:measured.x+.03,
    y:measured.y-.02,
    z:measured.z+.01,
    vx:measured.vx+.04,
    roll_deg:measured.roll_deg+.3,
    pitch_deg:measured.pitch_deg-.2,
    yaw_deg:measured.yaw_deg+.5,
    battery_v:measured.battery_v-.04,
    current_a:measured.current_a+.4,
  },
}));

const metrics=summarizeValidationComparisons(comparisons);
assert.ok(metrics.position.rmse>0&&metrics.position.rmse<.03);
assert.equal(metrics.current.samples,comparisons.length);

const evidence=calibrationEvidence(samples);
assert.ok(evidence.durationS>19&&evidence.collectiveMotorSpanUs>500&&evidence.differentialMotorSpanUs>=160);

const passing=evaluatePhysicsValidation({
  allSamples:samples,
  trainingSamples:partition.training,
  holdoutSamples:partition.holdout,
  comparisons,
  trainNrmse:.08,
  holdoutNrmse:.10,
});
assert.equal(passing.schema,PHYSICS_VALIDATION_SCHEMA);
assert.equal(passing.passed,true,passing.reasons.join("; "));
assert.match(validationSummary(passing),/^HOLDOUT VALIDATED/);

const badTrajectory=comparisons.map(entry=>({
  measured:entry.measured,
  simulated:{...entry.simulated,x:entry.measured.x+1.2},
}));
const rejected=evaluatePhysicsValidation({
  allSamples:samples,
  trainingSamples:partition.training,
  holdoutSamples:partition.holdout,
  comparisons:badTrajectory,
  trainNrmse:.03,
  holdoutNrmse:.40,
});
assert.equal(rejected.passed,false);
assert.ok(rejected.reasons.some(reason=>reason.includes("overfit")));
assert.ok(rejected.reasons.some(reason=>reason.includes("position RMSE")));
assert.match(validationSummary(rejected),/^UNVALIDATED/);

const missingElectrical=comparisons.map(({measured,simulated})=>({measured:{...measured,current_a:NaN},simulated}));
const missingRejected=evaluatePhysicsValidation({allSamples:samples,trainingSamples:partition.training,holdoutSamples:partition.holdout,comparisons:missingElectrical,trainNrmse:.08,holdoutNrmse:.10});
assert.equal(missingRejected.passed,false);
assert.ok(missingRejected.reasons.some(reason=>reason.includes("current holdout coverage")));

const noTrainingExcitation=partition.training.map(sample=>({...sample,motor1_us:1200,motor2_us:1200,motor3_us:1200,motor4_us:1200}));
const unidentifiable=evaluatePhysicsValidation({allSamples:samples,trainingSamples:noTrainingExcitation,holdoutSamples:partition.holdout,comparisons,trainNrmse:.08,holdoutNrmse:.10});
assert.equal(unidentifiable.passed,false);
assert.ok(unidentifiable.reasons.some(reason=>reason.includes("training collective motor excitation")));
assert.ok(unidentifiable.reasons.some(reason=>reason.includes("training differential motor excitation")));

console.log("physics validation train/holdout gates passed");
