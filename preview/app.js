import { setupImageEditor } from './image-editor.js';
const form = document.querySelector("#drop-form");
const message = document.querySelector("#message");
const website = document.querySelector("#website");
const chars = document.querySelector("#chars");
const send = document.querySelector("#send");
const status = document.querySelector("#status");
const printerState = document.querySelector("#printer-state");
const printerStateLabel = document.querySelector("#printer-state-label");
const aboutOpen = document.querySelector("#about-open");
const aboutModal = document.querySelector("#about-modal");
const aboutClose = document.querySelector("#about-close");
const aboutX = document.querySelector("#about-x");
const archiveOpen = document.querySelector("#archive-open");
const archiveModal = document.querySelector("#archive-modal");
const archiveClose = document.querySelector("#archive-close");
const archiveX = document.querySelector("#archive-x");
const archiveTotal = document.querySelector("#archive-total");
const maxChars = 300;
const archiveRefreshMs = 60 * 1000;
let printerOnline = false;
let kind = "text";
let submitting = false;
let storageReady = false;
const imageEditor = setupImageEditor(updateCount);
let lastFocusedElement = null;
let archiveRefreshTimer = null;
let archiveDisplayedTotal = null;

function setStatus(text, kind = "info") {
  status.textContent = text;
  status.className = kind === "error" ? "status error" : "status";
}

function updateCount() {
  chars.textContent = `${maxChars - message.value.length} characters left`;
  send.disabled = !storageReady || submitting || (kind === "image" ? !imageEditor.ready : !message.value.trim());
}

function updatePrinterState(online) {
  printerOnline = Boolean(online);
  printerState.className = printerOnline ? "printer-state online" : "printer-state offline";
  printerStateLabel.textContent = printerOnline ? "Printer Online" : "Printer Offline";
}

async function refreshPrinterState() {
  printerState.className = 'printer-state offline';
  printerStateLabel.textContent = 'Test preview · no printing';
  try {
    const response=await fetch('/api/image-submit',{cache:'no-store'});
    const data=await response.json();
    storageReady=Boolean(response.ok&&data.ok&&data.configured);
    if(!storageReady)document.querySelector('#storage-note').textContent='Cloud saving is waiting for private test storage. You can still crop, dither, and save a PNG.';
    updateCount();
    if(data.local)printerStateLabel.textContent='Local demo · uploads stay in memory';
    else if(!response.ok||!data.configured)printerStateLabel.textContent='Preview storage unavailable';
  } catch { printerStateLabel.textContent='Preview service unavailable';document.querySelector('#storage-note').textContent='Preview service unavailable. Cropping and PNG downloads still work.'; }
}

function displayArchiveTotal(total) {
  if (!archiveTotal || !Number.isFinite(total)) return;

  const previousTotal = archiveDisplayedTotal;
  archiveDisplayedTotal = total;

  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    previousTotal === null ||
    previousTotal === total
  ) {
    archiveTotal.textContent = total.toLocaleString();
    return;
  }

  const startedAt = performance.now();
  const duration = 600;

  archiveTotal.classList.remove("is-updating");
  void archiveTotal.offsetWidth;
  archiveTotal.classList.add("is-updating");

  function update(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(previousTotal + (total - previousTotal) * eased);
    archiveTotal.textContent = value.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      archiveTotal.textContent = total.toLocaleString();
      archiveTotal.classList.remove("is-updating");
    }
  }

  requestAnimationFrame(update);
}

async function refreshArchiveTotal() {
  if(archiveTotal)archiveTotal.textContent='Coming later';
}

function startArchiveRefresh() {
  refreshArchiveTotal();
  window.clearInterval(archiveRefreshTimer);
  archiveRefreshTimer = window.setInterval(refreshArchiveTotal, archiveRefreshMs);
}

function stopArchiveRefresh() {
  window.clearInterval(archiveRefreshTimer);
  archiveRefreshTimer = null;
}

message.addEventListener("input", updateCount);

function openModal(modal, closeButton) {
  lastFocusedElement = document.activeElement;
  document.body.classList.add("modal-open");
  modal.hidden = false;
  modal.querySelector(".modal-scroll").scrollTop = 0;
  closeButton.focus();
}

function closeModal(modal) {
  if (modal === archiveModal) stopArchiveRefresh();
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement) lastFocusedElement.focus();
}

aboutOpen.addEventListener("click", () => openModal(aboutModal, aboutX));
aboutClose.addEventListener("click", () => closeModal(aboutModal));
aboutX.addEventListener("click", () => closeModal(aboutModal));
archiveOpen.addEventListener("click", () => {
  openModal(archiveModal, archiveX);
  startArchiveRefresh();
});
archiveClose.addEventListener("click", () => closeModal(archiveModal));
archiveX.addEventListener("click", () => closeModal(archiveModal));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!aboutModal.hidden) closeModal(aboutModal);
  if (!archiveModal.hidden) closeModal(archiveModal);
});

for(const [tab,value] of [[document.querySelector('#text-tab'),'text'],[document.querySelector('#image-tab'),'image']]) {
 tab.addEventListener('click',()=>{
  kind=value;
  document.querySelector('#text-fields').hidden=kind!=='text';
  document.querySelector('#image-fields').hidden=kind!=='image';
  document.querySelector('#text-tab').setAttribute('aria-pressed',String(kind==='text'));
  document.querySelector('#image-tab').setAttribute('aria-pressed',String(kind==='image'));
  send.textContent=kind==='image'?'Save test image':'Save test message';setStatus('');updateCount();
 });
}
document.querySelector('#image-download').addEventListener('click',()=>imageEditor.download());
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(!storageReady || submitting || (kind==='image'?!imageEditor.ready:!message.value.trim()))return;
 const payload={kind,website:website.value,...(kind==='image'?{image:imageEditor.base64}:{message:message.value.trim()})};
 submitting=true;updateCount();setStatus('Saving privately…');
 try {
  const response=await fetch('/api/image-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'Could not save.');
  if(payload.kind==='text')message.value='';
  setStatus(data.local?'Local demo saved in memory. Nothing uploaded or printed.':`Saved privately. Test ID: ${data.id.slice(0,8)}. Nothing was sent to the printer.`);
 }catch(error){setStatus(error.message||'Could not save.','error');}
 finally{submitting=false;updateCount();}
});
updateCount();
refreshPrinterState();
