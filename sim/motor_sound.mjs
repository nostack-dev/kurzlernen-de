import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings,saveAudioSettings} from "./audio_settings.mjs";

const STATE_ARMED=1;
const STATE_FAULT=4;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const BASE_BLADE_HZ=100;
const BASE_MOTOR_HZ=140;

function periodicBuffer(ctx,baseHz,shape){
  const frames=ctx.sampleRate,buffer=ctx.createBuffer(1,frames,ctx.sampleRate),data=buffer.getChannelData(0);
  let mean=0;
  for(let i=0;i<frames;i++){
    const phase=((i/ctx.sampleRate)*baseHz)%1,value=shape(phase);
    data[i]=value;mean+=value;
  }
  mean/=frames;
  let peak=1e-9;
  for(let i=0;i<frames;i++){data[i]-=mean;peak=Math.max(peak,Math.abs(data[i]));}
  const gain=.92/peak;
  for(let i=0;i<frames;i++)data[i]*=gain;
  return buffer;
}

function bladeShape(phase){
  const a=2*Math.PI*phase,c=Math.max(0,Math.cos(a)),pulse=Math.pow(c,8);
  const body=.30*Math.sin(a)+.16*Math.sin(2*a+.22)+.09*Math.sin(3*a-.31)+.05*Math.sin(5*a+.17);
  return Math.tanh(2.4*(.78*pulse+body));
}

function motorShape(phase){
  const a=2*Math.PI*phase;
  let v=0;
  for(let harmonic=1;harmonic<=9;harmonic++)v+=Math.sin(harmonic*a+(harmonic%2?.10:-.08))/(harmonic**.82);
  return Math.tanh(1.15*v);
}

export class HybridMotorSound {
  constructor(viewport){
    const audio=loadAudioSettings();
    this.viewport=viewport;this.ctx=null;this.master=null;this.voices=[];this.enabled=audio.soundEnabled;this.volume=audio.droneVolume/100;this.unlocked=false;this.previousArmRequested=false;this.previousFcState=0;
    this.audioSettingsListener=event=>this.applyAudioSettings(event.detail);window.addEventListener(AUDIO_SETTINGS_EVENT,this.audioSettingsListener);
    this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor";
    this.viewport.dataset.motorAudioContextState="uninitialized";this.viewport.dataset.motorAudioArmEvent="idle";this.viewport.dataset.motorAudioEscToneCount="0";this.viewport.dataset.motorAudioEnabled=this.enabled?"1":"0";this.viewport.dataset.motorAudioVolumePct=String(audio.droneVolume);
  }
  isRunning(){return Boolean(this.ctx&&this.ctx.state==="running");}
  syncState(){this.unlocked=this.isRunning();this.viewport.dataset.motorAudioContextState=this.ctx?.state||"uninitialized";return this.unlocked;}
  applyAudioSettings(value=loadAudioSettings()){const next=normalizeAudioSettings(value);this.enabled=next.soundEnabled;this.volume=next.droneVolume/100;this.viewport.dataset.motorAudioEnabled=this.enabled?"1":"0";this.viewport.dataset.motorAudioVolumePct=String(next.droneVolume);if((!this.enabled||this.volume<=0)&&this.master&&this.ctx)this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.018);this.syncState();return next;}
  ensure(){
    if(this.ctx){this.syncState();return true;}
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return false;
    try{this.ctx=new AudioCtx({latencyHint:"interactive"});}catch{this.ctx=new AudioCtx();}
    this.master=this.ctx.createGain();this.master.gain.value=0;
    this.compressor=this.ctx.createDynamicsCompressor();this.compressor.threshold.value=-14;this.compressor.knee.value=18;this.compressor.ratio.value=3.2;this.compressor.attack.value=.0025;this.compressor.release.value=.12;
    this.master.connect(this.compressor);this.compressor.connect(this.ctx.destination);

    const bladeBuffer=periodicBuffer(this.ctx,BASE_BLADE_HZ,bladeShape),motorBuffer=periodicBuffer(this.ctx,BASE_MOTOR_HZ,motorShape);
    const noiseBuffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),noiseData=noiseBuffer.getChannelData(0);let seed=0x45a31f27;
    for(let i=0;i<noiseData.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;noiseData[i]=((seed>>>0)/2147483648)-1;}

    const detunes=[.9965,1.0025,.9984,1.0042];
    for(let i=0;i<4;i++){
      const bladeSource=this.ctx.createBufferSource(),bladeHigh=this.ctx.createBiquadFilter(),bladeLow=this.ctx.createBiquadFilter(),bladeGain=this.ctx.createGain();
      bladeSource.buffer=bladeBuffer;bladeSource.loop=true;bladeHigh.type="highpass";bladeHigh.frequency.value=65;bladeLow.type="lowpass";bladeLow.frequency.value=4200;bladeLow.Q.value=.45;bladeGain.gain.value=0;
      bladeSource.connect(bladeHigh);bladeHigh.connect(bladeLow);bladeLow.connect(bladeGain);bladeGain.connect(this.master);

      const motorSource=this.ctx.createBufferSource(),motorBand=this.ctx.createBiquadFilter(),motorGain=this.ctx.createGain();
      motorSource.buffer=motorBuffer;motorSource.loop=true;motorBand.type="bandpass";motorBand.frequency.value=1200;motorBand.Q.value=.62;motorGain.gain.value=0;
      motorSource.connect(motorBand);motorBand.connect(motorGain);motorGain.connect(this.master);

      const washNoise=this.ctx.createBufferSource(),washBand=this.ctx.createBiquadFilter(),washGain=this.ctx.createGain();
      washNoise.buffer=noiseBuffer;washNoise.loop=true;washBand.type="bandpass";washBand.frequency.value=1800;washBand.Q.value=.38;washGain.gain.value=0;
      washNoise.connect(washBand);washBand.connect(washGain);washGain.connect(this.master);

      bladeSource.start(0,i*.173);motorSource.start(0,i*.113);washNoise.start(0,i*.347);
      this.voices.push({bladeSource,bladeHigh,bladeLow,bladeGain,motorSource,motorBand,motorGain,washNoise,washBand,washGain,detune:detunes[i]});
    }
    this.ctx.addEventListener?.("statechange",()=>this.syncState());this.syncState();return true;
  }
  async unlock(){
    if(!this.enabled)return false;
    try{
      if(!this.ensure())return false;
      if(!this.isRunning()){
        const resume=this.ctx.resume(),primer=this.ctx.createBufferSource();primer.buffer=this.ctx.createBuffer(1,1,this.ctx.sampleRate);primer.connect(this.master);primer.start(0);await resume;
      }
      return this.syncState();
    }catch{this.syncState();return false;}
  }
  setEnabled(value){const next=saveAudioSettings({...loadAudioSettings(),soundEnabled:Boolean(value)});this.applyAudioSettings(next);return this.enabled;}
  setVolume(value){const next=saveAudioSettings({...loadAudioSettings(),droneVolume:Number(value)});this.applyAudioSettings(next);return next.droneVolume;}
  escWindingTone(frequencyHz,offsetSec=0,durationSec=.075,level=.20){
    if(!this.enabled||!this.isRunning()||!this.ctx||!this.master)return;
    const start=this.ctx.currentTime+Math.max(0,offsetSec),stop=start+Math.max(.025,durationSec);this.viewport.dataset.motorAudioEscToneCount=String((Number(this.viewport.dataset.motorAudioEscToneCount)||0)+1);
    for(const detune of [-5,-1.5,1.5,5]){
      const oscillator=this.ctx.createOscillator(),gain=this.ctx.createGain();oscillator.type="sine";oscillator.frequency.setValueAtTime(Math.max(80,frequencyHz+detune),start);
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,level/4),start+.008);gain.gain.setValueAtTime(Math.max(.0002,level/4),Math.max(start+.009,stop-.018));gain.gain.exponentialRampToValueAtTime(.0001,stop);
      oscillator.connect(gain);gain.connect(this.master);oscillator.start(start);oscillator.stop(stop+.01);
    }
  }
  armToneSequence(kind){
    if(kind==="request"){this.viewport.dataset.motorAudioArmEvent="arm-request";this.escWindingTone(880,0,.065,.24);this.escWindingTone(1175,.105,.065,.24);this.escWindingTone(1568,.210,.075,.25);}
    else if(kind==="armed"){this.viewport.dataset.motorAudioArmEvent="armed";this.escWindingTone(1760,0,.145,.28);}
    else if(kind==="disarmed"){this.viewport.dataset.motorAudioArmEvent="disarmed";this.escWindingTone(659,0,.075,.18);this.escWindingTone(523,.105,.090,.18);}
  }
  syncFcState(fcState,armRequested){
    const state=Number(fcState)||0,requested=Boolean(armRequested),wasArmed=Boolean(this.previousFcState&STATE_ARMED),isArmed=Boolean(state&STATE_ARMED),fault=Boolean(state&STATE_FAULT);
    if(requested&&!this.previousArmRequested&&!isArmed&&!fault)this.armToneSequence("request");if(!wasArmed&&isArmed)this.armToneSequence("armed");if(wasArmed&&!isArmed&&!fault)this.armToneSequence("disarmed");this.previousArmRequested=requested;this.previousFcState=state;
  }
  update(model,cameraPosition){
    const running=this.syncState(),omega=model.motorOmega||[],motorTorque=model.motorTorque||[],propTorque=model.propTorque||[],diameter=Math.max(.02,Number(model.p?.propD)||.127);let weightedHz=0,totalPropPower=0,totalTipSpeed=0,totalBladeGain=0,totalMotorGain=0,totalNoiseGain=0;
    for(let i=0;i<4;i++){
      const w=Math.max(0,Number(omega[i])||0),rotorHz=w/(2*Math.PI),bladePassHz=rotorHz*2,shaftPower=Math.max(0,(Number(propTorque[i])||0)*w),electromagneticPower=Math.max(0,(Number(motorTorque[i])||0)*w),tipSpeed=w*diameter*.5,electricalHz=rotorHz*7;
      weightedHz+=bladePassHz*shaftPower;totalPropPower+=shaftPower;totalTipSpeed+=tipSpeed;
      const voice=this.voices[i];if(!voice||!this.ctx)continue;
      const now=this.ctx.currentTime,drive=rotorHz>2?Math.tanh(shaftPower/30):0,motorDrive=rotorHz>2?Math.tanh(electromagneticPower/42):0,tipDrive=Math.tanh(tipSpeed/115);
      const bladeRate=clamp((bladePassHz/BASE_BLADE_HZ)*voice.detune,.02,18),motorRate=clamp((electricalHz/BASE_MOTOR_HZ)*voice.detune,.02,18);
      voice.bladeSource.playbackRate.setTargetAtTime(bladeRate,now,.018);voice.motorSource.playbackRate.setTargetAtTime(motorRate,now,.022);
      voice.bladeLow.frequency.setTargetAtTime(clamp(2200+tipSpeed*16,2400,7200),now,.04);
      voice.motorBand.frequency.setTargetAtTime(clamp(electricalHz*1.08,360,6200),now,.035);
      voice.washBand.frequency.setTargetAtTime(clamp(bladePassHz*2.1+tipSpeed*5.2,350,6400),now,.05);
      const bladeLevel=.040*drive*(.72+.28*tipDrive),motorLevel=.0135*(.35*drive+.65*motorDrive),noiseLevel=.0048*drive*(.28+.72*tipDrive);
      voice.bladeGain.gain.setTargetAtTime(bladeLevel,now,.028);voice.motorGain.gain.setTargetAtTime(motorLevel,now,.032);voice.washGain.gain.setTargetAtTime(noiseLevel,now,.055);
      totalBladeGain+=bladeLevel;totalMotorGain+=motorLevel;totalNoiseGain+=noiseLevel;
    }
    const meanHz=totalPropPower>1e-9?weightedHz/totalPropPower:omega.reduce((sum,w)=>sum+Math.max(0,Number(w)||0)/Math.PI,0)/4;
    this.viewport.dataset.motorAudioHz=String(meanHz);this.viewport.dataset.motorAudioPowerW=String(totalPropPower);this.viewport.dataset.motorAudioBladeGain=String(totalBladeGain);this.viewport.dataset.motorAudioMotorGain=String(totalMotorGain);this.viewport.dataset.motorAudioNoiseGain=String(totalNoiseGain);
    if(this.master&&this.ctx){const p=model.position(),distance=cameraPosition?Math.hypot(cameraPosition.x-p[0],cameraPosition.y-p[1],cameraPosition.z-p[2]):1,distanceGain=1/(1+.12*distance*distance),target=(this.enabled&&running)?.58*this.volume*distanceGain:0;this.viewport.dataset.motorAudioGain=String(target);this.master.gain.setTargetAtTime(target,this.ctx.currentTime,.045);}
  }
}
