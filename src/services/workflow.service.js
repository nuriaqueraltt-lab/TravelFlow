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

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import {
  ACTIVITY_TYPES,
  FOLLOW_UP_DEFAULTS,
  LEAD_STATUSES,
  LOST_REASONS,
  TASK_STATUSES,
  TASK_TYPES
} from "../config/app.constants.js";

function addDays(date, days) {
  const result = new Date(date);
  result.setHours(9, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

function asTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getLeadTasks(leadId) {
  const snapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId)));
  return snapshot.docs.map(mapDocument).sort((a, b) => {
    const aTime = a.dueAt?.toMillis?.() ?? 0;
    const bTime = b.dueAt?.toMillis?.() ?? 0;
    return aTime - bTime;
  });
}

export async function getOpenTasks() {
  const snapshot = await getDocs(query(collection(db, "tasks"), where("status", "==", TASK_STATUSES.PENDING)));
  return snapshot.docs.map(mapDocument).sort((a, b) => {
    const aTime = a.dueAt?.toMillis?.() ?? 0;
    const bTime = b.dueAt?.toMillis?.() ?? 0;
    return aTime - bTime;
  });
}

export async function cancelPendingAutomaticTasks(leadId, batch = null) {
  const snapshot = await getDocs(
    query(
      collection(db, "tasks"),
      where("leadId", "==", leadId),
      where("status", "==", TASK_STATUSES.PENDING)
    )
  );

  const ownBatch = batch ?? writeBatch(db);
  snapshot.docs.forEach((taskDoc) => {
    if (taskDoc.data().automatic === true) {
      ownBatch.update(taskDoc.ref, {
        status: TASK_STATUSES.CANCELLED,
        cancelledReason: "REPLACED_BY_MANUAL_ACTION",
        updatedAt: serverTimestamp()
      });
    }
  });

  if (!batch) await ownBatch.commit();
}

export async function createInitialFollowUpTask({ leadId, leadName, tripName = "" }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const taskRef = doc(collection(db, "tasks"));
  const dueAt = Timestamp.fromDate(addDays(new Date(), FOLLOW_UP_DEFAULTS.FIRST_DAYS));

  await writeBatch(db)
    .set(taskRef, {
      leadId,
      leadName,
      tripName,
      title: "Primer seguiment pendent",
      type: TASK_TYPES.FIRST_FOLLOW_UP,
      status: TASK_STATUSES.PENDING,
      automatic: true,
      sequence: 1,
      dueAt,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    .commit();

  return taskRef.id;
}

export async function recordManualContact({ lead, description, status = LEAD_STATUSES.FOLLOW_UP }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);

  const activityRef = doc(collection(db, "activities"));
  batch.set(activityRef, {
    leadId: lead.id,
    type: ACTIVITY_TYPES.CONTACT,
    description: description?.trim() || "Contacte comercial registrat.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "leads", lead.id), {
    status,
    lastContactAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function scheduleManualFollowUp({ lead, title, dueAt, status = LEAD_STATUSES.CONTACT_LATER }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const dueTimestamp = asTimestamp(dueAt);
  if (!title?.trim() || !dueTimestamp) throw new Error("TASK_DATA_REQUIRED");

  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);

  const taskRef = doc(collection(db, "tasks"));
  const activityRef = doc(collection(db, "activities"));
  batch.set(taskRef, {
    leadId: lead.id,
    leadName: lead.fullName,
    tripName: lead.tripNames?.[0] || lead.interest || "",
    title: title.trim(),
    type: TASK_TYPES.MANUAL,
    status: TASK_STATUSES.PENDING,
    automatic: false,
    dueAt: dueTimestamp,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(activityRef, {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NEXT_ACTION_SET,
    description: `${title.trim()} programat per al ${new Date(dueAt).toLocaleDateString("ca-ES")}.`,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "leads", lead.id), {
    status,
    nextActionTitle: title.trim(),
    nextActionAt: dueTimestamp,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function markReplied(lead) {
  const user = getCurrentUser();
  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.REPLIED,
    description: "La futura viatgera ha contestat.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "leads", lead.id), {
    status: LEAD_STATUSES.REPLIED,
    nextActionAt: null,
    nextActionTitle: "",
    lastContactAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function markNoResponse(lead) {
  const user = getCurrentUser();
  const noResponseCount = Number(lead.noResponseCount || 0) + 1;
  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);

  const activityRef = doc(collection(db, "activities"));
  batch.set(activityRef, {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NO_RESPONSE,
    description: noResponseCount === 1 ? "Primer seguiment sense resposta." : "Segon seguiment sense resposta.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });

  const isFinalReview = noResponseCount >= FOLLOW_UP_DEFAULTS.MAX_NO_RESPONSE;
  const days = isFinalReview ? FOLLOW_UP_DEFAULTS.FINAL_REVIEW_DAYS : FOLLOW_UP_DEFAULTS.SECOND_DAYS;
  const title = isFinalReview ? "Revisió final sense resposta" : "Segon seguiment pendent";
  const taskRef = doc(collection(db, "tasks"));
  const dueAt = Timestamp.fromDate(addDays(new Date(), days));

  batch.set(taskRef, {
    leadId: lead.id,
    leadName: lead.fullName,
    tripName: lead.tripNames?.[0] || lead.interest || "",
    title,
    type: isFinalReview ? TASK_TYPES.FINAL_REVIEW : TASK_TYPES.SECOND_FOLLOW_UP,
    status: TASK_STATUSES.PENDING,
    automatic: true,
    sequence: noResponseCount + 1,
    dueAt,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.update(doc(db, "leads", lead.id), {
    status: LEAD_STATUSES.FOLLOW_UP,
    noResponseCount,
    nextActionTitle: title,
    nextActionAt: dueAt,
    lastContactAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function confirmBooking(lead) {
  const user = getCurrentUser();
  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.BOOKING_CONFIRMED,
    description: "Reserva confirmada.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "leads", lead.id), {
    status: LEAD_STATUSES.BOOKING_CONFIRMED,
    nextActionAt: null,
    nextActionTitle: "",
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function markLeadLost({ lead, reason, note = "" }) {
  const user = getCurrentUser();
  if (!reason || !Object.values(LOST_REASONS).includes(reason)) throw new Error("LOST_REASON_REQUIRED");
  const batch = writeBatch(db);
  await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.LEAD_LOST,
    description: `Lead marcat com a perdut.${note?.trim() ? ` ${note.trim()}` : ""}`,
    lostReason: reason,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  batch.update(doc(db, "leads", lead.id), {
    status: LEAD_STATUSES.LOST,
    lostReason: reason,
    lostNote: note?.trim() || "",
    lostAt: serverTimestamp(),
    nextActionAt: null,
    nextActionTitle: "",
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function completeTask(taskId) {
  await updateDoc(doc(db, "tasks", taskId), {
    status: TASK_STATUSES.COMPLETED,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function getWorkflowErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat.",
    TASK_DATA_REQUIRED: "Indica una acció i una data.",
    LOST_REASON_REQUIRED: "Selecciona obligatòriament el motiu de pèrdua.",
    "permission-denied": "No tens permís per completar aquesta operació."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'acció.";
}