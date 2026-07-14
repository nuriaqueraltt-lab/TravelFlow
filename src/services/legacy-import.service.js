import {
  collection,
  doc,
  getDocs,
  query,
  Timestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { getTrips, seedInitialTrips } from "./trip.service.js";
import { LEGACY_LEADS, LEGACY_LEADS_IMPORT_ID } from "../data/legacy-leads.seed.js";

const LOCAL_KEY = `travelflow:${LEGACY_LEADS_IMPORT_ID}`;
const MAX_BATCH_OPERATIONS = 430;

function timestamp(dateValue, hour = 10) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T${String(hour).padStart(2, "0")}:00:00`);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function splitName(fullName = "") {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "Lead",
    lastName: parts.join(" ")
  };
}

function normalizedPhone(value = "") {
  return String(value).replace(/\D/g, "");
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += MAX_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    operations.slice(start, start + MAX_BATCH_OPERATIONS).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

export async function importLegacyLeadsOnce() {
  const user = getCurrentUser();
  if (!user || localStorage.getItem(LOCAL_KEY) === "done") return { imported: 0, skipped: true };

  await seedInitialTrips();
  const [trips, existingSnapshot] = await Promise.all([
    getTrips(),
    getDocs(query(collection(db, "leads"), where("importBatch", "==", LEGACY_LEADS_IMPORT_ID)))
  ]);

  const existingKeys = new Set(existingSnapshot.docs.map((item) => item.data().legacyKey));
  const tripsByName = new Map(trips.map((trip) => [trip.name, trip]));
  const operations = [];
  let imported = 0;

  LEGACY_LEADS.forEach((item) => {
    if (existingKeys.has(item.legacyKey)) return;

    const leadRef = doc(db, "leads", item.legacyKey);
    const { firstName, lastName } = splitName(item.fullName);
    const linkedTrips = item.tripNames.map((name) => tripsByName.get(name)).filter(Boolean);
    const tripIds = linkedTrips.map((trip) => trip.id);
    const tripLabels = linkedTrips.map((trip) => trip.name);
    const createdAt = timestamp(item.createdDate, 9);
    const lastContactAt = timestamp(item.lastContactDate, 12) || createdAt;
    const nextActionAt = timestamp(item.nextActionDate, 9);

    operations.push({
      ref: leadRef,
      data: {
        firstName,
        lastName,
        fullName: item.fullName,
        fullNameSearch: item.fullName.toLowerCase(),
        phone: item.phone || "",
        phoneNormalized: normalizedPhone(item.phone),
        email: item.email || "",
        instagramHandle: item.instagramHandle || "",
        facebookUrl: "",
        channel: item.channel,
        source: item.source,
        campaign: item.campaign || "",
        tripIds,
        tripLabels,
        interest: tripLabels.join(", "),
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
        importBatch: LEGACY_LEADS_IMPORT_ID,
        legacyKey: item.legacyKey
      }
    });

    operations.push({
      ref: doc(db, "activities", `${item.legacyKey}-created`),
      data: {
        leadId: item.legacyKey,
        type: "LEAD_CREATED",
        description: "Lead importat del full històric de seguiment.",
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
          createdAt: timestamp(activity.date, 12) || lastContactAt
        }
      });
    });

    if (item.nextActionTitle && nextActionAt) {
      operations.push({
        ref: doc(db, "tasks", `${item.legacyKey}-next-action`),
        data: {
          leadId: item.legacyKey,
          leadName: item.fullName,
          tripName: tripLabels[0] || "",
          title: item.nextActionTitle,
          type: "MANUAL",
          status: "PENDING",
          automatic: false,
          dueAt: nextActionAt,
          createdBy: user.uid,
          createdAt: lastContactAt,
          updatedAt: lastContactAt,
          importBatch: LEGACY_LEADS_IMPORT_ID
        }
      });
    }

    imported += 1;
  });

  if (operations.length) await commitOperations(operations);
  localStorage.setItem(LOCAL_KEY, "done");
  window.dispatchEvent(new CustomEvent("travelflow:legacy-imported", { detail: { imported } }));
  return { imported, skipped: false };
}
