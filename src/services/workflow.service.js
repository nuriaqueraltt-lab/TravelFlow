import {
  collection,
  doc,
  getDoc,
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
import { getTrips } from "./trip.service.js";
import { invalidateLeadsCache } from "./lead.service.js";
import {
  ACTIVITY_TYPES,
  FOLLOW_UP_DEFAULTS,
  LEAD_STATUSES,
  LOST_REASONS,
  TASK_STATUSES,
  TASK_TYPES
} from "../config/app.constants.js";

const MAINTENANCE_KEY = "travelflow:dashboard-maintenance";
const MAINTENANCE_TTL = 5 * 60 * 1000;

function addDays(date, days) { const result = new Date(date); result.setHours(9, 0, 0, 0); result.setDate(result.getDate() + days); return result; }
function asTimestamp(value) { if (!value) return null; if (typeof value.toDate === "function") return value; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date); }
function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function todayIso() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function shouldRunMaintenance() { const lastRun = Number(sessionStorage.getItem(MAINTENANCE_KEY) || 0); return !lastRun || Date.now() - lastRun > MAINTENANCE_TTL; }
async function commitLeadBatch(batch) { await batch.commit(); invalidateLeadsCache(); }

export async function getLeadTasks(leadId) {
  const snapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId)));
  return snapshot.docs.map(mapDocument).sort((a, b) => (a.dueAt?.toMillis?.() ?? 0) - (b.dueAt?.toMillis?.() ?? 0));
}

export async function processClosedTrips({ trips: suppliedTrips = null, leads: suppliedLeads = null } = {}) {
  const user = getCurrentUser();
  if (!user) return 0;
  const [trips, leads, pendingTasksSnapshot] = await Promise.all([
    suppliedTrips ? Promise.resolve(suppliedTrips) : getTrips(),
    suppliedLeads ? Promise.resolve(suppliedLeads) : getDocs(collection(db, "leads")).then((snapshot) => snapshot.docs.map(mapDocument)),
    getDocs(query(collection(db, "tasks"), where("status", "==", TASK_STATUSES.PENDING)))
  ]);
  const today = todayIso();
  const closedTrips = trips.filter((trip) => trip.closingDate && trip.closingDate <= today);
  if (!closedTrips.length) return 0;
  const pendingKeys = new Set(pendingTasksSnapshot.docs.map((item) => { const task = item.data(); return `${task.leadId}|${task.tripId}|${task.type}`; }));
  const activeLeads = leads.filter((lead) => lead.active !== false && ![LEAD_STATUSES.LOST, LEAD_STATUSES.BOOKING_CONFIRMED].includes(lead.status));
  const operations = [];
  closedTrips.forEach((trip) => {
    activeLeads.filter((lead) => Array.isArray(lead.tripIds) && lead.tripIds.includes(trip.id)).forEach((lead) => {
      const key = `${lead.id}|${trip.id}|${TASK_TYPES.TRIP_CLOSED}`;
      if (pendingKeys.has(key)) return;
      operations.push((batch) => {
        batch.set(doc(collection(db, "tasks")), { leadId: lead.id, leadName: lead.fullName, tripId: trip.id, tripName: trip.name, title: "Viatge tancat", type: TASK_TYPES.TRIP_CLOSED, status: TASK_STATUSES.PENDING, automatic: true, dueAt: Timestamp.fromDate(new Date(`${trip.closingDate}T09:00:00`)), createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.TRIP_CLOSED, description: `${trip.name}: viatge tancat. Cal decidir llista d'espera, proper any o pèrdua.`, tripId: trip.id, createdBy: user.uid, createdAt: serverTimestamp() });
      });
      pendingKeys.add(key);
    });
  });
  for (let start = 0; start < operations.length; start += 220) {
    const batch = writeBatch(db);
    operations.slice(start, start + 220).forEach((operation) => operation(batch));
    await batch.commit();
  }
  return operations.length;
}

export async function getOpenTasks({ leads = null, trips = null, runMaintenance = true } = {}) {
  if (runMaintenance && shouldRunMaintenance()) {
    await processClosedTrips({ leads, trips });
    sessionStorage.setItem(MAINTENANCE_KEY, String(Date.now()));
  }
  const snapshot = await getDocs(query(collection(db, "tasks"), where("status", "==", TASK_STATUSES.PENDING)));
  const tasks = snapshot.docs.map(mapDocument);
  let existing;
  if (Array.isArray(leads)) {
    existing = new Map(leads.map((lead) => [lead.id, lead.active !== false]));
  } else {
    const leadIds = [...new Set(tasks.map((task) => task.leadId).filter(Boolean))];
    const leadEntries = await Promise.all(leadIds.map(async (leadId) => {
      const leadSnapshot = await getDoc(doc(db, "leads", leadId));
      return [leadId, leadSnapshot.exists() && leadSnapshot.data().active !== false];
    }));
    existing = new Map(leadEntries);
  }
  const orphaned = tasks.filter((task) => !existing.get(task.leadId));
  if (orphaned.length) {
    for (let start = 0; start < orphaned.length; start += 400) {
      const batch = writeBatch(db);
      orphaned.slice(start, start + 400).forEach((task) => batch.update(doc(db, "tasks", task.id), { status: TASK_STATUSES.CANCELLED, cancelledReason: "LEAD_DELETED_OR_INACTIVE", updatedAt: serverTimestamp() }));
      await batch.commit();
    }
  }
  return tasks.filter((task) => existing.get(task.leadId)).sort((a, b) => (a.dueAt?.toMillis?.() ?? 0) - (b.dueAt?.toMillis?.() ?? 0));
}

export async function cancelPendingAutomaticTasks(leadId, batch = null) {
  const snapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId), where("status", "==", TASK_STATUSES.PENDING)));
  const ownBatch = batch ?? writeBatch(db);
  snapshot.docs.forEach((taskDoc) => {
    if (taskDoc.data().automatic === true && taskDoc.data().type !== TASK_TYPES.TRIP_CLOSED) ownBatch.update(taskDoc.ref, { status: TASK_STATUSES.CANCELLED, cancelledReason: "REPLACED_BY_MANUAL_ACTION", updatedAt: serverTimestamp() });
  });
  if (!batch) await ownBatch.commit();
}

export async function recordManualContact({ lead, description, status = LEAD_STATUSES.FOLLOW_UP }) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.CONTACT, description: description?.trim() || "Contacte comercial registrat.", createdBy: user.uid, createdAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status, lastContactAt: serverTimestamp(), updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
}

export async function scheduleManualFollowUp({ lead, title, dueAt, status = LEAD_STATUSES.CONTACT_LATER }) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  const dueTimestamp = asTimestamp(dueAt); if (!title?.trim() || !dueTimestamp) throw new Error("TASK_DATA_REQUIRED");
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "tasks")), { leadId: lead.id, leadName: lead.fullName, tripName: lead.tripLabels?.[0] || lead.interest || "", title: title.trim(), type: TASK_TYPES.MANUAL, status: TASK_STATUSES.PENDING, automatic: false, dueAt: dueTimestamp, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.NEXT_ACTION_SET, description: `${title.trim()} programat per al ${new Date(dueAt).toLocaleDateString("ca-ES")}.`, createdBy: user.uid, createdAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status, nextActionTitle: title.trim(), nextActionAt: dueTimestamp, updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
}

export async function markReplied(lead) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  const title = "Seguiment després de resposta";
  const dueAt = Timestamp.fromDate(addDays(new Date(), Math.max(3, FOLLOW_UP_DEFAULTS.SECOND_DAYS)));
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.REPLIED, description: "La futura viatgera ha contestat. Seguiment programat automàticament.", createdBy: user.uid, createdAt: serverTimestamp() });
  batch.set(doc(collection(db, "tasks")), { leadId: lead.id, leadName: lead.fullName, tripName: lead.tripLabels?.[0] || lead.interest || "", title, type: TASK_TYPES.SECOND_FOLLOW_UP, status: TASK_STATUSES.PENDING, automatic: true, dueAt, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status: LEAD_STATUSES.REPLIED, nextActionAt: dueAt, nextActionTitle: title, lastContactAt: serverTimestamp(), updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
  return { nextActionTitle: title, nextActionAt: dueAt };
}

export async function markNoResponse(lead) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  const noResponseCount = Number(lead.noResponseCount || 0) + 1;
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.NO_RESPONSE, description: noResponseCount === 1 ? "Primer seguiment sense resposta." : `${noResponseCount} seguiments sense resposta.`, createdBy: user.uid, createdAt: serverTimestamp() });
  const isFinalReview = noResponseCount >= FOLLOW_UP_DEFAULTS.MAX_NO_RESPONSE;
  const days = Math.max(3, isFinalReview ? FOLLOW_UP_DEFAULTS.FINAL_REVIEW_DAYS : FOLLOW_UP_DEFAULTS.SECOND_DAYS);
  const title = isFinalReview ? "Revisió final sense resposta" : "Segon seguiment pendent";
  const dueAt = Timestamp.fromDate(addDays(new Date(), days));
  batch.set(doc(collection(db, "tasks")), { leadId: lead.id, leadName: lead.fullName, tripName: lead.tripLabels?.[0] || lead.interest || "", title, type: isFinalReview ? TASK_TYPES.FINAL_REVIEW : TASK_TYPES.SECOND_FOLLOW_UP, status: TASK_STATUSES.PENDING, automatic: true, sequence: noResponseCount + 1, dueAt, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status: LEAD_STATUSES.FOLLOW_UP, noResponseCount, nextActionTitle: title, nextActionAt: dueAt, lastContactAt: serverTimestamp(), updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
  return { noResponseCount, nextActionTitle: title, nextActionAt: dueAt };
}

export async function confirmBooking(lead) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.BOOKING_CONFIRMED, description: "Reserva confirmada.", createdBy: user.uid, createdAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status: LEAD_STATUSES.BOOKING_CONFIRMED, nextActionAt: null, nextActionTitle: "", updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
}

export async function markLeadLost({ lead, reason, note = "" }) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  if (!reason || !Object.values(LOST_REASONS).includes(reason)) throw new Error("LOST_REASON_REQUIRED");
  const batch = writeBatch(db); await cancelPendingAutomaticTasks(lead.id, batch);
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.LEAD_LOST, description: `Lead marcat com a perdut.${note?.trim() ? ` ${note.trim()}` : ""}`, lostReason: reason, createdBy: user.uid, createdAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), { status: LEAD_STATUSES.LOST, lostReason: reason, lostNote: note?.trim() || "", lostAt: serverTimestamp(), nextActionAt: null, nextActionTitle: "", updatedBy: user.uid, updatedAt: serverTimestamp() });
  await commitLeadBatch(batch);
}

export async function resolveTripClosedTask({ lead, task, decision }) {
  const user = getCurrentUser(); if (!user) throw new Error("AUTH_REQUIRED");
  if (!["WAITLIST", "NEXT_YEAR", "LOST"].includes(decision)) throw new Error("TRIP_CLOSED_DECISION_REQUIRED");
  const batch = writeBatch(db);
  batch.update(doc(db, "tasks", task.id), { status: TASK_STATUSES.COMPLETED, completedAt: serverTimestamp(), resolution: decision, updatedAt: serverTimestamp() });
  const descriptions = { WAITLIST: "Afegida a la llista d'espera.", NEXT_YEAR: "Afegida al llistat d'interessades del proper any.", LOST: "Lead marcat com a perdut perquè el viatge està tancat." };
  batch.set(doc(collection(db, "activities")), { leadId: lead.id, type: ACTIVITY_TYPES.TRIP_CLOSED, description: descriptions[decision], tripId: task.tripId, createdBy: user.uid, createdAt: serverTimestamp() });
  const update = { nextActionAt: null, nextActionTitle: "", updatedBy: user.uid, updatedAt: serverTimestamp() };
  if (decision === "WAITLIST") Object.assign(update, { status: LEAD_STATUSES.CONTACT_LATER, commercialList: "WAITLIST", commercialListTripId: task.tripId });
  if (decision === "NEXT_YEAR") Object.assign(update, { status: LEAD_STATUSES.CONTACT_LATER, commercialList: "NEXT_YEAR", commercialListTripId: task.tripId });
  if (decision === "LOST") Object.assign(update, { status: LEAD_STATUSES.LOST, lostReason: LOST_REASONS.DATES, lostNote: "Viatge tancat", lostAt: serverTimestamp() });
  batch.update(doc(db, "leads", lead.id), update);
  await commitLeadBatch(batch);
}

export async function completeTask(taskId) { await updateDoc(doc(db, "tasks", taskId), { status: TASK_STATUSES.COMPLETED, completedAt: serverTimestamp(), updatedAt: serverTimestamp() }); }

export function getWorkflowErrorMessage(error) {
  const messages = { AUTH_REQUIRED: "La sessió ha caducat.", TASK_DATA_REQUIRED: "Indica una acció i una data.", LOST_REASON_REQUIRED: "Selecciona obligatòriament el motiu de pèrdua.", TRIP_CLOSED_DECISION_REQUIRED: "Selecciona què vols fer amb aquest lead.", "permission-denied": "No tens permís per completar aquesta operació." };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'acció.";
}
