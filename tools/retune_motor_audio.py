from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()
cls=s.index('class MotorSound {')

start=s.index('  ensure(){',cls)
end=s.index('  async unlock(){',start)
new_ensure='''  ensure(){
    if(this.ctx){this.syncState();return true;}const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return false;
    try{this.ctx=new AudioCtx({latencyHint:"interactive"});}catch{this.ctx=new AudioCtx();}
    this.master=this.ctx.createGain();this.master.gain.value=0;
    this.compressor=this.ctx.createDynamicsCompressor();this.compressor.threshold.value=-18;this.compressor.knee.value=18;this.compressor.ratio.value=3;this.compressor.attack.value=.004;this.compressor.release.value=.12;this.master.connect(this.compressor);this.compressor.connect(this.ctx.destination);
    const real=new Float32Array(7),imag=new Float32Array([0,1,.36,.17,.09,.05,.025]);
    this.bladeWave=this.ctx.createPeriodicWave(real,imag,{disableNormalization:false});
    for(let i=0;i<4;i++){
      const blade=this.ctx.createOscillator(),bladeGain=this.ctx.createGain(),rotor=this.ctx.createOscillator(),rotorGain=this.ctx.createGain();
      blade.setPeriodicWave(this.bladeWave);rotor.type="sine";bladeGain.gain.value=0;rotorGain.gain.value=0;
      blade.connect(bladeGain);rotor.connect(rotorGain);bladeGain.connect(this.master);rotorGain.connect(this.master);blade.start();rotor.start();this.voices.push({blade,bladeGain,rotor,rotorGain});
    }
    const noiseBuffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),noise=noiseBuffer.getChannelData(0);let seed=0x45a31f27;
    for(let i=0;i<noise.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;noise[i]=((seed>>>0)/2147483648)-1;}
    this.airNoise=this.ctx.createBufferSource();this.airNoise.buffer=noiseBuffer;this.airNoise.loop=true;this.airHighpass=this.ctx.createBiquadFilter();this.airHighpass.type="highpass";this.airHighpass.frequency.value=120;this.airBandpass=this.ctx.createBiquadFilter();this.airBandpass.type="bandpass";this.airBandpass.Q.value=.72;this.airNoiseGain=this.ctx.createGain();this.airNoiseGain.gain.value=0;this.airNoise.connect(this.airHighpass);this.airHighpass.connect(this.airBandpass);this.airBandpass.connect(this.airNoiseGain);this.airNoiseGain.connect(this.master);this.airNoise.start();
    this.ctx.addEventListener?.("statechange",()=>this.syncState());this.syncState();return true;
  }
'''
s=s[:start]+new_ensure+s[end:]

start=s.index('  update(model,cameraPosition){',cls)
end=s.index('\n}\n\nTHREE.Object3D.DEFAULT_UP',start)
new_update='''  update(model,cameraPosition){
    const running=this.syncState(),omega=model.motorOmega||[],motorTorque=model.motorTorque||[],propTorque=model.propTorque||[],diameter=Math.max(.02,Number(model.p?.propD)||.127);let weightedHz=0,totalPropPower=0,totalTipSpeed=0;
    for(let i=0;i<4;i++){
      const w=Math.max(0,Number(omega[i])||0),rotorHz=w/(2*Math.PI),bladePassHz=rotorHz*2,shaftPower=Math.max(0,(Number(propTorque[i])||0)*w),electromagneticPower=Math.max(0,(Number(motorTorque[i])||0)*w),tipSpeed=w*diameter*.5;
      weightedHz+=bladePassHz*shaftPower;totalPropPower+=shaftPower;totalTipSpeed+=tipSpeed;
      const voice=this.voices[i];if(!voice||!this.ctx)continue;
      const now=this.ctx.currentTime,drive=rotorHz>2?Math.tanh((shaftPower+electromagneticPower*.12)/30):0;
      voice.blade.frequency.setTargetAtTime(Math.max(45,bladePassHz),now,.016);
      voice.rotor.frequency.setTargetAtTime(Math.max(32,rotorHz),now,.018);
      voice.bladeGain.gain.setTargetAtTime(.022*drive,now,.025);
      voice.rotorGain.gain.setTargetAtTime(.0055*drive,now,.030);
    }
    const meanHz=totalPropPower>1e-9?weightedHz/totalPropPower:omega.reduce((sum,w)=>sum+Math.max(0,Number(w)||0)/Math.PI,0)/4,meanTipSpeed=totalTipSpeed/4;
    if(this.airBandpass&&this.airNoiseGain&&this.ctx){const now=this.ctx.currentTime,airDrive=Math.tanh(totalPropPower/85)*(.30+.70*Math.tanh(meanTipSpeed/95));this.airBandpass.frequency.setTargetAtTime(Math.max(180,Math.min(5200,meanHz*1.65)),now,.045);this.airNoiseGain.gain.setTargetAtTime(.045*airDrive,now,.055);}
    this.viewport.dataset.motorAudioHz=String(meanHz);this.viewport.dataset.motorAudioPowerW=String(totalPropPower);
    if(this.master&&this.ctx){const p=model.position(),distance=cameraPosition?Math.hypot(cameraPosition.x-p[0],cameraPosition.y-p[1],cameraPosition.z-p[2]):1,distanceGain=1/(1+.12*distance*distance),target=(this.enabled&&running)?.48*distanceGain:0;this.viewport.dataset.motorAudioGain=String(target);this.master.gain.setTargetAtTime(target,this.ctx.currentTime,.045);}
  }
'''
s=s[:start]+new_update+s[end:]
p.write_text(s)
