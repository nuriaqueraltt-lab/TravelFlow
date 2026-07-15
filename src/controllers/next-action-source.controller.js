import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "../services/firebase.service.js";
import { getCurrentUser } from "../services/auth.service.js";

let activeLeadId = "";
let refreshTimer = null;

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("ca-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function chooseCurrentTask(tasks) {
  const pending = tasks.filter((task) => task.status === "PENDING");
  if (!pending.length) return null;

  return [...pending].sort((a, b) => {
    const dueDifference = timestampMillis(a.dueAt) - timestampMillis(b.dueAt);
    if (dueDifference !== 0) return dueDifference;
    return timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt);
  })[0];
}

function updateDetailCards(task) {
  const cards = document.querySelectorAll(".lead-detail-page .lead-summary-grid > article");
  if (cards.length < 4) return;

  const actionValue = cards[2].querySelector("strong");
  const dateValue = cards[3].querySelector("strong");
  if (actionValue) actionValue.textContent = task?.title || "Sense acció";
  if (dateValue) dateValue.textContent = formatDate(task?.dueAt);
}

async function refreshCurrentLeadNextAction() {
  const leadId = activeLeadId || document.body.dataset.currentLeadId || "";
  if (!leadId || !getCurrentUser() || !document.querySelector(".lead-detail-page")) return;

  try {
    const snapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId)));
    const tasks = snapshot.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
    updateDetailCards(chooseCurrentTask(tasks));
  } catch (error) {
    console.error("No s'ha pogut refrescar la pròxima acció:", error);
  }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshCurrentLeadNextAction, 80);
}

document.addEventListener("click", (event) => {
  const row = event.target.closest("[data-lead-id]");
  const dashboardLead = event.target.closest("[data-dashboard-lead]");
  const tripLead = event.target.closest("[data-trip-lead]");
  const leadId = row?.dataset.leadId || dashboardLead?.dataset.dashboardLead || tripLead?.dataset.tripLead || "";

  if (leadId) {
    activeLeadId = leadId;
    document.body.dataset.currentLeadId = leadId;
  }

  if (event.target.closest("[data-back-to-leads]")) {
    activeLeadId = "";
    delete document.body.dataset.currentLeadId;
  }
}, true);

window.addEventListener("travelflow:lead-created", (event) => {
  if (event.detail?.id) {
    activeLeadId = event.detail.id;
    document.body.dataset.currentLeadId = activeLeadId;
  }
});

window.addEventListener("travelflow:tasks-updated", scheduleRefresh);
