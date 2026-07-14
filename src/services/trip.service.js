import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getTrips() {
  const snapshot = await getDocs(query(collection(db, "trips"), orderBy("startDate", "asc")));
  return snapshot.docs.map(mapDocument).filter((trip) => trip.active !== false);
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
    active: true,
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const reference = await addDoc(collection(db, "trips"), trip);
  return { id: reference.id, ...trip };
}

export function getTripErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    TRIP_NAME_REQUIRED: "Escriu el nom de l'etiqueta del viatge.",
    TRIP_START_REQUIRED: "Indica la data d'inici del viatge.",
    TRIP_END_REQUIRED: "Indica la data de finalització del viatge.",
    TRIP_DATE_ORDER: "La data de finalització no pot ser anterior a la d'inici.",
    "permission-denied": "No tens permís per crear aquesta etiqueta de viatge."
  };

  return messages[error?.message] ?? messages[error?.code] ?? "No s'ha pogut crear l'etiqueta del viatge.";
}
