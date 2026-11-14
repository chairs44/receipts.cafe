import { monochrome } from './image-processing.js';

const byId = id => document.getElementById(id);
const form = byId('image-form'), textForm = byId('drop-form'), picker = byId('image-picker');
const file = byId('pick-file'), canvas = byId('proof'), send = byId('image-send');
const discard = byId('discard'), back = byId('back-text'), open = byId('upload-image');
const status = byId('image-status'), hint = byId('crop-help'), heading = document.querySelector('h1');
const originalTitle = heading.textContent.trim(), originalHint = hint.textContent;
const ctx = canvas.getContext('2d', {willReadFrequently:true});
let source, raster, revision = 0, frame = 0, x = 0, y = 0, width, height, drag, sending = false;

function reset() {
  revision++;
  cancelAnimationFrame(frame);
  source?.close();
  source = raster = drag = null;
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
  const pixels = monochrome(data.data, 512, 512);
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
    hint.textContent = 'Drag image to crop';
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
canvas.onpointerdown = e => {
  if (!e.isPrimary || e.button !== 0 || sending) return;
  canvas.setPointerCapture(e.pointerId);
  drag = {x:e.clientX, y:e.clientY};
};
canvas.onpointermove = e => {
  if (!drag || !canvas.hasPointerCapture(e.pointerId)) return;
  const factor = 512/canvas.getBoundingClientRect().width;
  move((e.clientX-drag.x)*factor, (e.clientY-drag.y)*factor);
  drag = {x:e.clientX, y:e.clientY};
};
canvas.onlostpointercapture = () => { drag = null; };
canvas.onkeydown = e => {
  const delta = {ArrowLeft:[-8,0], ArrowRight:[8,0], ArrowUp:[0,-8], ArrowDown:[0,8]}[e.key];
  if (delta) { e.preventDefault(); move(...delta); }
};
form.onsubmit = async e => {
  e.preventDefault();
  if (!raster || send.disabled || sending) return;
  sending = send.disabled = discard.disabled = back.disabled = true;
  status.textContent = 'Sending...';
  try {
    const response = await fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({kind:'image', raster})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || 'Could not send.');
    sending = false;
    showText();
    byId('status').textContent = 'Your image is queued for printing.';
  } catch (error) { status.textContent = error.message; }
  finally { sending = discard.disabled = back.disabled = false; send.disabled = !raster; }
};
