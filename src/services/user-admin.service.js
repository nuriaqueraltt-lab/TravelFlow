import { deleteApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { firebaseConfig } from "../config/firebase.config.js";
import { auth, db } from "./firebase.service.js";
import { getCurrentUserProfile, USER_ROLES } from "./user-profile.service.js";

function requireAdmin() {
  if (getCurrentUserProfile()?.role !== USER_ROLES.ADMIN) throw new Error("ADMIN_REQUIRED");
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeUser(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getManagedUsers() {
  requireAdmin();
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs
    .map(normalizeUser)
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email), "ca"));
}

export async function createManagedUser({ displayName, email, role = USER_ROLES.COMMERCIAL, temporaryPassword }) {
  requireAdmin();

  const cleanName = String(displayName || "").trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(temporaryPassword || "");

  if (!cleanName) throw new Error("DISPLAY_NAME_REQUIRED");
  if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("EMAIL_REQUIRED");
  if (!Object.values(USER_ROLES).includes(role)) throw new Error("ROLE_INVALID");
  if (cleanPassword.length < 8) throw new Error("PASSWORD_TOO_SHORT");

  const secondaryApp = initializeApp(firebaseConfig, `user-provisioning-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser = null;

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, cleanPassword);
    createdUser = credential.user;

    await setDoc(doc(db, "users", createdUser.uid), {
      displayName: cleanName,
      email: cleanEmail,
      role,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: getCurrentUserProfile().uid
    });

    await signOut(secondaryAuth);
    return { uid: createdUser.uid, displayName: cleanName, email: cleanEmail, role, active: true };
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => {});
    throw error;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export async function updateManagedUser(userId, { role, active }) {
  requireAdmin();
  if (!userId) throw new Error("USER_REQUIRED");
  if (!Object.values(USER_ROLES).includes(role)) throw new Error("ROLE_INVALID");
  if (userId === getCurrentUserProfile().uid && active === false) throw new Error("CANNOT_DISABLE_SELF");

  await updateDoc(doc(db, "users", userId), {
    role,
    active: active !== false,
    updatedAt: serverTimestamp(),
    updatedBy: getCurrentUserProfile().uid
  });
}

export async function sendManagedUserPasswordReset(email) {
  requireAdmin();
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new Error("EMAIL_REQUIRED");
  await sendPasswordResetEmail(auth, cleanEmail);
}

export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const values = crypto.getRandomValues(new Uint32Array(14));
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}

export function getUserAdminError(error) {
  const messages = {
    ADMIN_REQUIRED: "Només una administradora pot gestionar accessos.",
    DISPLAY_NAME_REQUIRED: "Indica el nom de la usuària.",
    EMAIL_REQUIRED: "Indica un correu electrònic vàlid.",
    ROLE_INVALID: "Selecciona un rol vàlid.",
    PASSWORD_TOO_SHORT: "La contrasenya temporal ha de tenir almenys 8 caràcters.",
    USER_REQUIRED: "No s’ha pogut identificar la usuària.",
    CANNOT_DISABLE_SELF: "No pots desactivar el teu propi accés.",
    "auth/email-already-in-use": "Aquest correu ja té un compte a Firebase Authentication.",
    "auth/invalid-email": "El correu electrònic no és vàlid.",
    "auth/weak-password": "La contrasenya temporal és massa feble.",
    "auth/too-many-requests": "Firebase ha bloquejat temporalment l’operació. Torna-ho a provar més tard.",
    "permission-denied": "No tens permisos per gestionar aquest accés."
  };
  return messages[error?.message] || messages[error?.code] || "No s’ha pogut completar la gestió de la usuària.";
}
