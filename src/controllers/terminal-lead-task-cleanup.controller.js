import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "../services/firebase.service.js";
import { getCurrentUser } from "../services/auth.service.js";

const TERMINAL_STATUSES = new Set(["LOST", "BOOKING_CONFIRMED"]);
let running = false;
let cleanupTimer = null;
let initialCleanupDone = false;

function currentDetailIsTerminal() {
  const status = document.querySelector(".lead-detail-page .lead-summary-grid > article:first-child strong")?.textContent?.trim();
  return status === "Perdut" || status === "Reserva confirmada";
}

async function cleanupTerminalLeadTasks() {
  if (running || !getCurrentUser()) return;
  running = true;

  try {
    const [leadsSnapshot, tasksSnapshot] = await Promise.all([
      getDocs(collection(db, "leads")),
      getDocs(query(collection(db, "tasks"), where("status", "==", "PENDING")))
    ]);

    const terminalLeads = new Map();
    leadsSnapshot.docs.forEach((leadDoc) => {
      const lead = leadDoc.data();
      if (lead.active !== false && TERMINAL_STATUSES.has(lead.status)) {
        terminalLeads.set(leadDoc.id, { ref: leadDoc.ref, status: lead.status, data: lead });
      }
    });

    const pendingTasks = tasksSnapshot.docs.filter((taskDoc) => terminalLeads.has(taskDoc.data().leadId));
    const staleLeads = [...terminalLeads.entries()].filter(([, lead]) => lead.data.nextActionAt || lead.data.nextActionTitle);

    if (!pendingTasks.length && !staleLeads.length) return;

    const affectedLeadIds = new Set();
    const operations = [];

    pendingTasks.forEach((taskDoc) => {
      const leadId = taskDoc.data().leadId;
      const leadStatus = terminalLeads.get(leadId)?.status;
      affectedLeadIds.add(leadId);
      operations.push((batch) => batch.update(taskDoc.ref, {
        status: "CANCELLED",
        cancelledReason: leadStatus === "LOST" ? "LEAD_LOST" : "BOOKING_CONFIRMED",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }));
    });

    staleLeads.forEach(([leadId]) => affectedLeadIds.add(leadId));
    affectedLeadIds.forEach((leadId) => {
      operations.push((batch) => batch.update(doc(db, "leads", leadId), {
        nextActionTitle: "",
        nextActionAt: null,
        updatedAt: serverTimestamp()
      }));
    });

    for (let start = 0; start < operations.length; start += 400) {
      const batch = writeBatch(db);
      operations.slice(start, start + 400).forEach((operation) => operation(batch));
      await batch.commit();
    }

    window.dispatchEvent(new CustomEvent("travelflow:terminal-tasks-cleaned", {
      detail: { tasks: pendingTasks.length, leads: affectedLeadIds.size }
    }));
  } catch (error) {
    console.error("No s'han pogut cancel·lar les tasques dels leads tancats:", error);
  } finally {
    running = false;
  }
}

function scheduleCleanup(force = false) {
  if (!force && !currentDetailIsTerminal()) return;
  window.clearTimeout(cleanupTimer);
  cleanupTimer = window.setTimeout(cleanupTerminalLeadTasks, 120);
}

window.addEventListener("travelflow:user-ready", () => {
  if (initialCleanupDone) return;
  initialCleanupDone = true;
  scheduleCleanup(true);
});

window.addEventListener("travelflow:tasks-updated", () => scheduleCleanup(false));
