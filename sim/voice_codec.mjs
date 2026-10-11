// 8 kHz G.711 mu-law speech frames: one byte per sample.
export const VOICE_RATE=8000;
export const VOICE_RADIUS_M=70;
export function proximityGain(distance){return Number.isFinite(distance)?Math.max(0,Math.min(1,(VOICE_RADIUS_M-distance)/(VOICE_RADIUS_M-5))):0;}
export function encodeMuLaw(sample){
  const v=Math.max(-1,Math.min(1,Number(sample)||0));let x=Math.min(32635,Math.round(Math.abs(v)*32767)),exp=7;
  x+=132;for(let mask=0x4000;exp>0&&!(x&mask);exp--,mask>>=1){}
  const mant=(x>>(exp+3))&15;return ((v<0?0x7f:0xff)^(exp<<4|mant))&255;
}
export function decodeMuLaw(byte){const x=(~byte)&255,sign=x&128,exp=(x>>4)&7,mant=x&15;const pcm=((mant<<3)+132)<<exp;return (sign?132-pcm:pcm-132)/32768;}
export function validVoicePacket(p){return p?.type==='voice'&&typeof p.id==='string'&&p.id.length<=80&&typeof p.data==='string'&&p.data.length>=4&&p.data.length<=1200&&/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)&&Number.isSafeInteger(p.seq)&&p.seq>=0;}
