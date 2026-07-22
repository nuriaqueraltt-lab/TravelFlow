import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { db } from "./firebase.service.js";

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
    return dateDifference || a.id.localeCompare(b.id);
  });
  return movementsCache;
}

export function invalidateTreasuryMovementsCache() {
  movementsCache = null;
}
