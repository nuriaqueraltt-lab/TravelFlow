import {
  collection, doc, getDoc, getDocs, limit, query, serverTimestamp, Timestamp,
  setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { LEGACY_PAYMENT_METHODS, PAYMENT_METHODS } from "../config/app.constants.js";

let clientsCache = null;
let clientsCacheComplete = false;
let clientsCacheLoadedAt = 0;
let clientsRequest = null;
const CLIENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const clientsById = new Map();

function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function clean(value) { return String(value || "").trim(); }
function emailKey(value) { return clean(value).toLowerCase(); }
function phoneKey(value) { return clean(value).replace(/\D/g, ""); }
function dniKey(value) { return clean(value).toUpperCase().replace(/[\s.-]/g, ""); }
const CLIENT_DISCOVERY_CHANNELS = new Set(["FACEBOOK", "INSTAGRAM", "WEB", "GOOGLE", "FRIENDS", "OTHER"]);

export function invalidateClientsCache() {
  clientsCache = null;
  clientsCacheComplete = false;
  clientsCacheLoadedAt = 0;
  clientsById.clear();
}
window.addEventListener("travelflow:clients-updated", invalidateClientsCache);

export async function getClients({ force = false } = {}) {
  const cacheIsFresh = clientsCache && Date.now() - clientsCacheLoadedAt < CLIENTS_CACHE_TTL_MS;
  if (!force && cacheIsFresh) return clientsCache;
  if (clientsRequest) return clientsRequest;

  clientsRequest = getDocs(collection(db, "clients"))
    .then((snapshot) => {
      clientsCache = snapshot.docs.map(mapDocument).filter((client) => client.active !== false)
        .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ca"));
      clientsById.clear();
      clientsCache.forEach((client) => clientsById.set(client.id, client));
      clientsCacheComplete = true;
      clientsCacheLoadedAt = Date.now();
      return clientsCache;
    })
    .finally(() => { clientsRequest = null; });

  return clientsRequest;
}

export async function getClient(clientId) {
  if (clientsById.has(clientId)) return clientsById.get(clientId);
  const snapshot = await getDoc(doc(db, "clients", clientId));
  if (!snapshot.exists()) return null;
  const client = mapDocument(snapshot);
  clientsById.set(clientId, client);
  return client;
}

async function findOne(field, value) {
  if (!value) return null;
  const snapshot = await getDocs(query(collection(db, "clients"), where(field, "==", value), limit(1)));
  return snapshot.empty ? null : mapDocument(snapshot.docs[0]);
}

export async function findClientMatch({ dni = "", email = "", phone = "" }) {
  return (await findOne("dniNormalized", dniKey(dni)))
    || (await findOne("emailNormalized", emailKey(email)))
    || (await findOne("phoneNormalized", phoneKey(phone)));
}

export async function ensureClientForBooking(lead, booking, batch = null) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const linked = lead.clientId ? await getClient(lead.clientId) : null;
  const possibleMatch = linked ? null : await findClientMatch(lead);
  const rejectedMatches = new Set(lead.rejectedClientMatchIds || []);
  if (possibleMatch && !rejectedMatches.has(possibleMatch.id)) throw new Error("BOOKING_CLIENT_REVIEW_REQUIRED");
  const existing = linked;
  const clientRef = existing ? doc(db, "clients", existing.id) : doc(collection(db, "clients"));
  const reservation = {
    ...(existing?.reservations?.[booking.tripId] || {}),
    tripId: booking.tripId,
    tripName: booking.tripName,
    leadId: lead.id,
    status: "CONFIRMED",
    bookedAt: booking.bookedAt || serverTimestamp(),
    priceConcepts: booking.priceConcepts,
    total: booking.total,
    pricingMode: booking.pricingMode || "TRIP",
    dui: Boolean(booking.dui),
    updatedAt: serverTimestamp()
  };
  const base = {
    fullName: clean(lead.fullName),
    fullNameSearch: clean(lead.fullName).toLowerCase(),
    phone: clean(lead.phone), phoneNormalized: phoneKey(lead.phone),
    email: emailKey(lead.email), emailNormalized: emailKey(lead.email),
    leadIds: [...new Set([...(existing?.leadIds || []), lead.id])],
    reservations: { ...(existing?.reservations || {}), [booking.tripId]: reservation },
    active: true, updatedBy: user.uid, updatedAt: serverTimestamp()
  };
  if (!existing) Object.assign(base, { address: "", postalCode: "", city: "", province: "", birthDate: "", dni: "", dniNormalized: "", dniExpiry: "", passport: "", passportExpiry: "", discoveryChannel: "", discoveryChannelOther: "", superTraveler: false, createdBy: user.uid, createdAt: serverTimestamp() });
  if (batch) batch.set(clientRef, base, { merge: true });
  else await setDoc(clientRef, base, { merge: true });
  if (!batch) invalidateClientsCache();
  return clientRef.id;
}

export async function cancelClientReservation(clientId, tripId, input = {}) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const client = await getClient(clientId);
  const current = client?.reservations?.[tripId];
  if (!client || !current?.leadId || current.status === "CANCELLED") throw new Error("RESERVATION_NOT_FOUND");

  const leadRef = doc(db, "leads", current.leadId);
  const leadSnapshot = await getDoc(leadRef);
  if (!leadSnapshot.exists()) throw new Error("RESERVATION_LEAD_NOT_FOUND");
  const lead = leadSnapshot.data();
  const tripInterests = { ...(lead.tripInterests || {}) };
  const cancelledAt = input.cancelledOn
    ? Timestamp.fromDate(new Date(`${input.cancelledOn}T12:00:00`))
    : serverTimestamp();
  const refundedAmount = Math.max(0, Number(input.refundedAmount) || 0);
  const cancellationFee = Math.max(0, Number(input.cancellationFee) || 0);
  const totalPaid = Number(current.totalPaid) || (current.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  if (!clean(input.reason)) throw new Error("CANCELLATION_REASON_REQUIRED");
  if (refundedAmount > totalPaid) throw new Error("CANCELLATION_REFUND_OVER_PAID");
  const keepInterest = Boolean(input.keepInterest);
  const cancellation = {
    cancelledAt,
    reason: clean(input.reason),
    refundedAmount,
    cancellationFee,
    notes: clean(input.notes),
    cancelledBy: user.uid
  };
  const reservation = { ...current, status: "CANCELLED", cancellation, updatedAt: serverTimestamp() };
  tripInterests[tripId] = {
    ...(tripInterests[tripId] || {}),
    status: keepInterest ? "FOLLOW_UP" : "CANCELLED",
    cancellation
  };
  const remainingBookingId = (lead.tripIds || []).find((id) => id !== tripId && tripInterests[id]?.status === "BOOKING_CONFIRMED") || "";
  const remaining = remainingBookingId ? tripInterests[remainingBookingId] : null;
  const hasActiveInterest = (lead.tripIds || []).some((id) => !["BOOKING_CONFIRMED", "CANCELLED", "LOST"].includes(tripInterests[id]?.status || "NEW"));
  const batch = writeBatch(db);
  batch.update(doc(db, "clients", clientId), {
    reservations: { ...(client.reservations || {}), [tripId]: reservation },
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  batch.update(leadRef, {
    tripInterests,
    status: remaining ? "BOOKING_CONFIRMED" : (hasActiveInterest ? "FOLLOW_UP" : "CANCELLED"),
    bookingTripId: remainingBookingId,
    bookingTripNameSnapshot: remaining?.tripName || "",
    bookingDui: remaining ? Boolean(remaining.dui) : false,
    bookedAt: remaining?.bookedAt || null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "activities")), {
    leadId: current.leadId,
    tripId,
    type: "BOOKING_CANCELLED",
    description: `Reserva cancel·lada des de la fitxa de clienta · ${current.tripName || "Viatge"}.`,
    cancellation,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  await batch.commit();
  invalidateClientsCache();
  window.dispatchEvent(new CustomEvent("travelflow:leads-updated"));
  return reservation;
}

export async function updateClient(clientId, input) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const discoveryChannel = CLIENT_DISCOVERY_CHANNELS.has(clean(input.discoveryChannel)) ? clean(input.discoveryChannel) : "";
  const payload = {
    fullName: clean(input.fullName), fullNameSearch: clean(input.fullName).toLowerCase(),
    address: clean(input.address), postalCode: clean(input.postalCode), city: clean(input.city), province: clean(input.province),
    phone: clean(input.phone), phoneNormalized: phoneKey(input.phone),
    email: emailKey(input.email), emailNormalized: emailKey(input.email),
    birthDate: clean(input.birthDate), dni: clean(input.dni).toUpperCase(), dniNormalized: dniKey(input.dni), dniExpiry: clean(input.dniExpiry),
    passport: clean(input.passport).toUpperCase(), passportExpiry: clean(input.passportExpiry),
    discoveryChannel, discoveryChannelOther: discoveryChannel === "OTHER" ? clean(input.discoveryChannelOther).slice(0, 120) : "",
    superTraveler: Boolean(input.superTraveler), updatedBy: user.uid, updatedAt: serverTimestamp()
  };
  if (!payload.fullName) throw new Error("CLIENT_NAME_REQUIRED");
  const duplicate = clientsCacheComplete
    ? clientsCache.find((client) => client.id !== clientId && (
      (payload.dniNormalized && client.dniNormalized === payload.dniNormalized)
      || (payload.emailNormalized && client.emailNormalized === payload.emailNormalized)
      || (payload.phoneNormalized && client.phoneNormalized === payload.phoneNormalized)
    ))
    : await findClientMatch(payload);
  if (duplicate && duplicate.id !== clientId) throw new Error("CLIENT_DUPLICATE");
  await updateDoc(doc(db, "clients", clientId), payload);
  const current = clientsById.get(clientId) || { id: clientId };
  const saved = { ...current, ...payload };
  clientsById.set(clientId, saved);
  if (clientsCache) {
    clientsCache = clientsCache.map((client) => client.id === clientId ? saved : client)
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ca"));
  }
  return saved;
}

export async function createClientReservation(clientId, trip, { historical = true, bookedOn = "" } = {}) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!trip?.id || !trip?.name) throw new Error("RESERVATION_TRIP_REQUIRED");
  const client = await getClient(clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  if (client.reservations?.[trip.id]) throw new Error("RESERVATION_ALREADY_EXISTS");

  const leadRef = doc(collection(db, "leads"));
  if (historical && !bookedOn) throw new Error("RESERVATION_DATE_REQUIRED");
  const bookedAt = historical ? Timestamp.fromDate(new Date(`${bookedOn}T12:00:00`)) : serverTimestamp();
  const priceConcepts = normalizeReservationConcepts((trip.priceConcepts || []).filter((concept) => concept.application === "REQUIRED"));
  const total = Math.round(priceConcepts.reduce((sum, concept) => concept.application === "INFORMATIONAL" ? sum : sum + concept.amount, 0) * 100) / 100;
  const reservation = {
    tripId: trip.id, tripName: trip.name, leadId: leadRef.id, status: "CONFIRMED", bookedAt,
    priceConcepts, total, pricingMode: "TRIP", dui: false, roomType: "SHARED", roommate: "",
    departureCity: "", notes: "", payments: [], totalPaid: 0, pendingAmount: Math.max(0, total), updatedAt: bookedAt
  };
  const tripInterest = {
    tripId: trip.id, tripName: trip.name, status: "BOOKING_CONFIRMED", bookedAt, dui: false,
    roomType: "SHARED", roommate: "", departureCity: "", bookingNotes: "", pricingMode: "TRIP",
    bookingPriceConcepts: priceConcepts, bookingTotal: total, payments: [], totalPaid: 0
  };
  const nameParts = clean(client.fullName).split(/\s+/);
  const firstName = nameParts.shift() || clean(client.fullName);
  const lastName = nameParts.join(" ");
  const lead = {
    firstName, lastName, fullName: clean(client.fullName), fullNameSearch: clean(client.fullName).toLowerCase(),
    phone: clean(client.phone), phoneNormalized: phoneKey(client.phone), email: emailKey(client.email),
    instagramHandle: "", facebookUrl: "", channel: "OTHER", source: "RETURNING_CUSTOMER",
    entryPreset: "", tripIds: [trip.id], tripLabels: [trip.name], tripInterests: { [trip.id]: tripInterest },
    interest: trip.name, notes: "Reserva creada des de la fitxa de clienta.", status: "BOOKING_CONFIRMED",
    priority: "NORMAL", temperature: "WARM", ownerId: user.uid, createdBy: user.uid, updatedBy: user.uid,
    active: true, noResponseCount: 0, nextActionTitle: "", nextActionAt: null,
    bookingTripId: trip.id, bookingTripNameSnapshot: trip.name, bookingDui: false, bookedAt,
    clientId, analyticsIncluded: !historical, createdAt: bookedAt, updatedAt: serverTimestamp()
  };

  const batch = writeBatch(db);
  batch.set(leadRef, lead);
  batch.update(doc(db, "clients", clientId), {
    leadIds: [...new Set([...(client.leadIds || []), leadRef.id])],
    reservations: { ...(client.reservations || {}), [trip.id]: reservation },
    updatedBy: user.uid, updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "activities")), {
    leadId: leadRef.id, tripId: trip.id, type: "BOOKING_CONFIRMED",
    description: `Reserva creada des de la fitxa de clienta · ${trip.name} · Total ${total.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}.`,
    createdBy: user.uid, createdAt: serverTimestamp()
  });
  await batch.commit();
  invalidateClientsCache();
  window.dispatchEvent(new CustomEvent("travelflow:leads-updated"));
  return reservation;
}

function normalizeReservationConcepts(concepts = []) {
  if (!Array.isArray(concepts) || concepts.length > 100) throw new Error("RESERVATION_INVALID");
  const ids = new Set();
  return concepts.map((concept, index) => {
    const id = clean(concept.id); const name = clean(concept.name); const amount = Number(concept.amount);
    const application = clean(concept.application || "OPTIONAL"); const priceStatus = clean(concept.priceStatus || "FINAL");
    const minimumAmount = id === "loyalty-discount" ? -1000000 : 0;
    if (!id || ids.has(id) || !name || !Number.isFinite(amount) || amount < minimumAmount || amount > 1000000) throw new Error("RESERVATION_INVALID");
    if (!["REQUIRED", "OPTIONAL", "INFORMATIONAL"].includes(application) || !["FINAL", "ESTIMATED"].includes(priceStatus)) throw new Error("RESERVATION_INVALID");
    ids.add(id);
    return { id, name, amount: Math.round(amount * 100) / 100, application, priceStatus, order: index };
  });
}

function normalizePayments(payments = []) {
  if (!Array.isArray(payments) || payments.length > 100) throw new Error("PAYMENTS_INVALID");
  const ids = new Set();
  return payments.map((payment) => {
    const id = clean(payment.id); const amount = Number(payment.amount); const paidAt = clean(payment.paidAt);
    const method = clean(payment.method || "TRANSFER_DEPOSIT"); const reference = clean(payment.reference).slice(0, 160);
    if (!id || ids.has(id) || !paidAt || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new Error("PAYMENTS_INVALID");
    if (![...Object.keys(PAYMENT_METHODS), ...Object.keys(LEGACY_PAYMENT_METHODS)].includes(method)) throw new Error("PAYMENTS_INVALID");
    ids.add(id);
    return { id, amount: Math.round(amount * 100) / 100, paidAt, method, reference };
  });
}

export async function updateClientReservation(clientId, tripId, input) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const client = await getClient(clientId);
  const current = client?.reservations?.[tripId];
  if (!client || !current?.leadId) throw new Error("RESERVATION_NOT_FOUND");

  const pricingMode = input.pricingMode === "TRIP" ? "TRIP" : "CUSTOM";
  let conceptsInput = input.priceConcepts;
  if (pricingMode === "TRIP") {
    const tripSnapshot = await getDoc(doc(db, "trips", tripId));
    if (!tripSnapshot.exists()) throw new Error("RESERVATION_TRIP_NOT_FOUND");
    const selectedIds = new Set((input.priceConcepts || []).map((concept) => clean(concept.id)));
    conceptsInput = (tripSnapshot.data().priceConcepts || []).filter((concept) => concept.application === "REQUIRED" || selectedIds.has(clean(concept.id)));
  }
  const priceConcepts = normalizeReservationConcepts(conceptsInput);
  const total = Math.round(priceConcepts.reduce((sum, concept) => concept.application === "INFORMATIONAL" ? sum : sum + concept.amount, 0) * 100) / 100;
  const payments = normalizePayments(input.payments);
  const totalPaid = Math.round(payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
  if (totalPaid > total) throw new Error("PAYMENTS_OVER_TOTAL");

  const leadRef = doc(db, "leads", current.leadId);
  const leadSnapshot = await getDoc(leadRef);
  if (!leadSnapshot.exists()) throw new Error("RESERVATION_LEAD_NOT_FOUND");
  const lead = leadSnapshot.data();
  const tripInterests = { ...(lead.tripInterests || {}) };
  const leadReservation = tripInterests[tripId] || {};
  const reservation = {
    ...current,
    status: "CONFIRMED",
    dui: Boolean(input.dui),
    roomType: input.dui ? "DUI" : "SHARED",
    roommate: clean(input.roommate),
    departureCity: clean(input.departureCity),
    notes: clean(input.notes),
    pricingMode,
    priceConcepts,
    total,
    payments,
    totalPaid,
    pendingAmount: Math.max(0, Math.round((total - totalPaid) * 100) / 100),
    updatedAt: new Date().toISOString()
  };
  tripInterests[tripId] = {
    ...leadReservation,
    dui: reservation.dui,
    roomType: reservation.roomType,
    roommate: reservation.roommate,
    departureCity: reservation.departureCity,
    bookingNotes: reservation.notes,
    pricingMode,
    bookingPriceConcepts: priceConcepts,
    bookingTotal: total,
    payments,
    totalPaid
  };

  const batch = writeBatch(db);
  batch.update(doc(db, "clients", clientId), {
    reservations: { ...(client.reservations || {}), [tripId]: reservation },
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  });
  batch.update(leadRef, { tripInterests, updatedBy: user.uid, updatedAt: serverTimestamp() });
  batch.set(doc(collection(db, "activities")), {
    leadId: current.leadId,
    tripId,
    type: "NOTE",
    description: `Reserva actualitzada des de la fitxa de clienta · Total ${total.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })} · Pagat ${totalPaid.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}.`,
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  await batch.commit();
  invalidateClientsCache();
  return reservation;
}
