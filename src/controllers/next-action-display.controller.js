function normalize(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function summaryValue(page, label) {
  return [...page.querySelectorAll(".lead-summary-grid article")]
    .find((card) => normalize(card.querySelector("span")?.textContent) === label)
    ?.querySelector("strong");
}

function syncNextActionDisplay() {
  const page = document.querySelector(".lead-detail-page");
  if (!page) return;

  const statusElement = summaryValue(page, "Estat");
  const titleElement = summaryValue(page, "Pròxima acció");
  const dateElement = summaryValue(page, "Data pròxima acció");
  if (!titleElement || !dateElement) return;

  const terminal = ["Reserva confirmada", "Perdut"].includes(normalize(statusElement?.textContent));
  if (terminal) {
    titleElement.textContent = "Sense acció";
    dateElement.textContent = "—";
    return;
  }

  const pendingItems = [...page.querySelectorAll(".timeline-item.is-pending")];
  const nextTask = pendingItems[0];
  if (!nextTask) {
    titleElement.textContent = "Sense acció";
    dateElement.textContent = "—";
    return;
  }

  const title = normalize(nextTask.querySelector("strong")?.textContent);
  const date = normalize(nextTask.querySelector("small")?.textContent)
    .replace(/\s*·\s*Pendent\s*$/i, "");

  titleElement.textContent = title || "Sense acció";
  dateElement.textContent = date || "—";
}

let scheduled = false;
function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    syncNextActionDisplay();
  });
}

const observer = new MutationObserver(scheduleSync);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("travelflow:tasks-updated", scheduleSync);
scheduleSync();
