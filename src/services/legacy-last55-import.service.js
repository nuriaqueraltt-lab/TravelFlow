import {
  collection,
  doc,
  getDocs,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { getTrips, seedInitialTrips } from "./trip.service.js";
import {
  LEGACY_LEADS_LAST55,
  LEGACY_LEADS_LAST55_IMPORT_ID
} from "../data/legacy-leads-last55.seed.js";

const LOCAL_KEY = `travelflow:${LEGACY_LEADS_LAST55_IMPORT_ID}`;
const MAX_BATCH_OPERATIONS = 430;

function timestamp(dateValue, hour = 10) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T${String(hour).padStart(2, "0")}:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function splitName(fullName = "") {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "Lead", lastName: parts.join(" ") };
}

function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeInstagram(value = "") {
  return String(value).trim().replace(/^@/, "").toLowerCase();
}

function identityKeys(item) {
  const keys = [];
  const phone = normalizePhone(item.phone);
  const email = normalizeEmail(item.email);
  const instagram = normalizeInstagram(item.instagramHandle);
  if (phone) keys.push(`phone:${phone}`);
  if (email) keys.push(`email:${email}`);
  if (instagram) keys.push(`instagram:${instagram}`);
  if (!keys.length && item.fullName) keys.push(`name:${item.fullName.trim().toLowerCase()}`);
  return keys;
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += MAX_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    operations.slice(start, start + MAX_BATCH_OPERATIONS).forEach(({ ref, data, merge = false }) => {
      batch.set(ref, data, merge ? { merge: true } : undefined);
    });
    await batch.commit();
  }
}

export async function importLegacyLast55Once() {
  const user = getCurrentUser();
  if (!user || localStorage.getItem(LOCAL_KEY) === "done") return { imported: 0, merged: 0, skipped: true };

  await seedInitialTrips();
  const [trips, leadsSnapshot] = await Promise.all([
    getTrips(),
    getDocs(collection(db, "leads"))
  ]);

  const tripsByName = new Map(trips.map((trip) => [trip.name, trip]));
  const leadsByIdentity = new Map();
  leadsSnapshot.docs.forEach((leadDoc) => {
    const data = leadDoc.data();
    identityKeys({
      phone: data.phone,
      email: data.email,
      instagramHandle: data.instagramHandle,
      fullName: data.fullName
    }).forEach((key) => leadsByIdentity.set(key, { ref: leadDoc.ref, data }));
  });

  const operations = [];
  let imported = 0;
  let merged = 0;

  LEGACY_LEADS_LAST55.forEach((item) => {
    const match = identityKeys(item).map((key) => leadsByIdentity.get(key)).find(Boolean);
    const linkedTrips = item.tripNames.map((name) => tripsByName.get(name)).filter(Boolean);
    const extraTripIds = linkedTrips.map((trip) => trip.id);
    const extraTripLabels = linkedTrips.map((trip) => trip.name);
    const createdAt = timestamp(item.createdDate, 9);
    const lastContactAt = timestamp(item.lastContactDate, 12) || createdAt;
    const nextActionAt = timestamp(item.nextActionDate, 9);

    if (match) {
      const currentTripIds = Array.isArray(match.data.tripIds) ? match.data.tripIds : [];
      const currentTripLabels = Array.isArray(match.data.tripLabels) ? match.data.tripLabels : [];
      const tripIds = [...new Set([...currentTripIds, ...extraTripIds])];
      const tripLabels = [...new Set([...currentTripLabels, ...extraTripLabels])];

      operations.push({
        ref: match.ref,
        merge: true,
        data: {
          tripIds,
          tripLabels,
          interest: tripLabels.join(", "),
          notes: item.notes || match.data.notes || "",
          updatedAt: lastContactAt,
          updatedBy: user.uid,
          lastSupplementalImport: LEGACY_LEADS_LAST55_IMPORT_ID
        }
      });

      item.activities.forEach((activity, index) => {
        operations.push({
          ref: doc(db, "activities", `${match.ref.id}-${item.legacyKey}-extra-${index + 1}`),
          data: {
            leadId: match.ref.id,
            type: "CONTACT",
            description: activity.description,
            createdBy: user.uid,
            createdAt: timestamp(activity.date, 12) || lastContactAt,
            importBatch: LEGACY_LEADS_LAST55_IMPORT_ID
          }
        });
      });

      merged += 1;
      return;
    }

    const leadRef = doc(db, "leads", item.legacyKey);
    const { firstName, lastName } = splitName(item.fullName);

    operations.push({
      ref: leadRef,
      data: {
        firstName,
        lastName,
        fullName: item.fullName,
        fullNameSearch: item.fullName.toLowerCase(),
        phone: item.phone || "",
        phoneNormalized: normalizePhone(item.phone),
        email: item.email || "",
        instagramHandle: item.instagramHandle || "",
        facebookUrl: "",
        channel: item.channel,
        source: item.source,
        campaign: item.campaign || "",
        tripIds: extraTripIds,
        tripLabels: extraTripLabels,
        interest: extraTripLabels.join(", "),
        notes: item.notes || "",
        status: item.status,
        lostReason: item.lostReason || "",
        priority: "NORMAL",
        temperature: "WARM",
        ownerId: user.uid,
        createdBy: user.uid,
        updatedBy: user.uid,
        active: true,
        noResponseCount: 0,
        lastContactAt,
        nextActionTitle: item.nextActionTitle || "",
        nextActionAt,
        createdAt,
        updatedAt: lastContactAt,
        imported: true,
        importBatch: LEGACY_LEADS_LAST55_IMPORT_ID,
        legacyKey: item.legacyKey
      }
    });

    operations.push({
      ref: doc(db, "activities", `${item.legacyKey}-created`),
      data: {
        leadId: item.legacyKey,
        type: "LEAD_CREATED",
        description: "Lead importat de l'últim bloc del full històric.",
        createdBy: user.uid,
        createdAt
      }
    });

    item.activities.forEach((activity, index) => {
      operations.push({
        ref: doc(db, "activities", `${item.legacyKey}-history-${index + 1}`),
        data: {
          leadId: item.legacyKey,
          type: "CONTACT",
          description: activity.description,
          createdBy: user.uid,
          createdAt: timestamp(activity.date, 12) || lastContactAt,
          importBatch: LEGACY_LEADS_LAST55_IMPORT_ID
        }
      });
    });

    if (item.nextActionTitle && nextActionAt) {
      operations.push({
        ref: doc(db, "tasks", `${item.legacyKey}-next-action`),
        data: {
          leadId: item.legacyKey,
          leadName: item.fullName,
          tripName: extraTripLabels[0] || "",
          title: item.nextActionTitle,
          type: "MANUAL",
          status: "PENDING",
          automatic: false,
          dueAt: nextActionAt,
          createdBy: user.uid,
          createdAt: lastContactAt,
          updatedAt: lastContactAt,
          importBatch: LEGACY_LEADS_LAST55_IMPORT_ID
        }
      });
    }

    identityKeys(item).forEach((key) => leadsByIdentity.set(key, { ref: leadRef, data: item }));
    imported += 1;
  });

  if (operations.length) await commitOperations(operations);
  localStorage.setItem(LOCAL_KEY, "done");
  window.dispatchEvent(new CustomEvent("travelflow:legacy-last55-imported", { detail: { imported, merged } }));
  return { imported, merged, skipped: false };
}
