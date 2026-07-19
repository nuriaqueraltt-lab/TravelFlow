import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { invalidateLeadsCache } from "./lead.service.js";
import { invalidateTasksCache } from "./workflow.service.js";
import { ACTIVITY_TYPES, LEAD_STATUSES, TASK_STATUSES, TASK_TYPES } from "../config/app.constants.js";
import { compatibleLeadStatus, hasActiveTripInterests } from "./trip-interest.model.js";

function asDueTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(`${value}T09:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function getPendingTaskDocuments(leadId) {
  return getDocs(query(
    collection(db, "tasks"),
    where("leadId", "==", leadId),
    where("status", "==", TASK_STATUSES.PENDING)
  ));
}

function cancelPendingTasks(snapshot, batch, reason) {
  snapshot.docs.forEach((taskDoc) => {
    batch.update(taskDoc.ref, {
      status: TASK_STATUSES.CANCELLED,
      cancelledReason: reason,
      updatedAt: serverTimestamp()
    });
  });
}

function invalidateNextActionCaches(leadId) {
  invalidateLeadsCache();
  invalidateTasksCache(leadId);
}

export async function saveManualNextAction({ lead, title, dueAt }) {
  const user = getCurrentUser();
  const cleanTitle = String(title || "").trim();
  const dueTimestamp = asDueTimestamp(dueAt);
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!lead?.id || !cleanTitle || !dueTimestamp) throw new Error("TASK_DATA_REQUIRED");
  if (lead.status === LEAD_STATUSES.LOST || (lead.status === LEAD_STATUSES.BOOKING_CONFIRMED && !hasActiveTripInterests(lead))) throw new Error("TERMINAL_LEAD");

  const pendingTasks = await getPendingTaskDocuments(lead.id);
  const batch = writeBatch(db);
  cancelPendingTasks(pendingTasks, batch, "REPLACED_BY_MANUAL_NEXT_ACTION");

  batch.set(doc(collection(db, "tasks")), {
    leadId: lead.id,
    leadName: lead.fullName || "Futura viatgera",
    tripName: lead.tripLabels?.[0] || lead.interest || "",
    title: cleanTitle,
    type: TASK_TYPES.MANUAL,
    status: TASK_STATUSES.PENDING,
    automatic: false,
    dueAt: dueTimestamp,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NEXT_ACTION_SET,
    description: `Pròxima acció actualitzada: ${cleanTitle} (${dueTimestamp.toDate().toLocaleDateString("ca-ES")}).`,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });

  batch.update(doc(db, "leads", lead.id), {
    status: compatibleLeadStatus(lead, LEAD_STATUSES.CONTACT_LATER),
    nextActionTitle: cleanTitle,
    nextActionAt: dueTimestamp,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  invalidateNextActionCaches(lead.id);
  return { nextActionTitle: cleanTitle, nextActionAt: dueTimestamp };
}

export async function clearManualNextAction({ lead }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!lead?.id) throw new Error("LEAD_REQUIRED");

  const pendingTasks = await getPendingTaskDocuments(lead.id);
  const batch = writeBatch(db);
  cancelPendingTasks(pendingTasks, batch, "NEXT_ACTION_REMOVED");

  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NEXT_ACTION_SET,
    description: "S’ha eliminat la pròxima acció.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });

  batch.update(doc(db, "leads", lead.id), {
    nextActionTitle: "",
    nextActionAt: null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });

  await batch.commit();
  invalidateNextActionCaches(lead.id);
  return { nextActionTitle: "", nextActionAt: null };
}
