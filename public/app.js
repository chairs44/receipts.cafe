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
let lastFocusedElement = null;
let archiveRefreshTimer = null;
let archiveDisplayedTotal = null;

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



function displayArchiveTotal(total) {
  if (!archiveTotal || !Number.isFinite(total)) return;

  const nextTotal = Math.max(0, Math.trunc(total));
  const previousTotal = archiveDisplayedTotal;
  archiveDisplayedTotal = nextTotal;
  const nextText = nextTotal.toLocaleString();

  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    previousTotal === null ||
    previousTotal === nextTotal
  ) {
    archiveTotal.classList.remove("is-reel");
    archiveTotal.textContent = nextText;
    archiveTotal.setAttribute("aria-label", `Total messages received: ${nextText}`);
    return;
  }

  renderArchiveReels(nextText);
}

function renderArchiveReels(value) {
  archiveTotal.replaceChildren();
  archiveTotal.classList.add("is-reel");
  archiveTotal.setAttribute("aria-label", `Total messages received: ${value}`);

  const digitCount = [...value].filter((character) => /\\d/.test(character)).length;
  let digitIndex = 0;

  for (const character of value) {
    if (!/\\d/.test(character)) {
      const separator = document.createElement("span");
      separator.className = "archive-total-separator";
      separator.textContent = character;
      separator.setAttribute("aria-hidden", "true");
      archiveTotal.append(separator);
      continue;
    }

    const column = document.createElement("span");
    const strip = document.createElement("span");
    const digit = Number(character);
    const cycles = digitIndex % 2 === 0 ? 2 : 3;

    column.className = "archive-total-reel-col";
    strip.className = "archive-total-reel-strip";
    column.style.setProperty("--reel-delay", `${digitIndex * 55}ms`);
    column.style.setProperty("--reel-step", String(cycles * 10 + digit));

    for (let cycle = 0; cycle <= cycles; cycle += 1) {
      for (let value = 0; value <= 9; value += 1) {
        const cell = document.createElement("span");
        cell.className = "archive-total-reel-digit";
        cell.textContent = value;
        cell.setAttribute("aria-hidden", "true");
        strip.append(cell);
      }
    }

    column.append(strip);
    archiveTotal.append(column);
    digitIndex += 1;
  }

  requestAnimationFrame(() => {
    archiveTotal.querySelectorAll(".archive-total-reel-col").forEach((column) => {
      column.classList.add("is-rolling");
    });
  });

  if (digitIndex !== digitCount) {
    archiveTotal.textContent = value;
  }
}

async function refreshArchiveTotal() {
  try {
    const response = await fetch("/api/archive-status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok || !Number.isFinite(data.totalMessages)) {
      throw new Error("Archive status unavailable.");
    }
    displayArchiveTotal(data.totalMessages);
  } catch {
    if (archiveDisplayedTotal === null && archiveTotal) {
      archiveTotal.textContent = "--";
    }
  }
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
