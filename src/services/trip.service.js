import {
  addDoc,
  collection,
  doc,
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
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const reference = await addDoc(collection(db, "trips"), trip);
  invalidateTripsCache();
  return { id: reference.id, ...trip };
}

export async function updateTripDates(tripId, { startDate, endDate, closingDate = "", imageUrl = "" }) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!startDate) throw new Error("TRIP_START_REQUIRED");
  if (!endDate) throw new Error("TRIP_END_REQUIRED");
  if (endDate < startDate) throw new Error("TRIP_DATE_ORDER");
  if (closingDate && closingDate > startDate) throw new Error("TRIP_CLOSING_ORDER");
  await updateDoc(doc(db, "trips", tripId), {
    startDate,
    endDate,
    closingDate,
    ...(imageUrl?.trim() ? { imageUrl: imageUrl.trim() } : {}),
    year: new Date(`${startDate}T12:00:00`).getFullYear(),
    datesPending: false,
    updatedBy: currentUser.uid,
    updatedAt: serverTimestamp()
  });
  invalidateTripsCache();

  const updatedTrips = await getTrips({ force: true });
  const updatedTrip = updatedTrips.find((trip) => trip.id === tripId);
  const activated = await activateTripInformationFollowUps({
    tripId,
    tripName: updatedTrip?.name || "viatge"
  });
  window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  return { activated };
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
    "permission-denied": "No tens permís per gestionar aquestes etiquetes de viatge."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació amb el viatge.";
}
