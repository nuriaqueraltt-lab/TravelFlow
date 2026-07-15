import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "../services/firebase.service.js";
import { getCurrentUser } from "../services/auth.service.js";

let activeLeadId = "";
let running = false;
let scheduled = false;

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

  const commercial = pending.filter((task) => task.type !== "TRIP_CLOSED");
  if (commercial.length) {
    return [...commercial].sort((a, b) => {
      const aChanged = timestampMillis(a.updatedAt) || timestampMillis(a.createdAt);
      const bChanged = timestampMillis(b.updatedAt) || timestampMillis(b.createdAt);
      return bChanged - aChanged;
    })[0];
  }

  return [...pending].sort((a, b) => timestampMillis(a.dueAt) - timestampMillis(b.dueAt))[0];
}

async function reconcileLead(leadId) {
  const user = getCurrentUser();
  if (!user || !leadId) return null;

  const snapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId)));
  const tasks = snapshot.docs.map((taskDoc) => ({ id: taskDoc.id, ref: taskDoc.ref, ...taskDoc.data() }));
  const selected = chooseCurrentTask(tasks);
  const obsolete = tasks.filter((task) => task.status === "PENDING" && task.type !== "TRIP_CLOSED" && task.id !== selected?.id);

  const batch = writeBatch(db);
  obsolete.forEach((task) => {
    batch.update(task.ref, {
      status: "CANCELLED",
      cancelledReason: "SUPERSEDED_BY_CURRENT_NEXT_ACTION",
      updatedAt: serverTimestamp()
    });
  });

  batch.update(doc(db, "leads", leadId), {
    nextActionTitle: selected?.title || "",
    nextActionAt: selected?.dueAt || null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  return selected;
}

function updateDetailCards(task) {
  const cards = document.querySelectorAll(".lead-detail-page .lead-summary-grid > article");
  if (cards.length < 4) return;
  const actionValue = cards[2].querySelector("strong");
  const dateValue = cards[3].querySelector("strong");
  if (actionValue) actionValue.textContent = task?.title || "Sense acció";
  if (dateValue) dateValue.textContent = formatDate(task?.dueAt);
}

async function reconcileCurrentDetail() {
  const detail = document.querySelector(".lead-detail-page");
  if (!detail || detail.dataset.nextActionReady === "true") return;
  const leadId = activeLeadId || document.body.dataset.currentLeadId || "";
  if (!leadId) return;

  detail.dataset.nextActionReady = "loading";
  try {
    const task = await reconcileLead(leadId);
    updateDetailCards(task);
    detail.dataset.nextActionReady = "true";
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) {
    console.error("No s'ha pogut sincronitzar la pròxima acció:", error);
    detail.dataset.nextActionReady = "error";
  }
}

async function reconcileAllPendingTasks() {
  if (running || !getCurrentUser() || !document.querySelector(".leads-page")) return;
  running = true;
  try {
    const snapshot = await getDocs(query(collection(db, "tasks"), where("status", "==", "PENDING")));
    const grouped = new Map();
    snapshot.docs.forEach((taskDoc) => {
      const task = { id: taskDoc.id, ref: taskDoc.ref, ...taskDoc.data() };
      if (!task.leadId) return;
      if (!grouped.has(task.leadId)) grouped.set(task.leadId, []);
      grouped.get(task.leadId).push(task);
    });

    for (const [leadId] of grouped) await reconcileLead(leadId);
  } catch (error) {
    console.error("No s'han pogut reconciliar les pròximes accions:", error);
  } finally {
    running = false;
  }
}

function scheduleReconciliation() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(async () => {
    scheduled = false;
    await reconcileCurrentDetail();
    if (document.querySelector(".leads-page") && !document.querySelector(".lead-detail-page")) {
      await reconcileAllPendingTasks();
    }
  });
}

document.addEventListener("click", (event) => {
  const row = event.target.closest("[data-lead-id]");
  if (row?.dataset.leadId) {
    activeLeadId = row.dataset.leadId;
    document.body.dataset.currentLeadId = activeLeadId;
  }
  if (event.target.closest("[data-back-to-leads]")) activeLeadId = "";
}, true);

window.addEventListener("travelflow:lead-created", (event) => {
  if (event.detail?.id) activeLeadId = event.detail.id;
});

window.addEventListener("travelflow:tasks-updated", scheduleReconciliation);

const observer = new MutationObserver(scheduleReconciliation);
observer.observe(document.body, { childList: true, subtree: true });
scheduleReconciliation();
