import {
  collection, documentId, getDocs, query, serverTimestamp, updateDoc, where, writeBatch, doc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";

let movementsCache = null;

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapMovement(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : 0,
    movementDate: toDate(data.movementDate || data.date)
  };
}

export async function getTreasuryMovements({ force = false } = {}) {
  if (!force && movementsCache) return movementsCache;
  const snapshot = await getDocs(collection(db, "treasuryMovements"));
  movementsCache = snapshot.docs.map(mapMovement).sort((a, b) => {
    const dateDifference = (b.movementDate?.getTime() || 0) - (a.movementDate?.getTime() || 0);
    const importDifference = (b.importedAt?.seconds || 0) - (a.importedAt?.seconds || 0);
    return dateDifference || importDifference || (a.sourcePosition ?? 9999) - (b.sourcePosition ?? 9999) || a.id.localeCompare(b.id);
  });
  return movementsCache;
}

export function invalidateTreasuryMovementsCache() {
  movementsCache = null;
}

export async function updateTreasuryMovementCategory(movementId, category) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  await updateDoc(doc(db, "treasuryMovements", movementId), {
    category,
    categoryUpdatedBy: user.uid,
    categoryUpdatedAt: serverTimestamp()
  });
  invalidateTreasuryMovementsCache();
}

function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function importTreasuryStatement(statement) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const ids = statement.movements.map((movement) => movement.id);
  const existingIds = new Set();

  for (const idChunk of chunks(ids, 30)) {
    const snapshot = await getDocs(query(
      collection(db, "treasuryMovements"),
      where(documentId(), "in", idChunk)
    ));
    snapshot.docs.forEach((item) => existingIds.add(item.id));
  }

  const newMovements = statement.movements.filter((movement) => !existingIds.has(movement.id));
  for (const movementChunk of chunks(newMovements, 450)) {
    const batch = writeBatch(db);
    movementChunk.forEach(({ id, ...movement }) => {
      batch.set(doc(db, "treasuryMovements", id), {
        ...movement,
        source: "BANK_STATEMENT",
        sourceFileName: statement.fileName,
        importedBy: user.uid,
        importedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }

  invalidateTreasuryMovementsCache();
  return {
    read: statement.movements.length,
    created: newMovements.length,
    duplicates: statement.movements.length - newMovements.length,
    firstDate: statement.firstDate,
    lastDate: statement.lastDate,
    finalBalance: statement.finalBalance
  };
}
