import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { getTrips } from "./trip.service.js";
import {
  ACTIVITY_TYPES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  LOST_REASONS
} from "../config/app.constants.js";

function normalizePhone(phone = "") {
  return phone.replace(/\D/g, "");
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

function parseArrayValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function closeExpiredLeads(leads) {
  const currentUser = getCurrentUser();
  if (!currentUser) return leads;

  const trips = await getTrips();
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
  const today = todayIso();
  const expiring = leads.filter((lead) => {
    if ([LEAD_STATUSES.CUSTOMER, LEAD_STATUSES.LOST].includes(lead.status)) return false;
    const tripIds = Array.isArray(lead.tripIds) ? lead.tripIds : [];
    if (!tripIds.length) return false;
    const linkedTrips = tripIds.map((id) => tripsById.get(id)).filter(Boolean);
    return linkedTrips.length > 0 && linkedTrips.every((trip) => trip.endDate && trip.endDate < today);
  });

  if (!expiring.length) return leads;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  expiring.forEach((lead) => {
    batch.update(doc(db, "leads", lead.id), {
      status: LEAD_STATUSES.LOST,
      lostReason: LOST_REASONS.DATES,
      lostAutomatically: true,
      lostAt: now,
      updatedAt: now,
      updatedBy: currentUser.uid
    });

    const activityRef = doc(collection(db, "activities"));
    batch.set(activityRef, {
      leadId: lead.id,
      type: ACTIVITY_TYPES.LEAD_LOST,
      description: "Lead passat automàticament a perdut perquè han finalitzat tots els viatges d'interès.",
      createdBy: currentUser.uid,
      createdAt: now
    });
  });

  await batch.commit();
  const expiredIds = new Set(expiring.map((lead) => lead.id));
  return leads.map((lead) =>
    expiredIds.has(lead.id)
      ? { ...lead, status: LEAD_STATUSES.LOST, lostReason: LOST_REASONS.DATES, lostAutomatically: true }
      : lead
  );
}

export async function createLead(input) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim() ?? "";
  if (!firstName) throw new Error("FIRST_NAME_REQUIRED");
  if (!input.channel || !input.source) throw new Error("ENTRY_SOURCE_REQUIRED");

  const leadRef = doc(collection(db, "leads"));
  const activityRef = doc(collection(db, "activities"));
  const batch = writeBatch(db);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const email = normalizeEmail(input.email);
  const phone = input.phone?.trim() ?? "";
  const tripIds = parseArrayValue(input.tripIds);
  const tripLabels = parseArrayValue(input.tripLabels);
  const now = serverTimestamp();

  batch.set(leadRef, {
    firstName,
    lastName,
    fullName,
    fullNameSearch: fullName.toLowerCase(),
    phone,
    phoneNormalized: normalizePhone(phone),
    email,
    channel: input.channel,
    source: input.source,
    entryPreset: input.entryPreset ?? "",
    tripIds,
    tripLabels,
    interest: tripLabels.join(", "),
    notes: input.notes?.trim() ?? "",
    status: LEAD_STATUSES.NEW,
    priority: LEAD_PRIORITIES.NORMAL,
    temperature: LEAD_TEMPERATURES.WARM,
    ownerId: currentUser.uid,
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    active: true,
    lastContactAt: null,
    nextActionAt: null,
    createdAt: now,
    updatedAt: now
  });

  batch.set(activityRef, {
    leadId: leadRef.id,
    type: ACTIVITY_TYPES.LEAD_CREATED,
    description: `Futura viatgera creada des de ${input.entryLabel ?? input.channel}.`,
    channel: input.channel,
    source: input.source,
    createdBy: currentUser.uid,
    createdAt: now
  });

  await batch.commit();
  return { id: leadRef.id, fullName, channel: input.channel, source: input.source };
}

export async function getLeads() {
  const snapshot = await getDocs(query(collection(db, "leads"), orderBy("createdAt", "desc")));
  const leads = snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
  return closeExpiredLeads(leads);
}

export async function getLeadById(leadId) {
  const snapshot = await getDoc(doc(db, "leads", leadId));
  return snapshot.exists() ? mapDocument(snapshot) : null;
}

export async function getLeadActivities(leadId) {
  const snapshot = await getDocs(query(collection(db, "activities"), where("leadId", "==", leadId)));
  return snapshot.docs
    .map(mapDocument)
    .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
}

export function getLeadErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    FIRST_NAME_REQUIRED: "Introdueix el nom de la futura viatgera.",
    ENTRY_SOURCE_REQUIRED: "Selecciona el canal d'entrada abans de guardar.",
    "permission-denied": "Firestore encara bloqueja l'escriptura. Cal publicar les regles del projecte.",
    unavailable: "No s'ha pogut connectar amb Firestore. Revisa la connexió."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació.";
}
