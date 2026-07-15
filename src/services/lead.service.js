import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  TASK_STATUSES,
  TASK_TYPES
} from "../config/app.constants.js";

const LEADS_CACHE_TTL = 5 * 60 * 1000;
let leadsCache = null;
let leadsCacheAt = 0;
let leadsRequest = null;

function normalizePhone(phone = "") { return String(phone).replace(/\D/g, ""); }
function normalizeEmail(email = "") { return String(email).trim().toLowerCase(); }
function normalizeInstagram(value = "") {
  const clean = String(value).trim();
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  return clean.replace(/^@/, "");
}
function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}
function parseArrayValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(Boolean) : []; }
  catch { return []; }
}
function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function dateAtLocalTime(value, hour = 10) {
  if (!value) return new Date();
  const date = new Date(`${value}T${String(hour).padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_CONTACT_DATE");
  return date;
}
function addDaysFrom(baseDate, days) {
  const date = new Date(baseDate);
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}
function sortLeads(items) {
  return [...items].sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
}
function setLeadsCache(items) {
  leadsCache = sortLeads(items.filter((lead) => lead.active !== false));
  leadsCacheAt = Date.now();
  return leadsCache;
}
function upsertLeadCache(lead) {
  if (!leadsCache) return;
  const index = leadsCache.findIndex((item) => item.id === lead.id);
  if (index >= 0) leadsCache[index] = { ...leadsCache[index], ...lead };
  else leadsCache.unshift(lead);
  leadsCache = sortLeads(leadsCache.filter((item) => item.active !== false));
  leadsCacheAt = Date.now();
}
export function invalidateLeadsCache() {
  leadsCache = null;
  leadsCacheAt = 0;
  leadsRequest = null;
}

async function createLeadSupportRecords({ leadId, fullName, tripLabels, channel, source, entryLabel, entryTimestamp, firstFollowUpAt, userId }) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "activities")), {
    leadId, type: ACTIVITY_TYPES.LEAD_CREATED,
    description: `Nova consulta rebuda per ${entryLabel || channel}.`, channel, source,
    createdBy: userId, createdAt: entryTimestamp
  });
  batch.set(doc(collection(db, "tasks")), {
    leadId, leadName: fullName, tripName: tripLabels[0] || "", title: "Primer seguiment pendent",
    type: TASK_TYPES.FIRST_FOLLOW_UP, status: TASK_STATUSES.PENDING, automatic: true, sequence: 1,
    dueAt: firstFollowUpAt, createdBy: userId, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function createLead(input) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim() ?? "";
  if (!firstName) throw new Error("FIRST_NAME_REQUIRED");
  if (!input.channel || !input.source) throw new Error("ENTRY_SOURCE_REQUIRED");

  const today = todayIso();
  if (input.entryDate && input.entryDate > today) throw new Error("ENTRY_DATE_FUTURE");
  if (input.lastContactDate && input.lastContactDate > today) throw new Error("LAST_CONTACT_DATE_FUTURE");
  if (input.entryDate && input.lastContactDate && input.lastContactDate < input.entryDate) throw new Error("CONTACT_DATE_ORDER");

  const entryDate = dateAtLocalTime(input.entryDate, 10);
  const lastContactDate = dateAtLocalTime(input.lastContactDate || input.entryDate, 12);
  const entryTimestamp = Timestamp.fromDate(entryDate);
  const lastContactTimestamp = Timestamp.fromDate(lastContactDate);
  const firstFollowUpAt = Timestamp.fromDate(addDaysFrom(lastContactDate, FOLLOW_UP_DEFAULTS.FIRST_DAYS));
  const leadRef = doc(collection(db, "leads"));
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const phone = input.phone?.trim() ?? "";
  const tripIds = parseArrayValue(input.tripIds);
  const tripLabels = parseArrayValue(input.tripLabels);
  const leadData = {
    firstName, lastName, fullName, fullNameSearch: fullName.toLowerCase(),
    phone, phoneNormalized: normalizePhone(phone), email: normalizeEmail(input.email),
    instagramHandle: normalizeInstagram(input.instagramHandle), facebookUrl: input.facebookUrl?.trim() ?? "",
    channel: input.channel, source: input.source, entryPreset: input.entryPreset ?? "",
    tripIds, tripLabels, interest: tripLabels.join(", "), notes: input.notes?.trim() ?? "",
    status: LEAD_STATUSES.NEW, priority: LEAD_PRIORITIES.NORMAL, temperature: LEAD_TEMPERATURES.WARM,
    ownerId: currentUser.uid, createdBy: currentUser.uid, updatedBy: currentUser.uid,
    active: true, noResponseCount: 0, lastContactAt: lastContactTimestamp,
    nextActionTitle: "Primer seguiment pendent", nextActionAt: firstFollowUpAt,
    createdAt: entryTimestamp, updatedAt: serverTimestamp()
  };
  await setDoc(leadRef, leadData);
  upsertLeadCache({ id: leadRef.id, ...leadData });

  createLeadSupportRecords({
    leadId: leadRef.id, fullName, tripLabels, channel: input.channel, source: input.source,
    entryLabel: input.entryLabel, entryTimestamp, firstFollowUpAt, userId: currentUser.uid
  }).catch((error) => console.error("El lead s'ha creat, però no s'han pogut completar els registres auxiliars:", error));

  return { id: leadRef.id, fullName, channel: input.channel, source: input.source, tripIds, tripLabels };
}

export async function updateLead(leadId, input) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim() ?? "";
  if (!firstName) throw new Error("FIRST_NAME_REQUIRED");
  const tripIds = parseArrayValue(input.tripIds);
  const tripLabels = parseArrayValue(input.tripLabels);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const phone = input.phone?.trim() ?? "";
  const update = {
    firstName, lastName, fullName, fullNameSearch: fullName.toLowerCase(), phone,
    phoneNormalized: normalizePhone(phone), email: normalizeEmail(input.email),
    instagramHandle: normalizeInstagram(input.instagramHandle), facebookUrl: input.facebookUrl?.trim() ?? "",
    notes: input.notes?.trim() ?? "", tripIds, tripLabels, interest: tripLabels.join(", "),
    updatedBy: currentUser.uid, updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "leads", leadId), update);
  upsertLeadCache({ id: leadId, ...update });

  const taskSnapshot = await getDocs(query(
    collection(db, "tasks"),
    where("leadId", "==", leadId),
    where("status", "==", TASK_STATUSES.PENDING)
  ));
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "activities")), {
    leadId, type: ACTIVITY_TYPES.NOTE, description: "Dades i etiquetes de la futura viatgera actualitzades.",
    createdBy: currentUser.uid, createdAt: serverTimestamp()
  });
  taskSnapshot.docs.forEach((taskDoc) => {
    batch.update(taskDoc.ref, { leadName: fullName, tripName: tripLabels[0] || "", updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

export async function getLeads({ force = false } = {}) {
  if (!force && leadsCache && Date.now() - leadsCacheAt < LEADS_CACHE_TTL) return leadsCache;
  if (!force && leadsRequest) return leadsRequest;
  leadsRequest = getDocs(query(collection(db, "leads"), orderBy("createdAt", "desc")))
    .then((snapshot) => setLeadsCache(snapshot.docs.map(mapDocument)))
    .finally(() => { leadsRequest = null; });
  return leadsRequest;
}

export async function getLeadById(leadId, { force = false } = {}) {
  if (!force && leadsCache) {
    const cached = leadsCache.find((lead) => lead.id === leadId);
    if (cached) return cached;
  }
  const snapshot = await getDoc(doc(db, "leads", leadId));
  const lead = snapshot.exists() ? mapDocument(snapshot) : null;
  if (lead) upsertLeadCache(lead);
  return lead;
}

export async function getLeadActivities(leadId) {
  const snapshot = await getDocs(query(collection(db, "activities"), where("leadId", "==", leadId)));
  return snapshot.docs.map(mapDocument).sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
}

export function getLeadErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    FIRST_NAME_REQUIRED: "Introdueix el nom de la futura viatgera.",
    ENTRY_SOURCE_REQUIRED: "Selecciona el canal d'entrada abans de guardar.",
    INVALID_CONTACT_DATE: "Alguna de les dates indicades no és vàlida.",
    ENTRY_DATE_FUTURE: "La data d'entrada no pot ser posterior a avui.",
    LAST_CONTACT_DATE_FUTURE: "La data de l'últim contacte no pot ser posterior a avui.",
    CONTACT_DATE_ORDER: "L'últim contacte no pot ser anterior a la data d'entrada.",
    "permission-denied": "No tens permisos per crear o modificar aquest lead.",
    unavailable: "No s'ha pogut connectar amb Firestore. Revisa la connexió."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació.";
}
