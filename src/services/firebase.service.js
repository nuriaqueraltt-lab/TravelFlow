import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

import { firebaseConfig } from "../config/firebase.config.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Deixem que l'SDK detecti si el navegador necessita long polling. Forçar-lo
// globalment no és necessari per autenticar-se i afecta totes les consultes.
export const db = initializeFirestore(firebaseApp, {
  experimentalAutoDetectLongPolling: true
});

export const storage = getStorage(firebaseApp);
