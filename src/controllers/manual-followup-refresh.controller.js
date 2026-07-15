import { getLeadById } from "../services/lead.service.js";
import { getLeadTasks } from "../services/workflow.service.js";
import { showLeadDetail } from "./leads.controller.js";

let activeLeadId = "";
let refreshing = false;

function rememberLeadFromElement(element) {
  const leadId = element?.dataset?.leadId || element?.dataset?.dashboardLead || "";
  if (leadId) activeLeadId = leadId;
}

function getSummaryValue(label) {
  const cards = [...document.querySelectorAll(".lead-summary-grid article")];
  return cards
    .find((card) => card.querySelector("span")?.textContent.trim() === label)
    ?.querySelector("strong");
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ca-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function applyPendingTaskToSummary(lead, tasks) {
  const titleElement = getSummaryValue("Pròxima acció");
  const dateElement = getSummaryValue("Data pròxima acció");
  if (!titleElement || !dateElement) return;

  const terminal = ["LOST", "BOOKING_CONFIRMED"].includes(lead?.status);
  const pendingTask = terminal
    ? null
    : tasks
        .filter((task) => task.status === "PENDING")
        .sort((a, b) => (a.dueAt?.toMillis?.() ?? 0) - (b.dueAt?.toMillis?.() ?? 0))[0];

  titleElement.textContent = pendingTask?.title || "Sense acció";
  dateElement.textContent = pendingTask ? formatDate(pendingTask.dueAt) : "—";
}

document.addEventListener("click", (event) => {
  rememberLeadFromElement(event.target.closest("[data-lead-id], [data-dashboard-lead]"));

  if (event.target.closest("[data-back-to-leads]")) {
    activeLeadId = "";
  }
}, true);

window.addEventListener("travelflow:lead-created", (event) => {
  if (event.detail?.id) activeLeadId = event.detail.id;
});

window.addEventListener("travelflow:tasks-updated", async () => {
  if (!activeLeadId || refreshing) return;

  refreshing = true;
  try {
    const [lead, tasks] = await Promise.all([
      getLeadById(activeLeadId, { force: true }),
      getLeadTasks(activeLeadId, { force: true })
    ]);

    await showLeadDetail(activeLeadId);
    applyPendingTaskToSummary(lead, tasks);
  } catch (error) {
    console.error("No s'ha pogut sincronitzar la pròxima acció:", error);
  } finally {
    refreshing = false;
  }
});
