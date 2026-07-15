import { deleteApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
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

async function saveManagedUserProfile({ uid, displayName, email, role }) {
  await setDoc(doc(db, "users", uid), {
    displayName,
    email,
    role,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: getCurrentUserProfile().uid
  }, { merge: true });

  const verification = await getDocFromServer(doc(db, "users", uid));
  if (!verification.exists()) throw new Error("PROFILE_NOT_CREATED");
}

export async function getManagedUsers() {
  requireAdmin();
  const snapshot = await getDocsFromServer(collection(db, "users"));
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
  let accountWasCreatedNow = false;

  try {
    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, cleanPassword);
      createdUser = credential.user;
      accountWasCreatedNow = true;
    } catch (error) {
      if (error?.code !== "auth/email-already-in-use") throw error;
      const credential = await signInWithEmailAndPassword(secondaryAuth, cleanEmail, cleanPassword);
      createdUser = credential.user;
    }

    await saveManagedUserProfile({
      uid: createdUser.uid,
      displayName: cleanName,
      email: cleanEmail,
      role
    });

    await signOut(secondaryAuth);
    return {
      uid: createdUser.uid,
      displayName: cleanName,
      email: cleanEmail,
      role,
      active: true,
      recoveredExistingAccount: !accountWasCreatedNow
    };
  } catch (error) {
    if (accountWasCreatedNow && createdUser) await deleteUser(createdUser).catch(() => {});
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
    PROFILE_NOT_CREATED: "El compte s’ha creat, però no s’ha pogut completar el perfil de TravelFlow.",
    "auth/email-already-in-use": "Aquest correu ja té un compte. Torna a introduir la mateixa contrasenya temporal per completar-ne el perfil.",
    "auth/invalid-credential": "El compte ja existeix, però la contrasenya introduïda no coincideix.",
    "auth/wrong-password": "El compte ja existeix, però la contrasenya introduïda no coincideix.",
    "auth/invalid-email": "El correu electrònic no és vàlid.",
    "auth/weak-password": "La contrasenya temporal és massa feble.",
    "auth/too-many-requests": "Firebase ha bloquejat temporalment l’operació. Torna-ho a provar més tard.",
    "permission-denied": "No tens permisos per gestionar aquest accés. Publica també les regles de Firestore."
  };
  return messages[error?.message] || messages[error?.code] || "No s’ha pogut completar la gestió de la usuària.";
}
