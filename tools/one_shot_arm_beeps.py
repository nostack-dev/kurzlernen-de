from pathlib import Path

sim=Path('sim/simulator.mjs')
s=sim.read_text()

old='''  constructor(viewport){this.viewport=viewport;this.ctx=null;this.master=null;this.voices=[];this.enabled=localStorage.getItem("arondight45MotorSound")!=="off";this.unlocked=false;this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF";this.viewport.dataset.motorAudioContextState="uninitialized";}'''
new='''  constructor(viewport){this.viewport=viewport;this.ctx=null;this.master=null;this.voices=[];this.enabled=localStorage.getItem("arondight45MotorSound")!=="off";this.unlocked=false;this.previousArmRequested=false;this.previousFcState=0;this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF";this.viewport.dataset.motorAudioContextState="uninitialized";this.viewport.dataset.motorAudioArmEvent="idle";}'''
assert s.count(old)==1, ('constructor',s.count(old))
s=s.replace(old,new)

old='''  setEnabled(value){this.enabled=Boolean(value);localStorage.setItem("arondight45MotorSound",this.enabled?"on":"off");if(!this.enabled&&this.master&&this.ctx)this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.025);this.syncState();}
  update(model,cameraPosition){'''
new='''  setEnabled(value){this.enabled=Boolean(value);localStorage.setItem("arondight45MotorSound",this.enabled?"on":"off");if(!this.enabled&&this.master&&this.ctx)this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.025);this.syncState();}
  escWindingTone(frequencyHz,offsetSec=0,durationSec=.075,level=.20){
    if(!this.enabled||!this.isRunning()||!this.ctx||!this.master)return;
    const start=this.ctx.currentTime+Math.max(0,offsetSec),stop=start+Math.max(.025,durationSec);
    // Real ESC beeps use the motor windings as the acoustic transducer. Four
    // slightly detuned electrical voices represent the four physical motors.
    for(const detune of [-5,-1.5,1.5,5]){
      const oscillator=this.ctx.createOscillator(),gain=this.ctx.createGain();oscillator.type="sine";oscillator.frequency.setValueAtTime(Math.max(80,frequencyHz+detune),start);
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,level/4),start+.008);gain.gain.setValueAtTime(Math.max(.0002,level/4),Math.max(start+.009,stop-.018));gain.gain.exponentialRampToValueAtTime(.0001,stop);
      oscillator.connect(gain);gain.connect(this.master);oscillator.start(start);oscillator.stop(stop+.01);
    }
  }
  armToneSequence(kind){
    if(kind==="request"){
      this.viewport.dataset.motorAudioArmEvent="arm-request";
      this.escWindingTone(880,0,.065,.24);this.escWindingTone(1175,.105,.065,.24);this.escWindingTone(1568,.210,.075,.25);
    }else if(kind==="armed"){
      this.viewport.dataset.motorAudioArmEvent="armed";
      this.escWindingTone(1760,0,.145,.28);
    }else if(kind==="disarmed"){
      this.viewport.dataset.motorAudioArmEvent="disarmed";
      this.escWindingTone(659,0,.075,.18);this.escWindingTone(523,.105,.090,.18);
    }
  }
  syncFcState(fcState,armRequested){
    const state=Number(fcState)||0,requested=Boolean(armRequested),wasArmed=Boolean(this.previousFcState&STATE_ARMED),isArmed=Boolean(state&STATE_ARMED),fault=Boolean(state&STATE_FAULT);
    if(requested&&!this.previousArmRequested&&!isArmed&&!fault)this.armToneSequence("request");
    if(!wasArmed&&isArmed)this.armToneSequence("armed");
    if(wasArmed&&!isArmed&&!fault)this.armToneSequence("disarmed");
    this.previousArmRequested=requested;this.previousFcState=state;
  }
  update(model,cameraPosition){'''
assert s.count(old)==1, ('method insertion',s.count(old))
s=s.replace(old,new)

old='''function render(){
  requestAnimationFrame(render);physics.render();updateCamera();motorSound.update(physics,camera.position);const state=physics.state();
  const fcState=latest.state,fault=fcState>>8&255,stateText=currentFcStateText();'''
new='''function render(){
  requestAnimationFrame(render);physics.render();updateCamera();const fcState=latest.state;motorSound.syncFcState(fcState,arm);motorSound.update(physics,camera.position);const state=physics.state();
  const fault=fcState>>8&255,stateText=currentFcStateText();'''
assert s.count(old)==1, ('render',s.count(old))
s=s.replace(old,new)
sim.write_text(s)

inv=Path('tests/architecture_invariants.mjs')
t=inv.read_text()
old='''for(const marker of ["class MotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW"])requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF"');'''
new='''for(const marker of ["class MotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW","escWindingTone","armToneSequence","motorAudioArmEvent","motorSound.syncFcState(fcState,arm)"])requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF"');'''
assert t.count(old)==1, ('invariant',t.count(old))
inv.write_text(t.replace(old,new))
