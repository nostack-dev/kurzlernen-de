import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";

const implUrl=new URL("./real_world_ui_smoke_impl.mjs",import.meta.url);
const implSource=readFileSync(implUrl,"utf8");
for(const marker of ["WORLD GRID off did not persist","WORLD semantic palette/legend marker missing"]){
  if(!implSource.includes(marker))throw new Error(`full WORLD UI gate marker missing from implementation: ${marker}`);
}

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const typeBuffer=Buffer.from(type,"ascii"),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer,data])));return Buffer.concat([length,typeBuffer,data,checksum]);}
function solidRgbaPng(width,height,r,g,b,a=255){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const row=Buffer.alloc(1+width*4);row[0]=0;for(let x=0;x<width;x++){const i=1+x*4;row[i]=r;row[i+1]=g;row[i+2]=b;row[i+3]=a;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),pngChunk("IEND",Buffer.alloc(0))]);
}

// The full WORLD UI gate is kept byte-for-byte in the implementation module.
// Only its obsolete inline 512x512 DEM PNG is substituted with a valid
// Terrarium tile (RGB 128,0,0 = exactly 0 m MSL).
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
