import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { INITIAL_TRIP_TAGS } from "../data/trip-tags.seed.js";

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function slugify(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export async function getTrips() {
  const snapshot = await getDocs(query(collection(db, "trips"), orderBy("name", "asc")));
  return snapshot.docs.map(mapDocument).filter((trip) => trip.active !== false);
}

export async function seedInitialTrips() {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");

  const batch = writeBatch(db);
  const now = serverTimestamp();

  INITIAL_TRIP_TAGS.forEach((trip) => {
    const reference = doc(db, "trips", slugify(trip.name));
    batch.set(
      reference,
      {
        name: trip.name,
        nameSearch: trip.name.toLowerCase(),
        startDate: trip.startDate,
        endDate: trip.endDate,
        year: Number(trip.name.slice(0, 4)) || null,
        datesPending: !trip.startDate || !trip.endDate,
        active: true,
        catalogueSeed: true,
        createdBy: currentUser.uid,
        updatedBy: currentUser.uid,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );
  });

  await batch.commit();
  return INITIAL_TRIP_TAGS.length;
}

export async function createTripTag({ name, startDate, endDate }) {
  const currentUser = getCurrentUser();
  const cleanName = name?.trim();

  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!cleanName) throw new Error("TRIP_NAME_REQUIRED");
  if (!startDate) throw new Error("TRIP_START_REQUIRED");
  if (!endDate) throw new Error("TRIP_END_REQUIRED");
  if (endDate < startDate) throw new Error("TRIP_DATE_ORDER");

  const trip = {
    name: cleanName,
    nameSearch: cleanName.toLowerCase(),
    startDate,
    endDate,
    year: Number(cleanName.slice(0, 4)) || new Date(startDate).getFullYear(),
    datesPending: false,
    active: true,
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const reference = await addDoc(collection(db, "trips"), trip);
  return { id: reference.id, ...trip };
}

export async function updateTripDates(tripId, { startDate, endDate }) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!startDate) throw new Error("TRIP_START_REQUIRED");
  if (!endDate) throw new Error("TRIP_END_REQUIRED");
  if (endDate < startDate) throw new Error("TRIP_DATE_ORDER");

  await updateDoc(doc(db, "trips", tripId), {
    startDate,
    endDate,
    datesPending: false,
    updatedBy: currentUser.uid,
    updatedAt: serverTimestamp()
  });
}

export function getTripErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    TRIP_NAME_REQUIRED: "Escriu el nom de l'etiqueta del viatge.",
    TRIP_START_REQUIRED: "Indica la data d'inici del viatge.",
    TRIP_END_REQUIRED: "Indica la data de finalització del viatge.",
    TRIP_DATE_ORDER: "La data de finalització no pot ser anterior a la d'inici.",
    "permission-denied": "No tens permís per gestionar aquestes etiquetes de viatge."
  };

  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut completar l'operació amb el viatge.";
}