import {
  collection, doc, getDoc, getDocs, limit, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

let clientsCache = null;
let clientsCacheComplete = false;
const clientsById = new Map();

function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function clean(value) { return String(value || "").trim(); }
function emailKey(value) { return clean(value).toLowerCase(); }
function phoneKey(value) { return clean(value).replace(/\D/g, ""); }
function dniKey(value) { return clean(value).toUpperCase().replace(/[\s.-]/g, ""); }

export function invalidateClientsCache() { clientsCache = null; clientsCacheComplete = false; clientsById.clear(); }
window.addEventListener("travelflow:clients-updated", invalidateClientsCache);

export async function getClients({ force = false } = {}) {
  if (!force && clientsCache) return clientsCache;
  const snapshot = await getDocs(collection(db, "clients"));
  clientsCache = snapshot.docs.map(mapDocument).filter((client) => client.active !== false)
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ca"));
  clientsById.clear();
  clientsCache.forEach((client) => clientsById.set(client.id, client));
  clientsCacheComplete = true;
  return clientsCache;
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

export async function ensureClientForBooking(lead, booking) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const existing = await findClientMatch(lead);
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
  if (!existing) Object.assign(base, { address: "", postalCode: "", city: "", province: "", birthDate: "", dni: "", dniNormalized: "", dniExpiry: "", passport: "", passportExpiry: "", superTraveler: false, createdBy: user.uid, createdAt: serverTimestamp() });
  await setDoc(clientRef, base, { merge: true });
  invalidateClientsCache();
  return clientRef.id;
}

export async function updateClient(clientId, input) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const payload = {
    fullName: clean(input.fullName), fullNameSearch: clean(input.fullName).toLowerCase(),
    address: clean(input.address), postalCode: clean(input.postalCode), city: clean(input.city), province: clean(input.province),
    phone: clean(input.phone), phoneNormalized: phoneKey(input.phone),
    email: emailKey(input.email), emailNormalized: emailKey(input.email),
    birthDate: clean(input.birthDate), dni: clean(input.dni).toUpperCase(), dniNormalized: dniKey(input.dni), dniExpiry: clean(input.dniExpiry),
    passport: clean(input.passport).toUpperCase(), passportExpiry: clean(input.passportExpiry),
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
    const method = clean(payment.method || "TRANSFER"); const reference = clean(payment.reference).slice(0, 160);
    if (!id || ids.has(id) || !paidAt || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new Error("PAYMENTS_INVALID");
    if (!["TRANSFER", "CARD", "CASH", "OTHER"].includes(method)) throw new Error("PAYMENTS_INVALID");
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
