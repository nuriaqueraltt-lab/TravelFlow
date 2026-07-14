import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";

export const USER_ROLES = Object.freeze({
  ADMIN: "ADMIN",
  COMMERCIAL: "COMERCIAL"
});

const ADMIN_EMAILS = new Set(["nuria.queraltt@gmail.com"]);
let currentProfile = null;

function normalizeProfile(user, data = {}) {
  const displayName = data.displayName?.trim() || user.displayName?.trim() || user.email?.split("@")[0] || "Usuària";
  const role = Object.values(USER_ROLES).includes(data.role) ? data.role : null;

  return {
    uid: user.uid,
    email: user.email || data.email || "",
    displayName,
    role,
    active: data.active !== false
  };
}

async function createInitialAdminProfile(user) {
  const profile = {
    displayName: "Núria Queralt",
    email: user.email || "",
    role: USER_ROLES.ADMIN,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "users", user.uid), profile, { merge: true });
  return normalizeProfile(user, profile);
}

export async function loadCurrentUserProfile(user) {
  if (!user) throw new Error("AUTH_REQUIRED");

  const reference = doc(db, "users", user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    if (ADMIN_EMAILS.has(String(user.email || "").toLowerCase())) {
      currentProfile = await createInitialAdminProfile(user);
      return currentProfile;
    }
    throw new Error("PROFILE_NOT_CONFIGURED");
  }

  const profile = normalizeProfile(user, snapshot.data());
  if (!profile.active) throw new Error("PROFILE_DISABLED");
  if (!profile.role) throw new Error("PROFILE_ROLE_INVALID");

  currentProfile = profile;
  return profile;
}

export function getCurrentUserProfile() {
  return currentProfile;
}

export function clearCurrentUserProfile() {
  currentProfile = null;
}

export function getProfileInitials(profile = currentProfile) {
  return String(profile?.displayName || "Usuària")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "US";
}

export function getRoleLabel(role) {
  return role === USER_ROLES.ADMIN ? "Administració" : "Comercial";
}

export function getProfileErrorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    PROFILE_NOT_CONFIGURED: "Aquest usuari encara no té accés autoritzat a TravelFlow.",
    PROFILE_DISABLED: "Aquest accés està desactivat.",
    PROFILE_ROLE_INVALID: "El perfil no té un rol vàlid. Contacta amb l’administració.",
    "permission-denied": "No s’ha pogut comprovar el perfil d’accés."
  };

  return messages[error?.message] ?? messages[error?.code] ?? "No s’ha pogut carregar el perfil d’usuari.";
}
