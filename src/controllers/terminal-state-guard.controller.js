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
import { getLeadById, invalidateLeadsCache } from "../services/lead.service.js";

const TERMINAL_STATUSES = new Set(["BOOKING_CONFIRMED", "LOST"]);
let cleaningLeadId = "";

function currentLeadId() {
  return String(document.body.dataset.currentLeadId || "").trim();
}

function clearTerminalSummary() {
  const page = document.querySelector(".lead-detail-page");
  if (!page) return;

  const cards = [...page.querySelectorAll(".lead-summary-grid article")];
  const status = cards.find((card) => card.querySelector("span")?.textContent.trim() === "Estat")
    ?.querySelector("strong")?.textContent.trim();

  if (!["Reserva confirmada", "Perdut"].includes(status)) return;

  const actionCard = cards.find((card) => card.querySelector("span")?.textContent.trim() === "Pròxima acció");
  const dateCard = cards.find((card) => card.querySelector("span")?.textContent.trim() === "Data pròxima acció");

  if (actionCard?.querySelector("strong")) actionCard.querySelector("strong").textContent = "Sense acció";
  if (dateCard?.querySelector("strong")) dateCard.querySelector("strong").textContent = "—";
}

async function cleanTerminalLead() {
  const leadId = currentLeadId();
  if (!leadId || cleaningLeadId === leadId) {
    clearTerminalSummary();
    return;
  }

  const lead = await getLeadById(leadId, { force: true });
  if (!lead || !TERMINAL_STATUSES.has(lead.status)) {
    clearTerminalSummary();
    return;
  }

  cleaningLeadId = leadId;
  try {
    const pendingSnapshot = await getDocs(
      query(
        collection(db, "tasks"),
        where("leadId", "==", leadId),
        where("status", "==", "PENDING")
      )
    );

    const batch = writeBatch(db);
    pendingSnapshot.docs.forEach((taskDoc) => {
      batch.update(taskDoc.ref, {
        status: "CANCELLED",
        cancelledReason: lead.status === "LOST" ? "LEAD_LOST" : "BOOKING_CONFIRMED",
        updatedAt: serverTimestamp()
      });
    });

    if (!pendingSnapshot.empty) await batch.commit();

    if (lead.nextActionAt || lead.nextActionTitle) {
      await updateDoc(doc(db, "leads", leadId), {
        nextActionAt: null,
        nextActionTitle: "",
        updatedAt: serverTimestamp()
      });
    }

    invalidateLeadsCache();
    clearTerminalSummary();
  } catch (error) {
    console.error("No s'han pogut netejar les tasques del lead tancat:", error);
    clearTerminalSummary();
  } finally {
    cleaningLeadId = "";
  }
}

window.addEventListener("travelflow:tasks-updated", cleanTerminalLead);

const observer = new MutationObserver(() => clearTerminalSummary());
observer.observe(document.body, { childList: true, subtree: true });
