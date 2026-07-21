import {
  collection, doc, getDoc, getDocs, limit, query, serverTimestamp,
  setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

let clientsCache = null;

function mapDocument(snapshot) { return { id: snapshot.id, ...snapshot.data() }; }
function clean(value) { return String(value || "").trim(); }
function emailKey(value) { return clean(value).toLowerCase(); }
function phoneKey(value) { return clean(value).replace(/\D/g, ""); }
function dniKey(value) { return clean(value).toUpperCase().replace(/[\s.-]/g, ""); }

export function invalidateClientsCache() { clientsCache = null; }

export async function getClients({ force = false } = {}) {
  if (!force && clientsCache) return clientsCache;
  const snapshot = await getDocs(collection(db, "clients"));
  clientsCache = snapshot.docs.map(mapDocument).filter((client) => client.active !== false)
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ca"));
  return clientsCache;
}

export async function getClient(clientId) {
  const snapshot = await getDoc(doc(db, "clients", clientId));
  return snapshot.exists() ? mapDocument(snapshot) : null;
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
    tripId: booking.tripId,
    tripName: booking.tripName,
    leadId: lead.id,
    status: "CONFIRMED",
    bookedAt: booking.bookedAt || serverTimestamp(),
    priceConcepts: booking.priceConcepts,
    total: booking.total,
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
  const duplicate = await findClientMatch(payload);
  if (duplicate && duplicate.id !== clientId) throw new Error("CLIENT_DUPLICATE");
  await updateDoc(doc(db, "clients", clientId), payload);
  invalidateClientsCache();
}
