import { monochrome, encodePNG } from './image-processing.js';
export function setupImageEditor(onChange) {
 const file=document.querySelector('#image-file'),canvas=document.querySelector('#image-preview');
 const context=canvas.getContext('2d',{willReadFrequently:true});
 const editor=document.querySelector('#image-editor'),info=document.querySelector('#image-info'),error=document.querySelector('#image-error');
 const controls=['crop-ratio','image-zoom','image-x','image-y','image-brightness'].map(id=>document.getElementById(id));
 let source=null,bytes=null,revision=0,timer,loading=false;
 function setReady(value){bytes=value;onChange();}
 async function render() {
  const version=++revision;
  setReady(null);error.textContent='';
  if(!source)return;
  info.textContent='Preparing print preview…';
  const ratio=Number(controls[0].value),width=512,height=Math.round(width/ratio);
  canvas.width=width;canvas.height=height;
  const scale=Math.max(width/source.width,height/source.height)*Number(controls[1].value);
  const w=source.width*scale,h=source.height*scale;
  const x=(width-w)*Number(controls[2].value)/100,y=(height-h)*Number(controls[3].value)/100;
  context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(source,x,y,w,h);
  const data=context.getImageData(0,0,width,height),pixels=monochrome(data.data,width,height,Number(controls[4].value));
  for(let i=0;i<pixels.length;i++){data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=pixels[i];data.data[i*4+3]=255;}
  context.putImageData(data,0,0);
  try{
   const encoded=await encodePNG(pixels,width,height);
   if(version!==revision)return;
   if(encoded.length>150000)throw new Error('Prepared image is too large. Choose a shorter crop.');
   setReady(encoded);info.textContent=`${width} × ${height} px · ${(encoded.length/1024).toFixed(1)} KB · 1-bit PNG`;
  }catch(e){if(version===revision){error.textContent=e.message;info.textContent='Preview unavailable.';}}
 }
 for(const control of controls)control.addEventListener('input',()=>{++revision;setReady(null);clearTimeout(timer);timer=setTimeout(render,100);});
 file.addEventListener('change',async()=>{
  const version=++revision;clearTimeout(timer);setReady(null);error.textContent='';editor.hidden=true;
  source?.close();source=null;
  const selected=file.files[0];if(!selected){info.textContent='';return;}
  if(!['image/jpeg','image/png','image/webp'].includes(selected.type)||selected.size>10*1024*1024){error.textContent='Choose a JPEG, PNG, or WebP under 10 MB.';return;}
  loading=true;info.textContent='Opening image…';
  try{
   const decoded=await createImageBitmap(selected);
   if(version!==revision){decoded.close();return;}
   if(decoded.width*decoded.height>24_000_000){decoded.close();throw new Error('Choose an image under 24 megapixels.');}
   source=decoded;controls[0].value='1';controls[1].value='1';controls[2].value=controls[3].value='50';controls[4].value='0';
   editor.hidden=false;await render();
  }catch(e){if(version===revision){error.textContent=e.message||'This image could not be opened.';info.textContent='';}}
  finally{loading=false;onChange();}
 });
 document.querySelector('#image-reset').addEventListener('click',()=>{controls[1].value='1';controls[2].value=controls[3].value='50';controls[4].value='0';clearTimeout(timer);render();});
 return {
  get ready(){return Boolean(bytes)&&!loading;},
  get base64(){if(!bytes)return null;let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);},
  download(){if(!bytes)return;const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));const a=document.createElement('a');a.href=url;a.download='receipt-preview.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 };
}
