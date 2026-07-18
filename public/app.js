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
const maxChars = 300;
let printerOnline = false;
let lastFocusedElement = null;

function setStatus(text, kind = "info") {
  status.textContent = text;
  status.className = kind === "error" ? "status error" : "status";
}

function updateCount() {
  chars.textContent = `${maxChars - message.value.length} chars left`;
  send.disabled = !message.value.trim();
}

function updatePrinterState(online) {
  printerOnline = Boolean(online);
  printerState.className = printerOnline ? "printer-state online" : "printer-state offline";
  printerStateLabel.textContent = printerOnline ? "Printer Online" : "Printer Offline";
}

async function refreshPrinterState() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const data = await response.json();
    updatePrinterState(Boolean(response.ok && data.ok && data.printerOnline));
  } catch {
    updatePrinterState(false);
  }
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
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement) lastFocusedElement.focus();
}

aboutOpen.addEventListener("click", () => openModal(aboutModal, aboutX));
aboutClose.addEventListener("click", () => closeModal(aboutModal));
aboutX.addEventListener("click", () => closeModal(aboutModal));
archiveOpen.addEventListener("click", () => openModal(archiveModal, archiveX));
archiveClose.addEventListener("click", () => closeModal(archiveModal));
archiveX.addEventListener("click", () => closeModal(archiveModal));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!aboutModal.hidden) closeModal(aboutModal);
  if (!archiveModal.hidden) closeModal(archiveModal);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = message.value.trim();
  if (!text) return;
  send.disabled = true;
  setStatus("Sending...");

  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        website: website.value,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not send.");
    message.value = "";
    updateCount();
    setStatus(
      printerOnline
        ? "Your message will print on David's printer momentarily."
        : "Your message will print on David's printer once it comes back online."
    );
  } catch (error) {
    setStatus(error.message || "Could not send.", "error");
  } finally {
    updateCount();
  }
});

updateCount();
refreshPrinterState();
setInterval(refreshPrinterState, 15000);
