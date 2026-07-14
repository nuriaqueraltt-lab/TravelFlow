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
import {
  ACTIVITY_TYPES,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES
} from "../config/app.constants.js";

function normalizePhone(phone = "") {
  return phone.replace(/\D/g, "");
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function mapDocument(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

export async function createLead(input) {
  const currentUser = getCurrentUser();

  if (!currentUser) {
    throw new Error("AUTH_REQUIRED");
  }

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim() ?? "";

  if (!firstName) {
    throw new Error("FIRST_NAME_REQUIRED");
  }

  if (!input.channel || !input.source) {
    throw new Error("ENTRY_SOURCE_REQUIRED");
  }

  const leadRef = doc(collection(db, "leads"));
  const activityRef = doc(collection(db, "activities"));
  const batch = writeBatch(db);

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const email = normalizeEmail(input.email);
  const phone = input.phone?.trim() ?? "";
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
    interest: input.interest?.trim() ?? "",
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

  return {
    id: leadRef.id,
    fullName,
    channel: input.channel,
    source: input.source
  };
}

export async function getLeads() {
  const snapshot = await getDocs(query(collection(db, "leads"), orderBy("createdAt", "desc")));
  return snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
}

export async function getLeadById(leadId) {
  const snapshot = await getDoc(doc(db, "leads", leadId));
  return snapshot.exists() ? mapDocument(snapshot) : null;
}

export async function getLeadActivities(leadId) {
  const activitiesQuery = query(
    collection(db, "activities"),
    where("leadId", "==", leadId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(activitiesQuery);
  return snapshot.docs.map(mapDocument);
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
