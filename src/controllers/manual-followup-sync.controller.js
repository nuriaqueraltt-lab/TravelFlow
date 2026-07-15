import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "../services/firebase.service.js";
import { getCurrentUser } from "../services/auth.service.js";
import { getLeadById } from "../services/lead.service.js";
import { showLeadDetail } from "./leads.controller.js";

let activeLeadId = "";

function localDateTimestamp(value) {
  if (!value) return null;
  const date = new Date(`${value}T10:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function saveManualFollowUp({ leadId, title, dueAt }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const cleanTitle = String(title || "").trim();
  const dueTimestamp = localDateTimestamp(dueAt);
  if (!cleanTitle || !dueTimestamp) throw new Error("TASK_DATA_REQUIRED");

  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("LEAD_NOT_FOUND");

  const pendingSnapshot = await getDocs(
    query(
      collection(db, "tasks"),
      where("leadId", "==", leadId),
      where("status", "==", "PENDING")
    )
  );

  const batch = writeBatch(db);
  pendingSnapshot.docs.forEach((taskDoc) => {
    if (taskDoc.data().type === "TRIP_CLOSED") return;
    batch.update(taskDoc.ref, {
      status: "CANCELLED",
      cancelledReason: "REPLACED_BY_NEW_MANUAL_FOLLOW_UP",
      updatedAt: serverTimestamp()
    });
  });

  batch.set(doc(collection(db, "tasks")), {
    leadId,
    leadName: lead.fullName,
    tripName: lead.tripLabels?.[0] || lead.interest || "",
    title: cleanTitle,
    type: "MANUAL",
    status: "PENDING",
    automatic: false,
    dueAt: dueTimestamp,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(doc(collection(db, "activities")), {
    leadId,
    type: "NEXT_ACTION_SET",
    description: `${cleanTitle} programat per al ${new Intl.DateTimeFormat("ca-ES").format(dueTimestamp.toDate())}.`,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });

  batch.update(doc(db, "leads", leadId), {
    status: "CONTACT_LATER",
    nextActionTitle: cleanTitle,
    nextActionAt: dueTimestamp,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });

  await batch.commit();
}

document.addEventListener("click", (event) => {
  const row = event.target.closest("[data-lead-id]");
  if (row?.dataset.leadId) activeLeadId = row.dataset.leadId;
  if (event.target.closest("[data-back-to-leads]")) activeLeadId = "";
}, true);

document.addEventListener("submit", async (event) => {
  const form = event.target.closest('form[data-form="schedule"]');
  if (!form) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const leadId = activeLeadId || document.body.dataset.currentLeadId || "";
  if (!leadId) {
    window.alert("No s'ha pogut identificar el lead.");
    return;
  }

  const button = form.querySelector('button[type="submit"], button:not([type])');
  const data = new FormData(form);
  if (button) {
    button.disabled = true;
    button.textContent = "Guardant...";
  }

  try {
    await saveManualFollowUp({
      leadId,
      title: data.get("title"),
      dueAt: data.get("dueAt")
    });
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
    await showLeadDetail(leadId);
  } catch (error) {
    console.error("No s'ha pogut programar el seguiment:", error);
    const messages = {
      AUTH_REQUIRED: "La sessió ha caducat.",
      TASK_DATA_REQUIRED: "Indica una acció i una data.",
      LEAD_NOT_FOUND: "No s'ha trobat el lead.",
      "permission-denied": "No tens permís per completar aquesta operació."
    };
    window.alert(messages[error?.message] || messages[error?.code] || "No s'ha pogut programar el seguiment.");
    if (button) {
      button.disabled = false;
      button.textContent = "Programar";
    }
  }
}, true);
