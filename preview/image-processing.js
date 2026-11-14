// Deterministic Floyd–Steinberg conversion; transparent pixels print as paper.
export function monochrome(rgba, width, height, brightness = 0) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    gray[i] = (0.2126 * rgba[i*4] + 0.7152 * rgba[i*4+1] + 0.0722 * rgba[i*4+2]) * a + 255 * (1-a) + brightness;
  }
  const out = new Uint8Array(gray.length);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const i=y*width+x, old=Math.max(0,Math.min(255,gray[i]));
    out[i]=old<128?0:255;
    const error=old-out[i];
    if(x+1<width)gray[i+1]+=error*7/16;
    if(y+1<height){if(x>0)gray[i+width-1]+=error*3/16;gray[i+width]+=error*5/16;if(x+1<width)gray[i+width+1]+=error/16;}
  }
  return out;
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type, data) {
  const out=new Uint8Array(data.length+12), view=new DataView(out.buffer);
  view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);
  view.setUint32(data.length+8,crc32(out.subarray(4,data.length+8)));return out;
}
export async function encodePNG(pixels,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||pixels.length!==width*height)throw new Error('Invalid image dimensions.');
  const stride=Math.ceil(width/8), rows=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[y*width+x])rows[y*(stride+1)+1+(x>>3)]|=128>>(x%8);
  const stream=new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
  const header=new Uint8Array(13), view=new DataView(header.buffer);
  view.setUint32(0,width);view.setUint32(4,height);header[8]=1; // 1-bit grayscale
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',new Uint8Array())];
  const out=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));let offset=0;
  for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
