// Deterministic Floyd–Steinberg conversion; transparent pixels print as paper.
export function monochrome(rgba, width, height, brightness = 0, contrast = 0) {
  const gray = new Float32Array(width * height);
  const gain = 2 ** (contrast / 50);
  for (let i = 0; i < gray.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const luminance = (0.2126 * rgba[i*4] + 0.7152 * rgba[i*4+1] + 0.0722 * rgba[i*4+2]) * a + 255 * (1-a);
    gray[i] = (luminance - 127.5) * gain + 127.5 + brightness;
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
