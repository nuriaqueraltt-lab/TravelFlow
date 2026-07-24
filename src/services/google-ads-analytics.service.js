import {
  collection,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();
const requests = new Map();
let generation = 0;

function mapDocument(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function millis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const result = date.getTime();
  if (Number.isNaN(result)) throw new Error("GOOGLE_ADS_REPORT_RANGE_INVALID");
  return result;
}

function keyFor(start, end) {
  return `${millis(start)}:${millis(end)}`;
}

export function invalidateGoogleAdsReportCache() {
  generation += 1;
  cache.clear();
  requests.clear();
}

export async function getGoogleAdsLeads({ start, end, force = false } = {}) {
  const startMillis = millis(start);
  const endMillis = millis(end);
  if (startMillis > endMillis) throw new Error("GOOGLE_ADS_REPORT_RANGE_INVALID");

  const key = keyFor(start, end);
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.items;
  if (!force && requests.has(key)) return requests.get(key);

  const requestGeneration = generation;
  const request = getDocs(query(
    collection(db, "leads"),
    where("source", "==", "GOOGLE_ADS"),
    where("createdAt", ">=", new Date(startMillis)),
    where("createdAt", "<=", new Date(endMillis)),
    orderBy("createdAt", "desc")
  )).then((snapshot) => {
    const items = snapshot.docs.map(mapDocument).filter((lead) => lead.active !== false);
    if (requestGeneration === generation) cache.set(key, { items, at: Date.now() });
    return items;
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });

  requests.set(key, request);
  return request;
}

["travelflow:leads-updated", "travelflow:lead-created", "travelflow:lead-deleted"].forEach((eventName) => {
  window.addEventListener(eventName, invalidateGoogleAdsReportCache);
});
