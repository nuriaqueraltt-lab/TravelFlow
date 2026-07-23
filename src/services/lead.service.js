import { arrayUnion, collection, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, Timestamp, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { ACTIVITY_TYPES, FOLLOW_UP_DEFAULTS, LEAD_PRIORITIES, LEAD_STATUSES, LEAD_TEMPERATURES, TASK_STATUSES, TASK_TYPES } from "../config/app.constants.js";
import { buildTripInterests } from "./trip-interest.model.js";

const LEADS_CACHE_TTL = 5 * 60 * 1000;
let leadsCache = null;
let leadsCacheComplete = false;
let leadsCacheAt = 0;
let leadsRequest = null;
let leadsPageCursor = null;
let leadsPageHasMore = true;
const tripLeadsCache = new Map();
let confirmedBookingsCache = null;
let confirmedBookingsCacheAt = 0;
let confirmedBookingsRequest = null;

function normalizePhone(phone = "") { return String(phone).replace(/\D/g, ""); }
function normalizeEmail(email = "") { return String(email).trim().toLowerCase(); }
function normalizeInstagram(value = "") { const clean = String(value).trim(); if (!clean) return ""; return /^https?:\/\//i.test(clean) ? clean : clean.replace(/^@/, ""); }
function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function getTimestampMillis(value) { if (!value) return 0; if (typeof value.toMillis === "function") return value.toMillis(); if (typeof value.toDate === "function") return value.toDate().getTime(); return new Date(value).getTime() || 0; }
function parseArrayValue(value) { if (!value) return []; if (Array.isArray(value)) return value.filter(Boolean); try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(Boolean) : []; } catch { return []; } }
function todayIso() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function dateAtLocalTime(value, hour = 10) { if (!value) return new Date(); const date = new Date(`${value}T${String(hour).padStart(2, "0")}:00:00`); if (Number.isNaN(date.getTime())) throw new Error("INVALID_CONTACT_DATE"); return date; }
function addDaysFrom(baseDate, days) { const date = new Date(baseDate); date.setHours(9, 0, 0, 0); date.setDate(date.getDate() + days); return date; }
function sortLeads(items) { return [...items].sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt)); }
function setLeadsCache(items, { complete = leadsCacheComplete } = {}) { leadsCache = sortLeads(items.filter((lead) => lead.active !== false)); leadsCacheComplete = complete; leadsCacheAt = Date.now(); return leadsCache; }
function upsertLeadCache(lead) { if (!leadsCache) return; const index = leadsCache.findIndex((item) => item.id === lead.id); if (index >= 0) leadsCache[index] = { ...leadsCache[index], ...lead }; else leadsCache.unshift(lead); leadsCache = sortLeads(leadsCache.filter((item) => item.active !== false)); leadsCacheAt = Date.now(); }
export function patchLeadCache(leadId, update) { if (!leadId || !update) return; upsertLeadCache({ id: leadId, ...update }); }
export function invalidateLeadsCache() { leadsCache = null; leadsCacheComplete = false; leadsCacheAt = 0; leadsRequest = null; leadsPageCursor = null; leadsPageHasMore = true; tripLeadsCache.clear(); confirmedBookingsCache = null; confirmedBookingsCacheAt = 0; confirmedBookingsRequest = null; }
window.addEventListener("travelflow:leads-updated", invalidateLeadsCache);

export async function getConfirmedBookings({ force = false } = {}) {
  if (!force && leadsCache && Date.now() - leadsCacheAt < LEADS_CACHE_TTL) return leadsCache.filter((lead) => lead.status === "BOOKING_CONFIRMED");
  if (!force && confirmedBookingsCache && Date.now() - confirmedBookingsCacheAt < LEADS_CACHE_TTL) return confirmedBookingsCache;
  if (!force && confirmedBookingsRequest) return confirmedBookingsRequest;
  confirmedBookingsRequest = getDocs(query(collection(db, "leads"), where("status", "==", "BOOKING_CONFIRMED")))
    .then((snapshot) => {
      confirmedBookingsCache = snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
      confirmedBookingsCacheAt = Date.now();
      return confirmedBookingsCache;
    })
    .finally(() => { confirmedBookingsRequest = null; });
  return confirmedBookingsRequest;
}

export async function getLeadsByTrip(tripId, { force = false } = {}) {
  if (!tripId) return [];
  if (!force && leadsCache && Date.now() - leadsCacheAt < LEADS_CACHE_TTL) {
    return leadsCache.filter((lead) => Array.isArray(lead.tripIds) && lead.tripIds.includes(tripId));
  }

  const cached = tripLeadsCache.get(tripId);
  if (!force && cached && Date.now() - cached.at < LEADS_CACHE_TTL) return cached.items;

  const snapshot = await getDocs(query(collection(db, "leads"), where("tripIds", "array-contains", tripId)));
  const items = snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
  tripLeadsCache.set(tripId, { items, at: Date.now() });
  return items;
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

  const entryTimestamp = Timestamp.fromDate(dateAtLocalTime(input.entryDate, 10));
  const lastContactDate = dateAtLocalTime(input.lastContactDate || input.entryDate, 12);
  const lastContactTimestamp = Timestamp.fromDate(lastContactDate);
  const firstFollowUpAt = Timestamp.fromDate(addDaysFrom(lastContactDate, FOLLOW_UP_DEFAULTS.FIRST_DAYS));
  const leadRef = doc(collection(db, "leads"));
  const activityRef = doc(collection(db, "activities"));
  const taskRef = doc(collection(db, "tasks"));
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const phone = input.phone?.trim() ?? "";
  const tripIds = parseArrayValue(input.tripIds);
  const tripLabels = parseArrayValue(input.tripLabels);
  const tripInterests = buildTripInterests({}, tripIds, tripLabels);
  const whatsappOrigin = input.entryPreset === "WHATSAPP" ? (input.whatsappOrigin || "OTHER") : "";
  const googleAdsEntryMethod = input.entryPreset === "GOOGLE_ADS" ? (input.googleAdsEntryMethod || "") : "";
  const isGoogleAdsForm = googleAdsEntryMethod === "FORM";
  const leadData = {
    firstName, lastName, fullName, fullNameSearch: fullName.toLowerCase(), phone,
    phoneNormalized: normalizePhone(phone), email: normalizeEmail(input.email),
    instagramHandle: normalizeInstagram(input.instagramHandle), facebookUrl: input.facebookUrl?.trim() ?? "",
    channel: input.channel, source: input.source, entryPreset: input.entryPreset ?? "",
    whatsappOrigin,
    googleAdsEntryMethod,
    googleAdsCampaignId: isGoogleAdsForm ? input.googleAdsCampaignId?.trim() ?? "" : "",
    googleAdsAdGroupId: isGoogleAdsForm ? input.googleAdsAdGroupId?.trim() ?? "" : "",
    googleAdsAdId: isGoogleAdsForm ? input.googleAdsAdId?.trim() ?? "" : "",
    googleAdsSearchTheme: isGoogleAdsForm ? input.googleAdsSearchTheme?.trim() ?? "" : "",
    tripIds, tripLabels, tripInterests, interest: tripLabels.join(", "), notes: input.notes?.trim() ?? "",
    status: LEAD_STATUSES.NEW, priority: LEAD_PRIORITIES.NORMAL, temperature: LEAD_TEMPERATURES.WARM,
    ownerId: currentUser.uid, createdBy: currentUser.uid, updatedBy: currentUser.uid,
    active: true, noResponseCount: 0, lastContactAt: lastContactTimestamp,
    nextActionTitle: "Primer seguiment pendent", nextActionAt: firstFollowUpAt,
    createdAt: entryTimestamp, updatedAt: serverTimestamp()
  };

  const batch = writeBatch(db);
  batch.set(leadRef, leadData);
  batch.set(activityRef, { leadId: leadRef.id, type: ACTIVITY_TYPES.LEAD_CREATED, description: `Nova consulta rebuda per ${input.entryLabel || input.channel}.`, channel: input.channel, source: input.source, createdBy: currentUser.uid, createdAt: entryTimestamp });
  batch.set(taskRef, { leadId: leadRef.id, leadName: fullName, tripName: tripLabels[0] || "", title: "Primer seguiment pendent", type: TASK_TYPES.FIRST_FOLLOW_UP, status: TASK_STATUSES.PENDING, automatic: true, sequence: 1, dueAt: firstFollowUpAt, createdBy: currentUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();

  upsertLeadCache({ id: leadRef.id, ...leadData });
  tripIds.forEach((tripId) => tripLeadsCache.delete(tripId));
  return { id: leadRef.id, fullName, channel: input.channel, source: input.source, tripIds, tripLabels, nextActionTitle: "Primer seguiment pendent", nextActionAt: firstFollowUpAt };
}

export async function updateLead(leadId, input, currentLead = {}) {
  const currentUser = getCurrentUser(); if (!currentUser) throw new Error("AUTH_REQUIRED");
  const firstName = input.firstName?.trim(); const lastName = input.lastName?.trim() ?? ""; if (!firstName) throw new Error("FIRST_NAME_REQUIRED");
  const tripIds = parseArrayValue(input.tripIds); const tripLabels = parseArrayValue(input.tripLabels); const fullName = [firstName, lastName].filter(Boolean).join(" "); const phone = input.phone?.trim() ?? "";
  const suppliedStatuses = input.tripStatuses ? JSON.parse(input.tripStatuses) : {};
  const tripInterests = buildTripInterests(currentLead, tripIds, tripLabels, suppliedStatuses);
  const bookingRemoved = currentLead.bookingTripId && !tripIds.includes(currentLead.bookingTripId);
  const update = { firstName, lastName, fullName, fullNameSearch: fullName.toLowerCase(), phone, phoneNormalized: normalizePhone(phone), email: normalizeEmail(input.email), instagramHandle: normalizeInstagram(input.instagramHandle), facebookUrl: input.facebookUrl?.trim() ?? "", notes: input.notes?.trim() ?? "", tripIds, tripLabels, tripInterests, interest: tripLabels.join(", "), ...(bookingRemoved ? { status: tripInterests[tripIds[0]]?.status || LEAD_STATUSES.NEW, bookingTripId: deleteField(), bookingTripNameSnapshot: deleteField(), bookingDui: deleteField(), bookedAt: deleteField() } : {}), updatedBy: currentUser.uid, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, "leads", leadId), update); upsertLeadCache({ id: leadId, ...update, ...(bookingRemoved ? { bookingTripId: "", bookingTripNameSnapshot: "", bookingDui: false, bookedAt: null } : {}) });
  tripLeadsCache.clear();
  confirmedBookingsCache = null; confirmedBookingsCacheAt = 0; confirmedBookingsRequest = null;
  const taskSnapshot = await getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId), where("status", "==", TASK_STATUSES.PENDING)));
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "activities")), { leadId, type: ACTIVITY_TYPES.NOTE, description: "Dades i etiquetes de la futura viatgera actualitzades.", createdBy: currentUser.uid, createdAt: serverTimestamp() });
  taskSnapshot.docs.forEach((taskDoc) => batch.update(taskDoc.ref, { leadName: fullName, tripName: tripLabels[0] || "", updatedAt: serverTimestamp() }));
  await batch.commit();
}

export async function linkLeadToClient(leadId, client) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!leadId || !client?.id) throw new Error("INVALID_CLIENT_LINK");
  const leadRef = doc(db, "leads", leadId);
  const snapshot = await getDoc(leadRef);
  if (!snapshot.exists()) throw new Error("LEAD_NOT_FOUND");
  if (snapshot.data().clientId && snapshot.data().clientId !== client.id) throw new Error("LEAD_ALREADY_LINKED");
  const update = { clientId: client.id, clientNameSnapshot: client.fullName || "", clientLinkedAt: serverTimestamp(), clientLinkedBy: currentUser.uid, updatedBy: currentUser.uid, updatedAt: serverTimestamp() };
  await updateDoc(leadRef, update);
  upsertLeadCache({ id: leadId, ...update });
}

export async function rejectLeadClientMatch(leadId, clientId) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!leadId || !clientId) throw new Error("INVALID_CLIENT_LINK");
  const update = { rejectedClientMatchIds: arrayUnion(clientId), updatedBy: currentUser.uid, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, "leads", leadId), update);
  invalidateLeadsCache();
}

export async function getLeads({ force = false } = {}) { if (!force && leadsCacheComplete && leadsCache && Date.now() - leadsCacheAt < LEADS_CACHE_TTL) return leadsCache; if (!force && leadsRequest) return leadsRequest; leadsRequest = getDocs(query(collection(db, "leads"), orderBy("createdAt", "desc"))).then((snapshot) => { leadsPageHasMore = false; leadsPageCursor = snapshot.docs.at(-1) || null; return setLeadsCache(snapshot.docs.map(mapDocument), { complete: true }); }).finally(() => { leadsRequest = null; }); return leadsRequest; }
export async function getLeadsPage({ pageSize = 50, reset = false, next = false } = {}) {
  if (reset) {
    leadsCache = [];
    leadsPageCursor = null;
    leadsPageHasMore = true;
  }
  if (!reset && !next && leadsCache && Date.now() - leadsCacheAt < LEADS_CACHE_TTL) {
    return { items: leadsCache, hasMore: leadsPageHasMore };
  }
  if (!leadsPageHasMore) return { items: leadsCache || [], hasMore: false };
  const constraints = [orderBy("createdAt", "desc")];
  if (leadsPageCursor) constraints.push(startAfter(leadsPageCursor));
  constraints.push(limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(db, "leads"), ...constraints));
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = snapshot.docs.slice(0, pageSize);
  leadsPageCursor = pageDocs.at(-1) || leadsPageCursor;
  leadsPageHasMore = hasMore;
  const merged = [...(leadsCache || []), ...pageDocs.map(mapDocument)];
  setLeadsCache([...new Map(merged.map((lead) => [lead.id, lead])).values()], { complete: !hasMore });
  return { items: leadsCache, hasMore };
}
export async function getLeadById(leadId, { force = false } = {}) { if (!force && leadsCache) { const cached = leadsCache.find((lead) => lead.id === leadId); if (cached) return cached; } const snapshot = await getDoc(doc(db, "leads", leadId)); const lead = snapshot.exists() ? mapDocument(snapshot) : null; if (lead) upsertLeadCache(lead); return lead; }
export async function getLeadActivities(leadId, { pageSize = 30, cursor = null } = {}) {
  const constraints = [where("leadId", "==", leadId), orderBy("createdAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(db, "activities"), ...constraints));
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = snapshot.docs.slice(0, pageSize);
  return {
    items: pageDocs.map(mapDocument),
    cursor: pageDocs.at(-1) || null,
    hasMore
  };
}
export function getLeadErrorMessage(error) { const messages = { AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.", FIRST_NAME_REQUIRED: "Introdueix el nom de la futura viatgera.", ENTRY_SOURCE_REQUIRED: "Selecciona el canal d'entrada abans de guardar.", INVALID_CONTACT_DATE: "Alguna de les dates indicades no és vàlida.", ENTRY_DATE_FUTURE: "La data d'entrada no pot ser posterior a avui.", LAST_CONTACT_DATE_FUTURE: "La data de l'últim contacte no pot ser posterior a avui.", CONTACT_DATE_ORDER: "L'últim contacte no pot ser anterior a la data d'entrada.", "permission-denied": "No tens permisos per crear o modificar aquest lead.", unavailable: "No s'ha pogut connectar amb Firestore. Revisa la connexió." }; return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació."; }
