import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import { auth } from "./firebase.service.js";

export async function loginWithEmail(email, password, rememberSession = false) {
  const persistence = rememberSession
    ? browserLocalPersistence
    : browserSessionPersistence;

  await setPersistence(auth, persistence);
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export function logout() {
  return signOut(auth);
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function getAuthErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "El correu o la contrasenya no són correctes.",
    "auth/invalid-email": "Introdueix un correu electrònic vàlid.",
    "auth/missing-password": "Introdueix la contrasenya.",
    "auth/too-many-requests": "Hi ha hagut massa intents. Torna-ho a provar més tard.",
    "auth/network-request-failed": "No s'ha pogut connectar. Revisa la connexió a internet.",
    AUTH_TIMEOUT: "Firebase està tardant massa a iniciar la sessió. Torna-ho a provar.",
    "auth/user-disabled": "Aquest usuari està desactivat."
  };

  return messages[error?.code] ?? messages[error?.message] ?? "No s'ha pogut iniciar la sessió. Torna-ho a provar.";
}
