import { monochrome } from './image-processing.js';

const byId = id => document.getElementById(id);
const form = byId('image-form'), textForm = byId('drop-form'), picker = byId('image-picker');
const file = byId('pick-file'), canvas = byId('proof'), send = byId('image-send');
const discard = byId('discard'), back = byId('back-text'), open = byId('upload-image');
const status = byId('image-status'), hint = byId('crop-help'), heading = document.querySelector('h1');
const originalTitle = heading.textContent.trim(), originalHint = hint.textContent;
const ctx = canvas.getContext('2d', {willReadFrequently:true});
const tone = byId("tone"), brightness = byId("brightness"), contrast = byId("contrast");
const pointers = new Map();
let source, raster, revision = 0, frame = 0, x = 0, y = 0, width, height, sending = false;

function reset() {
  revision++;
  cancelAnimationFrame(frame);
  source?.close();
  source = raster = null;
  pointers.clear();
  tone.hidden = true;
  brightness.value = contrast.value = '0';
  file.value = '';
  picker.hidden = false;
  canvas.hidden = discard.hidden = true;
  send.disabled = true;
  hint.textContent = originalHint;
  status.textContent = '';
}
function showText() {
  if (sending) return;
  reset();
  form.hidden = true;
  textForm.hidden = false;
  heading.textContent = originalTitle;
  heading.setAttribute('aria-label', originalTitle);
  open.focus();
}
open.onclick = () => {
  reset();
  textForm.hidden = true;
  form.hidden = false;
  heading.textContent = 'Send an anonymous image directly to my receipt printer';
  heading.setAttribute('aria-label', heading.textContent);
  file.focus();
};
back.onclick = discard.onclick = showText;

function paint() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(source, x, y, width, height);
  const data = ctx.getImageData(0, 0, 512, 512);
  const pixels = monochrome(data.data, 512, 512, Number(brightness.value), Number(contrast.value));
  const packed = new Uint8Array(32768);
  for (let i = 0; i < pixels.length; i++) {
    data.data.fill(pixels[i], 4*i, 4*i+3);
    if (pixels[i]) packed[i >> 3] |= 128 >> (i & 7);
  }
  ctx.putImageData(data, 0, 0);
  raster = btoa(String.fromCharCode(...packed));
  send.disabled = false;
}
async function select(image) {
  if (sending || !image) return;
  reset();
  const current = revision;
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(image.type) || image.size > 10*1024*1024)
      throw Error('Choose a JPEG, PNG or WebP under 10 MB.');
    const bitmap = await createImageBitmap(image);
    if (current !== revision) { bitmap.close(); return; }
    source = bitmap;
    if (bitmap.width * bitmap.height > 24000000) throw Error('Choose an image under 24 megapixels.');
    const scale = 640 / Math.min(bitmap.width, bitmap.height);
    width = bitmap.width*scale; height = bitmap.height*scale;
    x = (512-width)/2; y = (512-height)/2;
    picker.hidden = true;
    canvas.hidden = discard.hidden = false;
    tone.hidden = false;
    hint.textContent = 'Drag to crop · Pinch or scroll to zoom';
    paint();
    canvas.focus();
  } catch (error) {
    if (current === revision) { reset(); status.textContent = error.message; }
  }
}
file.onchange = () => select(file.files[0]);
const box = byId('image-box');
box.ondragover = e => e.preventDefault();
box.ondrop = e => { e.preventDefault(); if (!source) select(e.dataTransfer.files[0]); };
function move(dx, dy) {
  if (!source || sending) return;
  x = Math.max(512-width, Math.min(0, x+dx));
  y = Math.max(512-height, Math.min(0, y+dy));
  send.disabled = true;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(paint);
}
tone.oninput = () => move(0, 0);

function position(event) {
  const rect = canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*512/rect.width, y:(event.clientY-rect.top)*512/rect.height};
}
function zoomAt(factor, from, to = from) {
  if (!source || sending) return;
  const size = Math.min(width,height);
  const scale = Math.max(512, Math.min(2048, size*factor)) / size;
  x = to.x - (from.x-x)*scale;
  y = to.y - (from.y-y)*scale;
  width *= scale;
  height *= scale;
  move(0,0);
}
const midpoint = (a,b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
canvas.onpointerdown = e => {
  if (sending || e.button !== 0 || pointers.size >= 2) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, position(e));
};
canvas.onpointermove = e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const next = position(e);
  pointers.set(e.pointerId,next);
  if (pointers.size === 1) return move(next.x-prev.x,next.y-prev.y);
  const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
  zoomAt(distance(next,other)/Math.max(1,distance(prev,other)), midpoint(prev,other), midpoint(next,other));
};
canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = e => pointers.delete(e.pointerId);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(Math.exp(-Math.sign(e.deltaY)*0.08), position(e));
}, {passive:false});
canvas.onkeydown = e => {
  if (['+','=','-'].includes(e.key)) {
    e.preventDefault();
    zoomAt(e.key === '-' ? 1/1.15 : 1.15, {x:256,y:256});
    return;
  }
  const delta = {ArrowLeft:[-8,0], ArrowRight:[8,0], ArrowUp:[0,-8], ArrowDown:[0,8]}[e.key];
  if (delta) { e.preventDefault(); move(...delta); }
};
form.onsubmit = async e => {
  e.preventDefault();
  if (!raster || send.disabled || sending) return;
  tone.disabled = sending = send.disabled = discard.disabled = back.disabled = true;
  status.textContent = 'Sending...';
  try {
    const response = await fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({kind:'image', raster})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || 'Could not send.');
    sending = false;
    showText();
    byId('status').textContent = 'Your image is queued for printing.';
  } catch (error) { status.textContent = error.message; }
  finally { tone.disabled = sending = discard.disabled = back.disabled = false; send.disabled = !raster; }
};
