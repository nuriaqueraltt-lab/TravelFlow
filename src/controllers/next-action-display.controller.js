function normalize(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function syncNextActionDisplay() {
  const detail = document.querySelector(".lead-detail-page");
  if (!detail) return;

  const summaryCards = detail.querySelectorAll(".lead-summary-grid article");
  if (summaryCards.length < 4) return;

  const titleElement = summaryCards[2].querySelector("strong");
  const dateElement = summaryCards[3].querySelector("strong");
  if (!titleElement || !dateElement) return;

  const nextActionTitle = normalize(titleElement.textContent);
  if (!nextActionTitle || nextActionTitle === "Sense acció") return;

  const matchingTasks = [...detail.querySelectorAll(".timeline-item.is-pending")]
    .filter((item) => normalize(item.querySelector("strong")?.textContent) === nextActionTitle);

  const matchingTask = matchingTasks.at(-1);
  const taskDateText = normalize(matchingTask?.querySelector("small")?.textContent)
    .replace(/\s*·\s*Pendent\s*$/i, "");

  if (!taskDateText || taskDateText === normalize(dateElement.textContent)) return;
  dateElement.textContent = taskDateText;
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
