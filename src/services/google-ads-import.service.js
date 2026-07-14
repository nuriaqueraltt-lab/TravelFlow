import {
  collection,
  doc,
  getDocs,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "./firebase.service.js";
import { getCurrentUser } from "./auth.service.js";
import { getCurrentUserProfile } from "./user-profile.service.js";
import { getTrips } from "./trip.service.js";

const STATUS_MAP = Object.freeze({
  PERDUT: "LOST",
  RESERVAT: "BOOKING_CONFIRMED",
  SEGUIMENT: "FOLLOW_UP",
  "PRÒXIMA_VEGADA": "CONTACT_LATER",
  "PROXIMA_VEGADA": "CONTACT_LATER",
  "DEMANA INFO": "INFO_SENT",
  "INFO ENVIADA": "INFO_SENT",
  MAIL_BENVINGUDA: "INFO_SENT",
  WHATS_BENVINGUDA: "INFO_SENT"
});

const LOST_REASON_MAP = Object.freeze({
  NO_CONTESTA: "NO_RESPONSE",
  ALTRE_VIATGE: "DESTINATION",
  FEINA: "OTHER"
});

const TRIP_CODE_HINTS = Object.freeze({
  SRI_LANKA: ["sri lanka"],
  VIETNAM_2027: ["2027", "vietnam"],
  XINA: ["2027", "xina"],
  LA_MANCHA: ["la mancha"],
  LONDRES: ["2026", "londres"],
  ALSACIA_NADAL: ["alsacia en navidad"],
  MUNICH: ["2026", "munich"],
  MARRAKECH_TARDOR: ["marrakech y essaouira"],
  UZBEKISTAN: ["2026", "uzbekistan"]
});

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

function normalizeEmail(value = "") {
  const clean = String(value).trim().toLowerCase();
  return clean && clean !== "-" && clean.includes("@") ? clean : "";
}

function parseDate(value = "") {
  const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 10, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTimestamp(date) {
  return date ? Timestamp.fromDate(date) : null;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function splitName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "Lead",
    lastName: parts.join(" ")
  };
}

function identityKeys(item) {
  const keys = [];
  if (item.phoneNormalized) keys.push(`phone:${item.phoneNormalized}`);
  if (item.email) keys.push(`email:${item.email}`);
  if (!keys.length && item.fullName) keys.push(`name:${normalizeText(item.fullName)}`);
  return keys;
}

function detectContact(firstValue = "", secondValue = "") {
  const values = [firstValue, secondValue].map((value) => String(value).trim());
  const email = values.map(normalizeEmail).find(Boolean) || "";
  const phoneValue = values.find((value) => !value.includes("@") && normalizePhone(value)) || "";
  return {
    email,
    phone: phoneValue,
    phoneNormalized: normalizePhone(phoneValue)
  };
}

function resolveDates(entryRaw, firstContactRaw, lastContactRaw) {
  const firstContact = parseDate(firstContactRaw);
  let entry = parseDate(entryRaw) || firstContact;
  const lastContact = parseDate(lastContactRaw) || firstContact || entry;

  if (entry && firstContact && entry > firstContact) {
    const differenceInDays = Math.round((entry - firstContact) / 86400000);
    if (differenceInDays >= 20) entry = firstContact;
  }

  return { entry, firstContact: firstContact || entry, lastContact: lastContact || entry };
}

function buildTask(status, notes, lastContact, suppliedDate) {
  if (["LOST", "BOOKING_CONFIRMED"].includes(status)) return null;

  const titles = {
    FOLLOW_UP: "Fer seguiment",
    INFO_SENT: "Fer seguiment després d'enviar informació",
    CONTACT_LATER: "Revisar interès per a futurs viatges",
    NEW: "Revisar consulta de Google Ads"
  };

  return {
    title: titles[status] || "Revisar lead de Google Ads",
    dueAt: suppliedDate || addDays(lastContact || new Date(), status === "INFO_SENT" ? 3 : 7),
    note: notes || ""
  };
}

function parseLine(line, index) {
  const columns = line.split("\t").map((value) => value.trim());
  if (!columns.some(Boolean)) return null;
  if (normalizeText(columns[0]).startsWith("data entrada")) return null;

  while (columns.length < 12) columns.push("");
  const [entryRaw, firstContactRaw, , , nameRaw, contactA, contactB, tripCodeRaw, statusRaw, lostReasonRaw, lastContactRaw, ...noteParts] = columns;
  const contact = detectContact(contactA, contactB);
  const dates = resolveDates(entryRaw, firstContactRaw, lastContactRaw);
  const statusKey = String(statusRaw).trim().toUpperCase();
  const status = STATUS_MAP[statusKey] || "NEW";
  const phoneLabel = contact.phone || contact.email || `fila ${index + 1}`;
  const fullName = String(nameRaw).trim() || `Lead Google Ads ${phoneLabel}`;
  const notes = noteParts.join(" ").trim();
  const lostReasonKey = String(lostReasonRaw).trim().toUpperCase();

  return {
    lineNumber: index + 1,
    fullName,
    ...splitName(fullName),
    phone: contact.phone,
    phoneNormalized: contact.phoneNormalized,
    email: contact.email,
    tripCode: String(tripCodeRaw).trim().toUpperCase(),
    status,
    lostReason: status === "LOST" ? (LOST_REASON_MAP[lostReasonKey] || "OTHER") : "",
    notes,
    createdDate: dates.entry || new Date(),
    firstContactDate: dates.firstContact || dates.entry || new Date(),
    lastContactDate: dates.lastContact || dates.firstContact || dates.entry || new Date()
  };
}

export function parseGoogleAdsImport(text = "") {
  const rows = String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map(parseLine)
    .filter(Boolean);

  return {
    rows,
    total: rows.length,
    lost: rows.filter((row) => row.status === "LOST").length,
    booked: rows.filter((row) => row.status === "BOOKING_CONFIRMED").length,
    withoutName: rows.filter((row) => row.fullName.startsWith("Lead Google Ads")).length
  };
}

function findTripForCode(code, trips) {
  const hints = TRIP_CODE_HINTS[code];
  if (!hints) return null;
  return trips.find((trip) => {
    const normalized = normalizeText(trip.name);
    return hints.every((hint) => normalized.includes(normalizeText(hint)));
  }) || null;
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += 430) {
    const batch = writeBatch(db);
    operations.slice(start, start + 430).forEach(({ ref, data, merge = false }) => {
      batch.set(ref, data, merge ? { merge: true } : undefined);
    });
    await batch.commit();
  }
}

export async function importGoogleAdsLeads(text = "") {
  const user = getCurrentUser();
  const profile = getCurrentUserProfile();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (profile?.role !== "ADMIN") throw new Error("ADMIN_REQUIRED");

  const parsed = parseGoogleAdsImport(text);
  if (!parsed.rows.length) throw new Error("NO_VALID_ROWS");

  const [trips, leadsSnapshot] = await Promise.all([
    getTrips(),
    getDocs(collection(db, "leads"))
  ]);

  const leadsByIdentity = new Map();
  leadsSnapshot.docs.forEach((leadDoc) => {
    const data = leadDoc.data();
    identityKeys({
      fullName: data.fullName,
      phoneNormalized: data.phoneNormalized || normalizePhone(data.phone),
      email: normalizeEmail(data.email)
    }).forEach((key) => leadsByIdentity.set(key, { ref: leadDoc.ref, data }));
  });

  const operations = [];
  let created = 0;
  let updated = 0;

  parsed.rows.forEach((item) => {
    const match = identityKeys(item).map((key) => leadsByIdentity.get(key)).find(Boolean);
    const trip = findTripForCode(item.tripCode, trips);
    const tripIds = trip ? [trip.id] : [];
    const tripLabels = trip ? [trip.name] : [];
    const createdAt = toTimestamp(item.createdDate);
    const lastContactAt = toTimestamp(item.lastContactDate);
    const task = buildTask(item.status, item.notes, item.lastContactDate, item.lastContactDate);

    if (match) {
      operations.push({
        ref: match.ref,
        merge: true,
        data: {
          channel: "WEB",
          source: "GOOGLE_ADS",
          entryPreset: "GOOGLE_ADS",
          entryLabel: "Google Ads",
          updatedBy: user.uid,
          googleAdsCorrectedAt: Timestamp.now()
        }
      });

      operations.push({
        ref: doc(collection(db, "activities")),
        data: {
          leadId: match.ref.id,
          type: "CHANNEL_UPDATED",
          description: "Canal d'entrada actualitzat a Google Ads durant la importació històrica.",
          createdBy: user.uid,
          createdAt: Timestamp.now()
        }
      });
      updated += 1;
      return;
    }

    const leadRef = doc(collection(db, "leads"));
    operations.push({
      ref: leadRef,
      data: {
        firstName: item.firstName,
        lastName: item.lastName,
        fullName: item.fullName,
        fullNameSearch: normalizeText(item.fullName),
        phone: item.phone,
        phoneNormalized: item.phoneNormalized,
        email: item.email,
        instagramHandle: "",
        facebookUrl: "",
        channel: "WEB",
        source: "GOOGLE_ADS",
        entryPreset: "GOOGLE_ADS",
        entryLabel: "Google Ads",
        campaign: "Google Ads històric 2026",
        tripIds,
        tripLabels,
        interest: tripLabels.join(", "),
        legacyInterestCode: item.tripCode,
        notes: item.notes,
        status: item.status,
        lostReason: item.lostReason,
        priority: "NORMAL",
        temperature: "WARM",
        ownerId: user.uid,
        createdBy: user.uid,
        updatedBy: user.uid,
        active: true,
        noResponseCount: item.lostReason === "NO_RESPONSE" ? 2 : 0,
        lastContactAt,
        nextActionTitle: task?.title || "",
        nextActionAt: task ? toTimestamp(task.dueAt) : null,
        createdAt,
        updatedAt: lastContactAt,
        imported: true,
        importBatch: "google-ads-private-paste-2026"
      }
    });

    operations.push({
      ref: doc(collection(db, "activities")),
      data: {
        leadId: leadRef.id,
        type: "LEAD_CREATED",
        description: "Lead importat del llistat històric de Google Ads.",
        createdBy: user.uid,
        createdAt
      }
    });

    if (item.notes) {
      operations.push({
        ref: doc(collection(db, "activities")),
        data: {
          leadId: leadRef.id,
          type: "CONTACT",
          description: item.notes,
          createdBy: user.uid,
          createdAt: lastContactAt
        }
      });
    }

    if (task) {
      operations.push({
        ref: doc(collection(db, "tasks")),
        data: {
          leadId: leadRef.id,
          leadName: item.fullName,
          tripName: tripLabels[0] || "",
          title: task.title,
          type: "MANUAL",
          status: "PENDING",
          automatic: false,
          dueAt: toTimestamp(task.dueAt),
          createdBy: user.uid,
          createdAt: lastContactAt,
          updatedAt: lastContactAt,
          importBatch: "google-ads-private-paste-2026"
        }
      });
    }

    identityKeys(item).forEach((key) => leadsByIdentity.set(key, { ref: leadRef, data: item }));
    created += 1;
  });

  await commitOperations(operations);
  return { ...parsed, created, updated };
}

export function getGoogleAdsImportError(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat.",
    ADMIN_REQUIRED: "Només una usuària ADMIN pot fer aquesta importació.",
    NO_VALID_ROWS: "No s'ha detectat cap fila vàlida. Enganxa el bloc complet mantenint les columnes."
  };
  return messages[error?.message] || "No s'ha pogut completar la importació de Google Ads.";
}
