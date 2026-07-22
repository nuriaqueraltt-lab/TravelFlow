import {
  collection, doc, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { previewClientImport } from "./client-import-preview.service.js";
import { invalidateClientsCache } from "./client.service.js";

function clean(value) { return String(value ?? "").trim().replace(/\s+/g, " "); }
function documentKey(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function emailKey(value) { return clean(value).toLowerCase(); }
function phoneKey(value) {
  return clean(value).split(/\s*(?:·|\/|\||;)\s*/, 1)[0].replace(/\D/g, "").replace(/^0034/, "34").replace(/^34(?=\d{9}$)/, "");
}

function importDocumentId(item) {
  const source = [item.line, item.fullName, item.dni, item.passport, item.email, item.phone].join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-2026-${(hash >>> 0).toString(36)}`;
}

function payloadFor(item, userId) {
  return {
    fullName: clean(item.fullName), fullNameSearch: clean(item.fullName).toLowerCase(),
    phone: clean(item.phone), phoneNormalized: phoneKey(item.phone),
    email: emailKey(item.email), emailNormalized: emailKey(item.email),
    address: clean(item.address), postalCode: clean(item.postalCode), city: clean(item.city),
    province: clean(item.province), country: clean(item.country),
    birthDate: "", dni: clean(item.dni).toUpperCase(), dniNormalized: documentKey(item.dni), dniExpiry: "",
    passport: clean(item.passport).toUpperCase(), passportNormalized: documentKey(item.passport), passportExpiry: "",
    discoveryChannel: "", discoveryChannelOther: "", superTraveler: Boolean(item.superTraveler),
    leadIds: [], reservations: {}, active: true,
    imported: true, importBatch: "legacy-clients-2026", importSourceLine: item.line,
    createdBy: userId, updatedBy: userId, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
}

export async function importApprovedClients(csvText) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const existingSnapshot = await getDocs(collection(db, "clients"));
  const existing = existingSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const preview = previewClientImport(csvText, existing);
  const approved = preview.items.filter((item) => item.status === "NEW" || item.reviewType === "DUPLICATE_IN_FILE");

  for (let offset = 0; offset < approved.length; offset += 400) {
    const batch = writeBatch(db);
    approved.slice(offset, offset + 400).forEach((item) => {
      batch.set(doc(db, "clients", importDocumentId(item)), payloadFor(item, user.uid));
    });
    await batch.commit();
  }

  invalidateClientsCache();
  window.dispatchEvent(new CustomEvent("travelflow:clients-updated"));
  return {
    imported: approved.length,
    skippedExisting: preview.totals.EXISTING,
    skippedInvalid: preview.totals.INVALID
  };
}
