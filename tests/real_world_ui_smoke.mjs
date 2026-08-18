import {deflateSync} from "node:zlib";

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const typeBuffer=Buffer.from(type,"ascii"),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer,data])));return Buffer.concat([length,typeBuffer,data,checksum]);}
function solidRgbaPng(width,height,r,g,b,a=255){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const row=Buffer.alloc(1+width*4);row[0]=0;for(let x=0;x<width;x++){const i=1+x*4;row[i]=r;row[i+1]=g;row[i+2]=b;row[i+3]=a;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),pngChunk("IEND",Buffer.alloc(0))]);
}

// The original WORLD UI gate contains an old 512x512 inline PNG that Chrome
// rejects. Preserve every assertion in that gate, but substitute only those
// known DEM bytes with a valid Terrarium tile (RGB 128,0,0 = 0 m MSL).
const validDemTile=solidRgbaPng(512,512,128,0,0,255);
const invalidDemPrefix="iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6";
const originalBufferFrom=Buffer.from;
Buffer.from=function(value,...args){
  if(typeof value==="string"&&args[0]==="base64"&&value.startsWith(invalidDemPrefix))return validDemTile;
  return Reflect.apply(originalBufferFrom,Buffer,[value,...args]);
};
try{
  await import("./real_world_ui_smoke_impl.mjs");
}finally{
  Buffer.from=originalBufferFrom;
}
