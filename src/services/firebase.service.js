import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

import { firebaseConfig } from "../config/firebase.config.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Safari pot deixar una connexió WebChannel pendent sense retornar ni dades
// ni cap error. Forcem long polling i evitem fetch streams perquè totes les
// lectures i escriptures acabin amb una resposta verificable.
export const db = initializeFirestore(firebaseApp, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

export const storage = getStorage(firebaseApp);
