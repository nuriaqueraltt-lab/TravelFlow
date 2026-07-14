import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

const TASK_TYPE = "NEXT_YEAR_INTEREST";
const TASK_STATUS_PENDING = "PENDING";
const TASK_STATUS_COMPLETED = "COMPLETED";
const MAX_LEADS_PER_BATCH = 200;

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function taskIdForLead(leadId) {
  return `${leadId}-next-year-interest`;
}

function todayAtNine() {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return Timestamp.fromDate(date);
}

async function commitMissingTasks(leads, user) {
  const dueAt = todayAtNine();

  for (let start = 0; start < leads.length; start += MAX_LEADS_PER_BATCH) {
    const batch = writeBatch(db);
    const group = leads.slice(start, start + MAX_LEADS_PER_BATCH);

    group.forEach((lead) => {
      batch.set(doc(db, "tasks", taskIdForLead(lead.id)), {
        leadId: lead.id,
        leadName: lead.fullName || "Futura viatgera",
        tripName: Array.isArray(lead.tripLabels) ? lead.tripLabels.join(", ") : lead.interest || "",
        title: "Preguntar si vol llista interessades proper any",
        type: TASK_TYPE,
        status: TASK_STATUS_PENDING,
        automatic: true,
        dueAt,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(doc(collection(db, "activities")), {
        leadId: lead.id,
        type: TASK_TYPE,
        description: "El viatge ha finalitzat. Cal preguntar si vol entrar al llistat d’interessades del proper any.",
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
  }
}

export async function ensureExpiredLeadNextYearTasks() {
  const user = getCurrentUser();
  if (!user) return 0;

  const snapshot = await getDocs(collection(db, "leads"));
  const expiredLeads = snapshot.docs
    .map(mapDocument)
    .filter((lead) => lead.active !== false && lead.status === "LOST" && lead.lostAutomatically === true);

  if (!expiredLeads.length) return 0;

  const taskChecks = await Promise.all(expiredLeads.map(async (lead) => {
    const taskSnapshot = await getDoc(doc(db, "tasks", taskIdForLead(lead.id)));
    return taskSnapshot.exists() ? null : lead;
  }));
  const missing = taskChecks.filter(Boolean);

  if (!missing.length) return 0;

  await commitMissingTasks(missing, user);
  return missing.length;
}

export async function addExpiredLeadToNextYear({ leadId, tripId }) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!leadId || !tripId) throw new Error("NEXT_YEAR_TRIP_REQUIRED");

  const [leadSnapshot, tripSnapshot] = await Promise.all([
    getDoc(doc(db, "leads", leadId)),
    getDoc(doc(db, "trips", tripId))
  ]);

  if (!leadSnapshot.exists()) throw new Error("LEAD_NOT_FOUND");
  if (!tripSnapshot.exists()) throw new Error("TRIP_NOT_FOUND");

  const lead = leadSnapshot.data();
  const trip = { id: tripSnapshot.id, ...tripSnapshot.data() };
  const tripIds = [...new Set([...(Array.isArray(lead.tripIds) ? lead.tripIds : []), trip.id])];
  const tripLabels = [...new Set([...(Array.isArray(lead.tripLabels) ? lead.tripLabels : []), trip.name])];
  const batch = writeBatch(db);

  batch.update(doc(db, "leads", leadId), {
    tripIds,
    tripLabels,
    interest: tripLabels.join(", "),
    status: "CONTACT_LATER",
    lostReason: "",
    lostAutomatically: false,
    nextActionTitle: `Interessada en ${trip.name}`,
    nextActionAt: null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });

  batch.set(doc(db, "tasks", taskIdForLead(leadId)), {
    status: TASK_STATUS_COMPLETED,
    completedAt: serverTimestamp(),
    completedBy: user.uid,
    resolution: "ADDED_TO_NEXT_YEAR",
    selectedTripId: trip.id,
    selectedTripName: trip.name,
    updatedAt: serverTimestamp()
  }, { merge: true });

  batch.set(doc(collection(db, "activities")), {
    leadId,
    type: TASK_TYPE,
    description: `Afegida al llistat d’interessades: ${trip.name}.`,
    tripId: trip.id,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });

  await batch.commit();
  return trip;
}

export async function declineExpiredLeadNextYear(leadId) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!leadId) throw new Error("LEAD_NOT_FOUND");

  const batch = writeBatch(db);
  batch.set(doc(db, "tasks", taskIdForLead(leadId)), {
    status: TASK_STATUS_COMPLETED,
    completedAt: serverTimestamp(),
    completedBy: user.uid,
    resolution: "NOT_INTERESTED_NEXT_YEAR",
    updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(collection(db, "activities")), {
    leadId,
    type: TASK_TYPE,
    description: "No vol entrar al llistat d’interessades del proper any.",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  await batch.commit();
}

export function getExpiredLeadFollowUpError(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    NEXT_YEAR_TRIP_REQUIRED: "Selecciona el viatge del proper any.",
    LEAD_NOT_FOUND: "No s’ha trobat la fitxa del lead.",
    TRIP_NOT_FOUND: "No s’ha trobat el viatge seleccionat."
  };
  return messages[error?.message] || messages[error?.code] || "No s’ha pogut completar aquesta acció.";
}
