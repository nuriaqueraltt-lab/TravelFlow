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
let rerunRequested = false;

async function cleanupTerminalLeadTasks() {
  if (running) {
    rerunRequested = true;
    return;
  }

  if (!getCurrentUser()) return;
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
        terminalLeads.set(leadDoc.id, { ref: leadDoc.ref, status: lead.status });
      }
    });

    const affectedLeadIds = new Set();
    const pendingTasks = tasksSnapshot.docs.filter((taskDoc) => {
      const leadId = taskDoc.data().leadId;
      if (!terminalLeads.has(leadId)) return false;
      affectedLeadIds.add(leadId);
      return true;
    });

    const leadsWithStaleNextAction = [...terminalLeads.entries()].filter(([, lead]) => {
      const data = leadsSnapshot.docs.find((item) => item.ref.path === lead.ref.path)?.data();
      return Boolean(data?.nextActionAt || data?.nextActionTitle);
    });

    if (!pendingTasks.length && !leadsWithStaleNextAction.length) return;

    const operations = [];

    pendingTasks.forEach((taskDoc) => {
      const leadStatus = terminalLeads.get(taskDoc.data().leadId)?.status;
      operations.push((batch) => batch.update(taskDoc.ref, {
        status: "CANCELLED",
        cancelledReason: leadStatus === "LOST" ? "LEAD_LOST" : "BOOKING_CONFIRMED",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }));
    });

    terminalLeads.forEach((lead, leadId) => {
      if (!affectedLeadIds.has(leadId) && !leadsWithStaleNextAction.some(([id]) => id === leadId)) return;
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
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated", {
      detail: { source: "terminal-lead-cleanup" }
    }));
  } catch (error) {
    console.error("No s'han pogut cancel·lar les tasques dels leads tancats:", error);
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      window.setTimeout(cleanupTerminalLeadTasks, 100);
    }
  }
}

window.addEventListener("travelflow:user-ready", cleanupTerminalLeadTasks);
window.addEventListener("travelflow:tasks-updated", (event) => {
  if (event.detail?.source === "terminal-lead-cleanup") return;
  cleanupTerminalLeadTasks();
});

cleanupTerminalLeadTasks();
