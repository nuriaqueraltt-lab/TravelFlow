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
import {
  ACTIVITY_TYPES,
  FOLLOW_UP_DEFAULTS,
  LEAD_STATUSES,
  LOST_REASONS,
  TASK_STATUSES,
  TASK_TYPES
} from "../config/app.constants.js";
import { getNextPendingTask } from "../utils/next-action.js";

function addDays(date, days) {
  const result = new Date(date);
  result.setHours(9, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

function asTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(`${value}T09:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function pendingTaskDocs(leadId) {
  const snapshot = await getDocs(query(
    collection(db, "tasks"),
    where("leadId", "==", leadId),
    where("status", "==", TASK_STATUSES.PENDING)
  ));
  return snapshot.docs;
}

function cancelDocs(batch, docs, reason) {
  docs.forEach((taskDoc) => batch.update(taskDoc.ref, {
    status: TASK_STATUSES.CANCELLED,
    cancelledReason: reason,
    updatedAt: serverTimestamp()
  }));
}

async function commitOperation(batch, leadId, result) {
  await batch.commit();
  invalidateLeadsCache();
  invalidateTasksCache(leadId);
  return result;
}

function taskPayload({ lead, title, dueAt, type, automatic, userId, sequence }) {
  return {
    leadId: lead.id,
    leadName: lead.fullName,
    tripName: lead.tripLabels?.[0] || lead.interest || "",
    title,
    type,
    status: TASK_STATUSES.PENDING,
    automatic,
    ...(sequence ? { sequence } : {}),
    dueAt,
    createdBy: userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

export { getNextPendingTask };

export async function setManualNextAction({ lead, title, dueAt, status = LEAD_STATUSES.CONTACT_LATER }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if ([LEAD_STATUSES.LOST, LEAD_STATUSES.BOOKING_CONFIRMED].includes(lead.status)) throw new Error("TERMINAL_LEAD");
  const cleanTitle = title?.trim();
  const dueTimestamp = asTimestamp(dueAt);
  if (!cleanTitle || !dueTimestamp) throw new Error("TASK_DATA_REQUIRED");

  const pending = await pendingTaskDocs(lead.id);
  const batch = writeBatch(db);
  cancelDocs(batch, pending, "REPLACED_BY_MANUAL_ACTION");
  const taskRef = doc(collection(db, "tasks"));
  const taskData = taskPayload({ lead, title: cleanTitle, dueAt: dueTimestamp, type: TASK_TYPES.MANUAL, automatic: false, userId: user.uid });
  batch.set(taskRef, taskData);
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NEXT_ACTION_SET,
    description: `${cleanTitle} programat per al ${dueTimestamp.toDate().toLocaleDateString("ca-ES")}.`,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  const leadUpdate = { status, nextActionTitle: cleanTitle, nextActionAt: dueTimestamp, updatedBy: user.uid, updatedAt: serverTimestamp() };
  batch.update(doc(db, "leads", lead.id), leadUpdate);
  return commitOperation(batch, lead.id, { lead: { ...lead, ...leadUpdate }, tasks: [{ id: taskRef.id, ...taskData }] });
}

export async function removeNextAction({ lead }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const pending = await pendingTaskDocs(lead.id);
  const batch = writeBatch(db);
  cancelDocs(batch, pending, "NEXT_ACTION_REMOVED");
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: ACTIVITY_TYPES.NEXT_ACTION_SET,
    description: "S’ha eliminat la pròxima acció.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  const leadUpdate = { nextActionTitle: "", nextActionAt: null, updatedBy: user.uid, updatedAt: serverTimestamp() };
  batch.update(doc(db, "leads", lead.id), leadUpdate);
  return commitOperation(batch, lead.id, { lead: { ...lead, ...leadUpdate }, tasks: [] });
}

async function setAutomaticNextAction({ lead, title, dueAt, type, activityType, activityDescription, status, noResponseCount, sequence }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const pending = await pendingTaskDocs(lead.id);
  const batch = writeBatch(db);
  cancelDocs(batch, pending, "REPLACED_BY_WORKFLOW_ACTION");
  const taskRef = doc(collection(db, "tasks"));
  const taskData = taskPayload({ lead, title, dueAt, type, automatic: true, userId: user.uid, sequence });
  batch.set(taskRef, taskData);
  batch.set(doc(collection(db, "activities")), {
    leadId: lead.id,
    type: activityType,
    description: activityDescription,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  const leadUpdate = {
    status,
    nextActionTitle: title,
    nextActionAt: dueAt,
    lastContactAt: serverTimestamp(),
    ...(noResponseCount !== undefined ? { noResponseCount } : {}),
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  };
  batch.update(doc(db, "leads", lead.id), leadUpdate);
  return commitOperation(batch, lead.id, { lead: { ...lead, ...leadUpdate }, tasks: [{ id: taskRef.id, ...taskData }] });
}

export function markRepliedWithNextAction(lead) {
  const title = "Seguiment després de resposta";
  const dueAt = Timestamp.fromDate(addDays(new Date(), Math.max(3, FOLLOW_UP_DEFAULTS.SECOND_DAYS)));
  return setAutomaticNextAction({ lead, title, dueAt, type: TASK_TYPES.SECOND_FOLLOW_UP, activityType: ACTIVITY_TYPES.REPLIED, activityDescription: "La futura viatgera ha contestat. Seguiment programat automàticament.", status: LEAD_STATUSES.REPLIED });
}

export function markNoResponseWithNextAction(lead) {
  const noResponseCount = Number(lead.noResponseCount || 0) + 1;
  const isFinalReview = noResponseCount >= FOLLOW_UP_DEFAULTS.MAX_NO_RESPONSE;
  const days = Math.max(3, isFinalReview ? FOLLOW_UP_DEFAULTS.FINAL_REVIEW_DAYS : FOLLOW_UP_DEFAULTS.SECOND_DAYS);
  const title = isFinalReview ? "Revisió final sense resposta" : "Segon seguiment pendent";
  const dueAt = Timestamp.fromDate(addDays(new Date(), days));
  return setAutomaticNextAction({
    lead, title, dueAt,
    type: isFinalReview ? TASK_TYPES.FINAL_REVIEW : TASK_TYPES.SECOND_FOLLOW_UP,
    activityType: ACTIVITY_TYPES.NO_RESPONSE,
    activityDescription: noResponseCount === 1 ? "Primer seguiment sense resposta." : `${noResponseCount} seguiments sense resposta.`,
    status: LEAD_STATUSES.FOLLOW_UP,
    noResponseCount,
    sequence: noResponseCount + 1
  });
}

async function closeLead({ lead, status, activityType, description, extraUpdate = {} }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const pending = await pendingTaskDocs(lead.id);
  const batch = writeBatch(db);
  cancelDocs(batch, pending, "LEAD_CLOSED");
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: activityType, description, createdBy: user.uid, createdAt: serverTimestamp() });
  const leadUpdate = { status, nextActionTitle: "", nextActionAt: null, ...extraUpdate, updatedBy: user.uid, updatedAt: serverTimestamp() };
  batch.update(doc(db, "leads", lead.id), leadUpdate);
  return commitOperation(batch, lead.id, { lead: { ...lead, ...leadUpdate }, tasks: [] });
}

export function confirmBookingWithoutNextAction(lead) {
  return closeLead({ lead, status: LEAD_STATUSES.BOOKING_CONFIRMED, activityType: ACTIVITY_TYPES.BOOKING_CONFIRMED, description: "Reserva confirmada." });
}

export function markLostWithoutNextAction({ lead, reason, note = "" }) {
  if (!reason || !Object.values(LOST_REASONS).includes(reason)) throw new Error("LOST_REASON_REQUIRED");
  return closeLead({
    lead,
    status: LEAD_STATUSES.LOST,
    activityType: ACTIVITY_TYPES.LEAD_LOST,
    description: `Lead marcat com a perdut.${note?.trim() ? ` ${note.trim()}` : ""}`,
    extraUpdate: { lostReason: reason, lostNote: note?.trim() || "", lostAt: serverTimestamp() }
  });
}
