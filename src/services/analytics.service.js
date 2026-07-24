import {
  collection,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";

const ANALYTICS_CACHE_TTL = 5 * 60 * 1000;
const analyticsCache = new Map();
const analyticsRequests = new Map();

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function dateMillis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  if (Number.isNaN(millis)) throw new Error("ANALYTICS_DATE_RANGE_INVALID");
  return millis;
}

function rangeKey(start, end) {
  return `${dateMillis(start)}:${dateMillis(end)}`;
}

export function invalidateAnalyticsCache() {
  analyticsCache.clear();
  analyticsRequests.clear();
}

export async function getAnalyticsLeads({ start, end, force = false } = {}) {
  const startMillis = dateMillis(start);
  const endMillis = dateMillis(end);
  if (startMillis > endMillis) throw new Error("ANALYTICS_DATE_RANGE_INVALID");

  const key = rangeKey(start, end);
  const cached = analyticsCache.get(key);
  if (!force && cached && Date.now() - cached.at < ANALYTICS_CACHE_TTL) return cached.items;
  if (!force && analyticsRequests.has(key)) return analyticsRequests.get(key);

  const request = getDocs(query(
    collection(db, "leads"),
    where("createdAt", ">=", new Date(startMillis)),
    where("createdAt", "<=", new Date(endMillis)),
    orderBy("createdAt", "desc")
  )).then((snapshot) => {
    const items = snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
    analyticsCache.set(key, { items, at: Date.now() });
    return items;
  }).finally(() => {
    analyticsRequests.delete(key);
  });

  analyticsRequests.set(key, request);
  return request;
}

["travelflow:leads-updated", "travelflow:lead-created", "travelflow:lead-deleted"].forEach((eventName) => {
  window.addEventListener(eventName, invalidateAnalyticsCache);
});
