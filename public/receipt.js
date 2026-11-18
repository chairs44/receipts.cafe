function trackReceipt(token, label) {
  const row = document.createElement("div");
  row.className = "status";
  const notice = document.createElement("span");
  notice.setAttribute("role", "status");
  row.append(notice);
  document.querySelector("#receipt-results").prepend(row);
  notice.textContent = label + " queued.";
  if (!token) return;
  const started = Date.now();
  async function check() {
    try {
      const response = await fetch("/api/receipt", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({token})
      });
      if (response.status === 404) {
        notice.textContent = "Receipt tracking expired.";
        return;
      }
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.state === "failed") {
        notice.textContent = label + " could not be printed.";
        return;
      }
      if (result.state === "printed") {
        notice.textContent = label + " printed.";
        const image = new Image();
        image.src = "data:image/png;base64," + result.png;
        image.alt = "Printed " + label.toLowerCase() + " receipt";
        try {
          await image.decode();
        } catch {
          notice.textContent += " Receipt preview unavailable.";
          return;
        }
        const preview = document.createElement("div");
        preview.className = "receipt-preview";
        const receiptWindow = document.createElement("div");
        receiptWindow.className = "receipt-window";
        const paper = document.createElement("div");
        paper.className = "receipt-paper";
        paper.append(image);
        receiptWindow.append(paper);
        preview.append(receiptWindow);
        row.append(preview);
        return;
      }
      notice.textContent = label + " queued.";
    } catch {
      notice.textContent = "Checking print confirmation…";
    }
    if (Date.now() - started < 86400000) setTimeout(check, Date.now()-started < 60000 ? 3000 : 30000);
    else notice.textContent = "Receipt tracking expired.";
  }
  check();
}
