import { getLeadById } from "../services/lead.service.js";
import { getLeadTasks } from "../services/workflow.service.js";
import { showLeadDetail } from "./leads.controller.js";

let activeLeadId = "";
let refreshScheduledFollowUp = false;
let refreshing = false;

function rememberLeadFromElement(element) {
  const leadId = element?.dataset?.leadId || element?.dataset?.dashboardLead || "";
  if (leadId) activeLeadId = leadId;
}

document.addEventListener("click", (event) => {
  rememberLeadFromElement(event.target.closest("[data-lead-id], [data-dashboard-lead]"));

  if (event.target.closest("[data-back-to-leads]")) {
    activeLeadId = "";
    refreshScheduledFollowUp = false;
  }
}, true);

document.addEventListener("submit", (event) => {
  if (event.target?.dataset?.form === "schedule") {
    refreshScheduledFollowUp = true;
  }
}, true);

window.addEventListener("travelflow:lead-created", (event) => {
  if (event.detail?.id) activeLeadId = event.detail.id;
});

window.addEventListener("travelflow:tasks-updated", async () => {
  if (!refreshScheduledFollowUp || !activeLeadId || refreshing) return;

  refreshScheduledFollowUp = false;
  refreshing = true;

  try {
    await Promise.all([
      getLeadById(activeLeadId, { force: true }),
      getLeadTasks(activeLeadId, { force: true })
    ]);
    await showLeadDetail(activeLeadId);
  } catch (error) {
    console.error("No s'ha pogut refrescar el seguiment programat:", error);
  } finally {
    refreshing = false;
  }
});
