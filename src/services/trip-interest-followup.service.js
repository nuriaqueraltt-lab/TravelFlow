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

const TERMINAL_STATUSES = new Set(["LOST", "BOOKING_CONFIRMED"]);
const INFO_READY_TASK_TYPE = "TRIP_INFO_READY";

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function isPendingTrip(trip) {
  return !trip || trip.datesPending === true || !trip.startDate || !trip.endDate;
}

function todayAtNine() {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return Timestamp.fromDate(date);
}

async function commitInChunks(operations) {
  for (let start = 0; start < operations.length; start += 350) {
    const batch = writeBatch(db);
    operations.slice(start, start + 350).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function suspendLeadsWaitingForTripDates() {
  const user = getCurrentUser();
  if (!user) return 0;

  const [tripsSnapshot, leadsSnapshot, tasksSnapshot] = await Promise.all([
    getDocs(collection(db, "trips")),
    getDocs(collection(db, "leads")),
    getDocs(query(collection(db, "tasks"), where("status", "==", "PENDING")))
  ]);

  const trips = new Map(tripsSnapshot.docs.map((item) => [item.id, item.data()]));
  const pendingTasksByLead = new Map();

  tasksSnapshot.docs.forEach((taskDoc) => {
    const task = taskDoc.data();
    if (!pendingTasksByLead.has(task.leadId)) pendingTasksByLead.set(task.leadId, []);
    pendingTasksByLead.get(task.leadId).push(taskDoc);
  });

  const operations = [];
  let affected = 0;

  leadsSnapshot.docs.forEach((leadDoc) => {
    const lead = leadDoc.data();
    const tripIds = Array.isArray(lead.tripIds) ? lead.tripIds.filter(Boolean) : [];
    if (lead.active === false || TERMINAL_STATUSES.has(lead.status) || !tripIds.length) return;

    const waitsOnlyForUndatedTrips = tripIds.every((tripId) => isPendingTrip(trips.get(tripId)));
    if (!waitsOnlyForUndatedTrips) return;

    const hasNextAction = Boolean(lead.nextActionAt || lead.nextActionTitle);
    const pendingTasks = pendingTasksByLead.get(leadDoc.id) || [];
    const cancellableTasks = pendingTasks.filter((taskDoc) => taskDoc.data().type !== "TRIP_CLOSED");
    if (!hasNextAction && !cancellableTasks.length) return;

    operations.push((batch) => {
      batch.update(leadDoc.ref, {
        status: "CONTACT_LATER",
        nextActionAt: null,
        nextActionTitle: "",
        waitingForTripDates: true,
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      });
    });

    cancellableTasks.forEach((taskDoc) => {
      operations.push((batch) => {
        batch.update(taskDoc.ref, {
          status: "CANCELLED",
          cancelledReason: "TRIP_DATES_PENDING",
          updatedAt: serverTimestamp()
        });
      });
    });

    affected += 1;
  });

  await commitInChunks(operations);
  return affected;
}

export async function activateTripInformationFollowUps({ tripId, tripName }) {
  const user = getCurrentUser();
  if (!user || !tripId) return 0;

  const [leadsSnapshot, existingTasksSnapshot] = await Promise.all([
    getDocs(collection(db, "leads")),
    getDocs(query(collection(db, "tasks"), where("status", "==", "PENDING")))
  ]);

  const existingKeys = new Set(existingTasksSnapshot.docs.map((taskDoc) => {
    const task = taskDoc.data();
    return `${task.leadId}|${task.tripId}|${task.type}`;
  }));

  const dueAt = todayAtNine();
  const title = `Enviar informació de ${tripName || "viatge"}`;
  const operations = [];
  let activated = 0;

  leadsSnapshot.docs.map(mapDocument).forEach((lead) => {
    if (lead.active === false || TERMINAL_STATUSES.has(lead.status)) return;
    if (!Array.isArray(lead.tripIds) || !lead.tripIds.includes(tripId)) return;

    const key = `${lead.id}|${tripId}|${INFO_READY_TASK_TYPE}`;
    if (existingKeys.has(key)) return;

    operations.push((batch) => {
      batch.set(doc(collection(db, "tasks")), {
        leadId: lead.id,
        leadName: lead.fullName || "Futura viatgera",
        tripId,
        tripName: tripName || "Viatge",
        title,
        type: INFO_READY_TASK_TYPE,
        status: "PENDING",
        automatic: true,
        dueAt,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(doc(collection(db, "activities")), {
        leadId: lead.id,
        tripId,
        type: "NEXT_ACTION_SET",
        description: `${tripName || "El viatge"} ja té dates. Ja es pot enviar la informació.`,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });

      batch.update(doc(db, "leads", lead.id), {
        status: "FOLLOW_UP",
        nextActionTitle: title,
        nextActionAt: dueAt,
        waitingForTripDates: false,
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      });
    });

    existingKeys.add(key);
    activated += 1;
  });

  await commitInChunks(operations);
  return activated;
}
