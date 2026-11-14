import sharp from 'sharp';
export const PREFIX = 'receipt-preview:image-v1';
export const MAX_UPLOAD_BYTES = 150_000;
export function previewEnabled(env = process.env) {
  return env.RECEIPT_IMAGE_PREVIEW === 'true' && env.VERCEL_ENV === 'preview';
}
export async function normalizeImage(base64) {
  if(typeof base64!=='string'||base64.length>MAX_UPLOAD_BYTES*4/3+4||!base64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Upload a valid PNG.');
  const input=Buffer.from(base64,'base64');
  if(input.length>MAX_UPLOAD_BYTES||!input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Upload a valid PNG under 150 KB.');
  try {
    const image=sharp(input,{limitInputPixels:512*1024,animated:false,failOn:'warning'});
    const meta=await image.metadata();
    if(meta.format!=='png'||meta.width!==512||meta.height<128||meta.height>1024||(meta.pages||1)!==1)throw new Error('Invalid image dimensions: use 512 pixels wide and 128–1024 pixels tall.');
    const buffer=await image.flatten({background:'#ffffff'}).greyscale().threshold(128).png({palette:true,colours:2,dither:0,compressionLevel:9}).toBuffer();
    return {buffer,width:512,height:meta.height};
  } catch(error) {
    if(error.message.startsWith('Invalid image dimensions'))throw error;
    throw new Error('Invalid PNG or image dimensions.');
  }
}
export async function persistSubmission(item, buffer, services) {
  const record={...item,archiveStatus:'pending',printStatus:'queued'};
  if(buffer){
    const blob=await services.put(`${PREFIX}/${item.id}.png`,buffer,{access:'private',contentType:'image/png',addRandomSuffix:false,allowOverwrite:false});
    record.blobUrl=blob.url;record.blobPathname=blob.pathname;record.bytes=buffer.length;
  }
  // Keep an uploaded Blob on an ambiguous Redis timeout: the transaction may
  // already have committed. Its UUID pathname permits manual recovery.
  await services.register(record);
  return record;
}
