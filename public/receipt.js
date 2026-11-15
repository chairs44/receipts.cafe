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
        const details = document.createElement("details");
        const view = document.createElement("summary");
        view.textContent = "View receipt";
        const image = new Image();
        image.src = "data:image/png;base64," + result.png;
        image.alt = "Printed " + label.toLowerCase() + " receipt";
        const link = document.createElement("a");
        link.href = image.src;
        link.download = "receipts-cafe-" + token.slice(0,8) + ".png";
        link.setAttribute("aria-label", "Download receipt PNG");
        link.title = "Download receipt PNG";
        link.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
        details.append(view,image,link);
        row.append(details);
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
