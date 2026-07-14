import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { ACTIVITY_TYPES } from "../config/app.constants.js";

export async function updateLeadEntryChannel(leadId, { channel, source, entryPreset, entryLabel }) {
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("AUTH_REQUIRED");
  if (!leadId || !channel || !source) throw new Error("ENTRY_SOURCE_REQUIRED");

  const leadRef = doc(db, "leads", leadId);
  const snapshot = await getDoc(leadRef);
  if (!snapshot.exists()) throw new Error("LEAD_NOT_FOUND");

  const current = snapshot.data();
  if (current.channel === channel && current.source === source) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(leadRef, {
    channel,
    source,
    entryPreset: entryPreset || "",
    updatedBy: currentUser.uid,
    updatedAt: now
  });
  batch.set(doc(collection(db, "activities")), {
    leadId,
    type: ACTIVITY_TYPES.NOTE,
    description: `Canal d'entrada modificat de ${current.entryPreset || current.channel || "Sense canal"} a ${entryLabel || entryPreset || channel}.`,
    createdBy: currentUser.uid,
    createdAt: now
  });
  await batch.commit();
}
