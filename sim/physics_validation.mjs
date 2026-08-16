export const PHYSICS_VALIDATION_SCHEMA="arondight45-physics-validation-v1";

// Project acceptance tolerances. They are deliberately expressed in physical
// units and evaluated only on a chronological holdout segment. Passing these
// gates means "validated to these tolerances for this airframe/log envelope";
// it never means mathematically exact or valid outside the measured envelope.
export const PHYSICS_VALIDATION_THRESHOLDS=Object.freeze({
  minimumSamples:60,
  minimumLogDurationS:12,
  minimumHoldoutDurationS:3,
  minimumHoldoutObservations:10,
  collectiveMotorSpanUs:250,
  differentialMotorSpanUs:100,
  positionRmseM:.20,
  velocityRmseMps:.35,
  attitudeRmseDeg:2.5,
  yawRmseDeg:4,
  batteryRmseV:.30,
  currentRmseA:3.5,
  holdoutNrmseGrowth:1.8,
  holdoutNrmseSlack:.05,
});

const finite=value=>Number.isFinite(Number(value));
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export function angleErrorDeg(simulated,measured){
  let difference=(Number(simulated)-Number(measured))%360;
  if(difference>180)difference-=360;
  if(difference<-180)difference+=360;
  return difference;
}

// The split point is shared only as the measured initial condition for the
// holdout replay. No holdout residual is used while fitting parameters.
export function partitionCalibrationLog(samples,{trainingFraction=.70}={}){
  if(!Array.isArray(samples)||samples.length<4)throw Error("Need at least 4 ordered log samples for train/holdout replay");
  const splitIndex=clamp(Math.floor((samples.length-1)*trainingFraction),2,samples.length-2);
  return{
    splitIndex,
    training:samples.slice(0,splitIndex+1),
    holdout:samples.slice(splitIndex),
  };
}

function duration(samples){
  if(!samples?.length)return 0;
  return Math.max(0,Number(samples.at(-1)?.time_s)-Number(samples[0]?.time_s))||0;
}

export function calibrationEvidence(samples){
  const collective=[],differential=[];
  for(const sample of samples||[]){
    const motors=[sample.motor1_us,sample.motor2_us,sample.motor3_us,sample.motor4_us].map(Number);
    if(!motors.every(Number.isFinite))continue;
    collective.push(motors.reduce((sum,value)=>sum+value,0)/motors.length);
    differential.push(Math.max(...motors)-Math.min(...motors));
  }
  const span=values=>values.length?Math.max(...values)-Math.min(...values):0;
  return{
    samples:samples?.length||0,
    durationS:duration(samples),
    collectiveMotorSpanUs:span(collective),
    differentialMotorSpanUs:differential.length?Math.max(...differential):0,
  };
}

const METRIC_DEFINITIONS=Object.freeze({
  position:{fields:["x","y","z"],threshold:"positionRmseM",unit:"m"},
  velocity:{fields:["vx","vy","vz"],threshold:"velocityRmseMps",unit:"m/s"},
  attitude:{fields:["roll_deg","pitch_deg"],threshold:"attitudeRmseDeg",unit:"deg",angle:true},
  yaw:{fields:["yaw_deg"],threshold:"yawRmseDeg",unit:"deg",angle:true},
  battery:{fields:["battery_v"],threshold:"batteryRmseV",unit:"V"},
  current:{fields:["current_a"],threshold:"currentRmseA",unit:"A"},
});

export function summarizeValidationComparisons(comparisons){
  const accumulators=Object.fromEntries(Object.keys(METRIC_DEFINITIONS).map(name=>[name,{sumSquared:0,observations:0,samples:0}]));
  for(const comparison of comparisons||[]){
    const measured=comparison?.measured||{},simulated=comparison?.simulated||{};
    for(const[name,definition]of Object.entries(METRIC_DEFINITIONS)){
      const accumulator=accumulators[name];let sampleObserved=false;
      for(const field of definition.fields){
        if(!finite(measured[field])||!finite(simulated[field]))continue;
        const error=definition.angle?angleErrorDeg(simulated[field],measured[field]):Number(simulated[field])-Number(measured[field]);
        accumulator.sumSquared+=error*error;accumulator.observations++;sampleObserved=true;
      }
      if(sampleObserved)accumulator.samples++;
    }
  }
  return Object.fromEntries(Object.entries(METRIC_DEFINITIONS).map(([name,definition])=>{
    const value=accumulators[name];
    return[name,{rmse:value.observations?Math.sqrt(value.sumSquared/value.observations):null,observations:value.observations,samples:value.samples,unit:definition.unit,thresholdKey:definition.threshold}];
  }));
}

export function evaluatePhysicsValidation({allSamples,trainingSamples,holdoutSamples,comparisons,trainNrmse,holdoutNrmse,thresholds=PHYSICS_VALIDATION_THRESHOLDS}){
  const evidence=calibrationEvidence(allSamples),trainingEvidence=calibrationEvidence(trainingSamples),holdoutEvidence=calibrationEvidence(holdoutSamples),metrics=summarizeValidationComparisons(comparisons),reasons=[];
  if(evidence.samples<thresholds.minimumSamples)reasons.push(`need >=${thresholds.minimumSamples} ordered samples`);
  if(evidence.durationS<thresholds.minimumLogDurationS)reasons.push(`need >=${thresholds.minimumLogDurationS}s measured duration`);
  if(holdoutEvidence.durationS<thresholds.minimumHoldoutDurationS)reasons.push(`need >=${thresholds.minimumHoldoutDurationS}s chronological holdout`);
  for(const[label,segment]of [["training",trainingEvidence],["holdout",holdoutEvidence]]){
    if(segment.collectiveMotorSpanUs<thresholds.collectiveMotorSpanUs)reasons.push(`${label} collective motor excitation <${thresholds.collectiveMotorSpanUs}us`);
    if(segment.differentialMotorSpanUs<thresholds.differentialMotorSpanUs)reasons.push(`${label} differential motor excitation <${thresholds.differentialMotorSpanUs}us`);
  }
  if(!Number.isFinite(trainNrmse)||!Number.isFinite(holdoutNrmse))reasons.push("normalized train/holdout error unavailable");
  else if(holdoutNrmse>trainNrmse*thresholds.holdoutNrmseGrowth+thresholds.holdoutNrmseSlack)reasons.push("holdout error indicates overfit or changed flight envelope");
  for(const[name,metric]of Object.entries(metrics)){
    const limit=thresholds[metric.thresholdKey];
    if(metric.samples<thresholds.minimumHoldoutObservations){reasons.push(`${name} holdout coverage <${thresholds.minimumHoldoutObservations} samples`);continue;}
    if(!(metric.rmse<=limit))reasons.push(`${name} RMSE ${metric.rmse?.toFixed(3)??"n/a"}${metric.unit} >${limit}${metric.unit}`);
  }
  return{
    schema:PHYSICS_VALIDATION_SCHEMA,
    status:reasons.length?"unvalidated":"validated",
    passed:reasons.length===0,
    reasons,
    evidence,
    trainingEvidence,
    holdoutEvidence,
    trainNrmse:Number.isFinite(trainNrmse)?trainNrmse:null,
    holdoutNrmse:Number.isFinite(holdoutNrmse)?holdoutNrmse:null,
    metrics,
    thresholds:{...thresholds},
  };
}

export function validationSummary(report){
  if(!report?.passed)return`UNVALIDATED · ${report?.reasons?.[0]||"no independent real-flight holdout evidence"}`;
  return`HOLDOUT VALIDATED · nRMSE ${report.holdoutNrmse.toFixed(4)} · ${report.holdoutEvidence.durationS.toFixed(1)}s unseen trajectory`;
}
