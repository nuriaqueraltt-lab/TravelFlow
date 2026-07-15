import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

import { firebaseConfig } from "../config/firebase.config.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Safari pot mantenir oberta la connexió WebChannel però no confirmar les
// escriptures. La detecció automàtica de long polling fa que Firestore canviï
// de transport quan el canal està bloquejat, sense alterar la resta de l'app.
export const db = initializeFirestore(firebaseApp, {
  experimentalAutoDetectLongPolling: true
});

export const storage = getStorage(firebaseApp);
