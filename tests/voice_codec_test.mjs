import assert from 'node:assert/strict';
import {VOICE_RADIUS_M,proximityGain,encodeMuLaw,decodeMuLaw,validVoicePacket} from '../sim/voice_codec.mjs';
assert.equal(VOICE_RADIUS_M,70);assert.equal(proximityGain(Infinity),0);assert.equal(proximityGain(80),0);assert.equal(proximityGain(5),1);assert.ok(proximityGain(40)<proximityGain(10));
for(const sample of [-1,-.5,0,.5,1])assert.ok(Math.abs(decodeMuLaw(encodeMuLaw(sample))-sample)<.08,`codec ${sample}`);
assert.equal(validVoicePacket({type:'voice',id:'v-1',seq:0,data:'AQID'}),true);
assert.equal(validVoicePacket({type:'voice',id:'v-1',seq:0,data:'!'}),false);
assert.equal(validVoicePacket({type:'voice',id:'v-1',seq:-1,data:'AQID'}),false);
console.log('Proximity voice codec / radius / packet gate: pass');
