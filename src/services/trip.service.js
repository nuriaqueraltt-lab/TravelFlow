import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { activateTripInformationFollowUps } from "./trip-interest-followup.service.js";
import { INITIAL_TRIP_TAGS } from "../data/trip-tags.seed.js";

const CACHE_TTL = 5 * 60 * 1000;
const SEED_SESSION_KEY = "travelflow:trip-catalogue-checked";
let tripsCache = null;
let tripsCacheAt = 0;
let tripsRequest = null;
export const TRIP_PROCESS_STEPS = [
  ["published", "Publicat"], ["sentToInterested", "Enviat a interessades"], ["sentToInfoGroup", "Enviat al grup informatiu"],
  ["minimumTravelersConfirmed", "Mínim de viatgeres confirmades"], ["secondPaymentRequested", "Demanat el segon pagament"],
  ["travelersGroupCreated", "Grup de viatgeres creat"], ["allSecondPaymentsPaid", "Totes han pagat el segon pagament"],
  ["flightsPurchased", "Vols comprats"], ["insuranceIssued", "Assegurança feta"], ["contractsSent", "Contractes enviats"],
  ["finalPaymentConfirmed", "Últim pagament confirmat"], ["travelerInvoicesCreated", "Factures de viatgeres fetes"],
  ["supplierInvoicesCorrect", "Factures de proveïdors correctes"]
];
export const DEFAULT_TRIP_PRICE_CONCEPTS = [
  { id: "land-services", name: "Serveis terrestres", amount: 0, application: "REQUIRED", priceStatus: "FINAL" },
  { id: "travel-insurance", name: "Assegurança Intermundial", amount: 0, application: "REQUIRED", priceStatus: "FINAL" },
  { id: "insurance-over-70", name: "Suplement assegurança 70 anys o més", amount: 0, application: "OPTIONAL", priceStatus: "FINAL" },
  { id: "international-flights", name: "Vols internacionals", amount: 0, application: "OPTIONAL", priceStatus: "ESTIMATED" },
  { id: "domestic-flights", name: "Vols interns", amount: 0, application: "OPTIONAL", priceStatus: "ESTIMATED" },
  { id: "shared-double-room", name: "Habitació doble compartida", amount: 0, application: "OPTIONAL", priceStatus: "FINAL" },
  { id: "single-room-supplement", name: "Suplement habitació individual", amount: 0, application: "OPTIONAL", priceStatus: "FINAL" },
  { id: "loyalty-discount", name: "Descompte fidelitat", amount: 0, application: "OPTIONAL", priceStatus: "FINAL" }
];
const TRIP_GROUP_STATUSES = ["AVAILABLE", "CONFIRMED", "FULL"];
const TRIP_PRICE_APPLICATIONS = ["REQUIRED", "OPTIONAL", "INFORMATIONAL"];
const TRIP_PRICE_STATUSES = ["FINAL", "ESTIMATED"];

function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function slugify(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}
function invalidateTripsCache() { tripsCache = null; tripsCacheAt = 0; }
function imageForTrip(name = "") {
  const key = name.toLowerCase();
  if (key.includes("múnich") || key.includes("munich") || key.includes("salzburgo")) return "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("noruega")) return "https://images.unsplash.com/photo-1520769669658-f07657f5a307?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("alsacia")) return "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("edimburgo") || key.includes("escòcia") || key.includes("escocia")) return "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("londres")) return "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("nápoles") || key.includes("napols") || key.includes("amalfitana")) return "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("nova york") || key.includes("new york")) return "https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=1200&q=80";
  return "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80";
}

export async function getTrips({ force = false } = {}) {
  if (!force && tripsCache && Date.now() - tripsCacheAt < CACHE_TTL) return tripsCache;
  if (!force && tripsRequest) return tripsRequest;
  tripsRequest = getDocs(query(collection(db, "trips"), orderBy("name", "asc")))
    .then((snapshot) => {
      tripsCache = snapshot.docs.map(mapDocument).filter((trip) => trip.active !== false);
      tripsCacheAt = Date.now();
      return tripsCache;
    })
    .finally(() => { tripsRequest = null; });
  return tripsRequest;
}

export async function getTripById(tripId) {
  if (!tripId) throw new Error("TRIP_REQUIRED");

  const cachedTrip = tripsCache?.find((trip) => trip.id === tripId);
  if (cachedTrip) return cachedTrip;

  const snapshot = await getDoc(doc(db, "trips", tripId));
  if (!snapshot.exists()) throw new Error("TRIP_REQUIRED");

  const trip = mapDocument(snapshot);
  if (trip.active === false) throw new Error("TRIP_REQUIRED");
  return trip;
}

export async function seedInitialTrips() {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (sessionStorage.getItem(SEED_SESSION_KEY) === "done") return 0;

  const currentTrips = await getTrips();
  const currentNames = new Set(currentTrips.map((trip) => trip.name));
  const missingTrips = INITIAL_TRIP_TAGS.filter((trip) => !currentNames.has(trip.name));
  sessionStorage.setItem(SEED_SESSION_KEY, "done");
  if (!missingTrips.length) return 0;

  const batch = writeBatch(db);
  const now = serverTimestamp();
  missingTrips.forEach((trip) => {
    const reference = doc(db, "trips", slugify(trip.name));
    batch.set(reference, {
      name: trip.name,
      nameSearch: trip.name.toLowerCase(),
      startDate: trip.startDate,
      endDate: trip.endDate,
      closingDate: trip.closingDate || "",
      imageUrl: trip.imageUrl || imageForTrip(trip.name),
      year: Number(trip.name.slice(0, 4)) || null,
      datesPending: !trip.startDate || !trip.endDate,
      active: true,
      catalogueSeed: true,
      createdBy: currentUser.uid,
      updatedBy: currentUser.uid,
      createdAt: now,
      updatedAt: now
    }, { merge: true });
  });
  await batch.commit();
  invalidateTripsCache();
  return missingTrips.length;
}

export async function createTripTag({ name, startDate = "", endDate = "", closingDate = "", imageUrl = "" }) {
  const currentUser = getCurrentUser();
  const cleanName = name?.trim();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!cleanName) throw new Error("TRIP_NAME_REQUIRED");
  if ((startDate && !endDate) || (!startDate && endDate)) throw new Error("TRIP_DATES_INCOMPLETE");
  if (startDate && endDate && endDate < startDate) throw new Error("TRIP_DATE_ORDER");
  if (closingDate && !startDate) throw new Error("TRIP_CLOSING_REQUIRES_START");
  if (closingDate && closingDate > startDate) throw new Error("TRIP_CLOSING_ORDER");

  const datesPending = !startDate || !endDate;
  const inferredYear = Number(cleanName.slice(0, 4)) || (startDate ? new Date(`${startDate}T12:00:00`).getFullYear() : null);
  const trip = {
    name: cleanName,
    nameSearch: cleanName.toLowerCase(),
    startDate,
    endDate,
    closingDate,
    imageUrl: imageUrl?.trim() || imageForTrip(cleanName),
    year: inferredYear,
    datesPending,
    active: true,
    priceConcepts: DEFAULT_TRIP_PRICE_CONCEPTS.map((concept) => ({ ...concept })),
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, "trips"), trip);
  invalidateTripsCache();
  return { id: reference.id, ...trip };
}

export async function updateTripPricing(tripId, priceConcepts = []) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!tripId) throw new Error("TRIP_REQUIRED");
  if (!Array.isArray(priceConcepts) || priceConcepts.length > 100) throw new Error("TRIP_PRICING_INVALID");

  const ids = new Set();
  const normalizedConcepts = priceConcepts.map((concept, index) => {
    const id = String(concept.id || "").trim();
    const name = String(concept.name || "").trim();
    const amount = Number(concept.amount);
    const application = String(concept.application || "OPTIONAL");
    const priceStatus = String(concept.priceStatus || "FINAL");
    const minimumAmount = id === "loyalty-discount" ? -1000000 : 0;
    if (!id || ids.has(id) || !name || name.length > 120 || !Number.isFinite(amount) || amount < minimumAmount || amount > 1000000) {
      throw new Error("TRIP_PRICING_INVALID");
    }
    if (!TRIP_PRICE_APPLICATIONS.includes(application) || !TRIP_PRICE_STATUSES.includes(priceStatus)) {
      throw new Error("TRIP_PRICING_INVALID");
    }
    ids.add(id);
    return { id, name, amount: Math.round(amount * 100) / 100, application, priceStatus, order: index };
  });

  const update = {
    priceConcepts: normalizedConcepts,
    updatedBy: currentUser.uid,
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "trips", tripId), update);
  await syncLinkedReservationPrices(tripId, normalizedConcepts, currentUser.uid);
  window.dispatchEvent(new CustomEvent("travelflow:clients-updated"));
  if (tripsCache) {
    tripsCache = tripsCache.map((trip) => trip.id === tripId ? { ...trip, priceConcepts: normalizedConcepts } : trip);
    tripsCacheAt = Date.now();
  }
  return { priceConcepts: normalizedConcepts };
}

function linkedConceptsForReservation(reservation, catalogue) {
  const selectedIds = new Set((reservation.priceConcepts || []).map((concept) => String(concept.id || "")));
  return catalogue
    .filter((concept) => concept.application === "REQUIRED" || selectedIds.has(concept.id))
    .map((concept, order) => ({ ...concept, order }));
}

function reservationTotal(concepts) {
  return Math.round(concepts.reduce((sum, concept) => concept.application === "INFORMATIONAL" ? sum : sum + concept.amount, 0) * 100) / 100;
}

async function syncLinkedReservationPrices(tripId, catalogue, userId) {
  const [clientsSnapshot, leadsSnapshot] = await Promise.all([
    getDocs(collection(db, "clients")),
    getDocs(collection(db, "leads"))
  ]);
  const leadChanges = new Map();
  const writes = [];

  clientsSnapshot.docs.forEach((clientDocument) => {
    const client = clientDocument.data();
    const current = client.reservations?.[tripId];
    if (!current || current.pricingMode !== "TRIP") return;
    const priceConcepts = linkedConceptsForReservation(current, catalogue);
    const total = reservationTotal(priceConcepts);
    const totalPaid = Number(current.totalPaid) || (current.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const reservation = { ...current, priceConcepts, total, pendingAmount: Math.max(0, Math.round((total - totalPaid) * 100) / 100), updatedAt: new Date().toISOString() };
    writes.push({ ref: clientDocument.ref, data: { reservations: { ...(client.reservations || {}), [tripId]: reservation }, updatedBy: userId, updatedAt: serverTimestamp() } });

    if (current.leadId) {
      const leadDocument = leadsSnapshot.docs.find((item) => item.id === current.leadId);
      if (leadDocument) {
        const base = leadChanges.get(current.leadId) || leadDocument.data();
        const tripInterests = { ...(base.tripInterests || {}) };
        tripInterests[tripId] = { ...(tripInterests[tripId] || {}), pricingMode: "TRIP", bookingPriceConcepts: priceConcepts, bookingTotal: total, totalPaid };
        leadChanges.set(current.leadId, { ...base, tripInterests });
      }
    }
  });

  leadChanges.forEach((lead, leadId) => writes.push({ ref: doc(db, "leads", leadId), data: { tripInterests: lead.tripInterests, updatedBy: userId, updatedAt: serverTimestamp() } }));
  for (let index = 0; index < writes.length; index += 400) {
    const batch = writeBatch(db);
    writes.slice(index, index + 400).forEach((write) => batch.update(write.ref, write.data));
    await batch.commit();
  }
}

export async function updateTripDates(tripId, { startDate, endDate, closingDate = "", imageUrl = "" }) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!startDate) throw new Error("TRIP_START_REQUIRED");
  if (!endDate) throw new Error("TRIP_END_REQUIRED");
  if (endDate < startDate) throw new Error("TRIP_DATE_ORDER");
  if (closingDate && closingDate > startDate) throw new Error("TRIP_CLOSING_ORDER");
  const cachedTrip = tripsCache?.find((trip) => trip.id === tripId);
  const update = {
    startDate,
    endDate,
    closingDate,
    ...(imageUrl?.trim() ? { imageUrl: imageUrl.trim() } : {}),
    year: new Date(`${startDate}T12:00:00`).getFullYear(),
    datesPending: false,
    updatedBy: currentUser.uid,
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "trips", tripId), update);
  if (tripsCache) {
    tripsCache = tripsCache.map((trip) => trip.id === tripId ? { ...trip, ...update } : trip);
    tripsCacheAt = Date.now();
  }

  const activated = await activateTripInformationFollowUps({
    tripId,
    tripName: cachedTrip?.name || "viatge"
  });
  window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  return { activated };
}

export async function updateTripOperations(tripId, { tourLeaderName = "", tourLeaderDui = false, groupStatus = "AVAILABLE", processChecklist = {} }) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!tripId) throw new Error("TRIP_REQUIRED");
  if (!TRIP_GROUP_STATUSES.includes(groupStatus)) throw new Error("TRIP_GROUP_STATUS_INVALID");
  const checklist = Object.fromEntries(TRIP_PROCESS_STEPS.map(([key]) => [key, processChecklist[key] === true]));
  const update = {
    tourLeaderName: tourLeaderName.trim(),
    tourLeaderDui: Boolean(tourLeaderDui),
    groupStatus,
    processChecklist: checklist,
    updatedBy: currentUser.uid,
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "trips", tripId), update);
  if (tripsCache) {
    tripsCache = tripsCache.map((trip) => trip.id === tripId ? { ...trip, tourLeaderName: update.tourLeaderName, tourLeaderDui: update.tourLeaderDui, groupStatus, processChecklist: checklist } : trip);
    tripsCacheAt = Date.now();
  }
  return { tourLeaderName: update.tourLeaderName, tourLeaderDui: update.tourLeaderDui, groupStatus, processChecklist: checklist };
}

export async function updateTripSupplierPayments(tripId, supplierPayments = []) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!tripId) throw new Error("TRIP_REQUIRED");
  if (!Array.isArray(supplierPayments) || supplierPayments.length > 200) throw new Error("SUPPLIER_PAYMENTS_INVALID");

  const ids = new Set();
  const paymentMethods = new Set(["TRANSFER", "CARD", "CASH", "DIRECT_DEBIT", "OTHER"]);
  const normalizedPayments = supplierPayments.map((payment) => {
    const id = String(payment.id || "").trim();
    const supplierName = String(payment.supplierName || "").trim();
    const concept = String(payment.concept || "").trim();
    const paymentDate = String(payment.paymentDate || "").trim();
    const paymentMethod = String(payment.paymentMethod || "OTHER").trim();
    const reference = String(payment.reference || "").trim();
    const amount = Number(payment.amount);
    const parsedDate = new Date(`${paymentDate}T12:00:00`);
    if (!id || ids.has(id) || !supplierName || supplierName.length > 160 || !concept || concept.length > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(parsedDate.getTime()) || !paymentMethods.has(paymentMethod) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || reference.length > 180) {
      throw new Error("SUPPLIER_PAYMENTS_INVALID");
    }
    ids.add(id);
    return {
      id,
      supplierName,
      concept,
      paymentDate,
      amount: Math.round(amount * 100) / 100,
      paymentMethod,
      reference,
      createdAt: payment.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });

  const update = { supplierPayments: normalizedPayments, updatedBy: currentUser.uid, updatedAt: serverTimestamp() };
  await updateDoc(doc(db, "trips", tripId), update);
  if (tripsCache) {
    tripsCache = tripsCache.map((trip) => trip.id === tripId ? { ...trip, supplierPayments: normalizedPayments } : trip);
    tripsCacheAt = Date.now();
  }
  return { supplierPayments: normalizedPayments };
}

export function getTripErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    TRIP_NAME_REQUIRED: "Escriu el nom de l'etiqueta del viatge.",
    TRIP_START_REQUIRED: "Indica la data d'inici del viatge.",
    TRIP_END_REQUIRED: "Indica la data de finalització del viatge.",
    TRIP_DATES_INCOMPLETE: "Indica les dues dates o deixa-les totes dues pendents.",
    TRIP_CLOSING_REQUIRES_START: "Per indicar el tancament comercial, primer cal informar la data de sortida.",
    TRIP_DATE_ORDER: "La data de finalització no pot ser anterior a la d'inici.",
    TRIP_CLOSING_ORDER: "La data de tancament no pot ser posterior a la sortida.",
    TRIP_REQUIRED: "No s'ha pogut identificar el viatge.",
    TRIP_GROUP_STATUS_INVALID: "Selecciona un estat de grup vàlid.",
    TRIP_PRICING_INVALID: "Revisa els conceptes: cal indicar un nom i un import vàlid a cada línia.",
    SUPPLIER_PAYMENTS_INVALID: "Revisa el pagament: cal indicar proveïdor, concepte, data i un import superior a zero.",
    "permission-denied": "No tens permís per gestionar aquestes etiquetes de viatge."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació amb el viatge.";
}
