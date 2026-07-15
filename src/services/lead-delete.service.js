import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

async function deleteInChunks(documents) {
  for (let start = 0; start < documents.length; start += 430) {
    const batch = writeBatch(db);
    documents.slice(start, start + 430).forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
}

export async function deleteLeadCompletely(leadId) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!leadId) throw new Error("LEAD_REQUIRED");

  const [activitiesSnapshot, tasksSnapshot] = await Promise.all([
    getDocs(query(collection(db, "activities"), where("leadId", "==", leadId))),
    getDocs(query(collection(db, "tasks"), where("leadId", "==", leadId)))
  ]);

  await deleteInChunks([...activitiesSnapshot.docs, ...tasksSnapshot.docs]);
  await deleteDoc(doc(db, "leads", leadId));

  return {
    activitiesDeleted: activitiesSnapshot.size,
    tasksDeleted: tasksSnapshot.size
  };
}

export function getLeadDeleteError(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    LEAD_REQUIRED: "No s'ha pogut identificar el lead.",
    "permission-denied": "No tens permisos per eliminar aquest lead.",
    unavailable: "No s'ha pogut connectar amb Firestore. Revisa la connexió."
  };

  return messages[error?.message] || messages[error?.code] || "No s'ha pogut eliminar el lead.";
}
