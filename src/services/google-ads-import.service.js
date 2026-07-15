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
  PROXIMA_VEGADA: "CONTACT_LATER",
  "DEMANA INFO": "INFO_SENT",
  "INFO ENVIADA": "INFO_SENT",
  MAIL_BENVINGUDA: "INFO_SENT",
  WHATS_BENVINGUDA: "INFO_SENT"
});

const LOST_REASON_MAP = Object.freeze({
  NO_CONTESTA: "NO_RESPONSE",
  ECON: "PRICE",
  DATES: "DATES",
  SALUT: "HEALTH",
  VACANCES: "NO_HOLIDAYS",
  ALTRE_VIATGE: "BOOKED_ELSEWHERE",
  DESTINACIO: "DESTINATION",
  DURADA: "OTHER",
  NO_MOMENT: "OTHER",
  FEINA: "OTHER",
  ALTRES: "OTHER"
});

const ENTRY_MAP = Object.freeze({
  INSTAGRAM: { channel: "INSTAGRAM", source: "INSTAGRAM_ORGANIC", label: "Instagram" },
  INSTA_ADS: { channel: "INSTAGRAM", source: "INSTAGRAM_ORGANIC", label: "Instagram Ads" },
  GOOGLE_ADS: { channel: "WEB", source: "GOOGLE_ADS", label: "Google Ads" },
  MAIL_WEB: { channel: "WEB", source: "WEBSITE_FORM", label: "Formulari web" },
  RESERVA_WEB: { channel: "WEB", source: "WEBSITE_FORM", label: "Reserva web" },
  WHATSAPP: { channel: "WHATSAPP", source: "WHATSAPP", label: "WhatsApp" },
  OFICINA: { channel: "OTHER", source: "MANUAL", label: "Oficina" }
});

const CURRENT_TRIP_HINTS = Object.freeze({
  UZBEKISTAN: ["uzbekistan"],
  MARRAKECH_TARDOR: ["marrakech", "essaouira"],
  NAPOLS: ["napols", "pompeia", "amalfitana"],
  TRANSILVANIA: ["transilvania"],
  SRI_LANKA: ["sri lanka"],
  SICILIA: ["sicilia"],
  MUNICH: ["munich", "tirol"],
  ALSACIA_NADAL: ["alsacia", "nadal"],
  NOVA_YORK: ["nova york"],
  MARRAKECH_FI_ANY: ["marrakech", "fi d'any"],
  CREUER_RIN: ["rin"],
  LONDRES: ["londres"]
});

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
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
  return { firstName: parts.shift() || "Lead", lastName: parts.join(" ") };
}

function identityKeys(item) {
  const keys = [];
  if (item.phoneNormalized) keys.push(`phone:${item.phoneNormalized}`);
  if (item.email) keys.push(`email:${item.email}`);
  if (item.instagramHandle) keys.push(`instagram:${normalizeText(item.instagramHandle)}`);
  if (!keys.length && item.fullName) keys.push(`name:${normalizeText(item.fullName)}`);
  return keys;
}

function detectContact(firstValue = "", secondValue = "", sourceKey = "") {
  const values = [firstValue, secondValue].map((value) => String(value).trim()).filter((value) => value && value !== "-");
  const email = values.map(normalizeEmail).find(Boolean) || "";
  const phoneValue = values.find((value) => !value.includes("@") && normalizePhone(value)) || "";
  const instagramValue = sourceKey === "INSTAGRAM" || sourceKey === "INSTA_ADS"
    ? values.find((value) => !normalizeEmail(value) && !normalizePhone(value)) || ""
    : "";
  return {
    email,
    phone: phoneValue,
    phoneNormalized: normalizePhone(phoneValue),
    instagramHandle: instagramValue
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

function buildTask(status, notes, lastContact) {
  if (["LOST", "BOOKING_CONFIRMED"].includes(status)) return null;
  const titles = {
    FOLLOW_UP: "Fer seguiment",
    INFO_SENT: "Fer seguiment després d'enviar informació",
    CONTACT_LATER: "Revisar interès per a futurs viatges",
    NEW: "Revisar consulta"
  };
  return {
    title: titles[status] || "Revisar lead",
    dueAt: addDays(lastContact || new Date(), status === "INFO_SENT" ? 3 : 7),
    note: notes || ""
  };
}

function parseLine(line, index) {
  const columns = line.split("\t").map((value) => value.trim());
  if (!columns.some(Boolean)) return null;

  const firstCell = normalizeText(columns[0]);
  if (firstCell === "data entrada" && !parseDate(columns[1])) return null;
  if (firstCell === "data entrada" && parseDate(columns[1])) columns[0] = "";
  if (firstCell.startsWith("data entrada") && normalizeText(columns[1]).includes("primer contacte")) return null;

  while (columns.length < 12) columns.push("");
  const [entryRaw, firstContactRaw, leadTypeRaw, sourceRaw, nameRaw, contactA, contactB, tripCodeRaw, statusRaw, lostReasonRaw, lastContactRaw, ...noteParts] = columns;
  const sourceKey = String(sourceRaw).trim().toUpperCase();
  const entry = ENTRY_MAP[sourceKey] || { channel: "OTHER", source: "OTHER", label: sourceRaw || "Altres" };
  const contact = detectContact(contactA, contactB, sourceKey);
  const dates = resolveDates(entryRaw, firstContactRaw, lastContactRaw);
  const statusKey = String(statusRaw).trim().toUpperCase();
  const status = STATUS_MAP[statusKey] || "NEW";
  const phoneLabel = contact.phone || contact.email || contact.instagramHandle || `fila ${index + 1}`;
  const fullName = String(nameRaw).trim() || `Lead ${phoneLabel}`;
  const notes = noteParts.join(" ").trim();
  const lostReasonKey = String(lostReasonRaw).trim().toUpperCase();

  return {
    lineNumber: index + 1,
    fullName,
    ...splitName(fullName),
    ...contact,
    tripCode: String(tripCodeRaw).trim().toUpperCase(),
    leadType: String(leadTypeRaw).trim().toUpperCase(),
    entry,
    status,
    lostReason: status === "LOST" ? (LOST_REASON_MAP[lostReasonKey] || "OTHER") : "",
    notes,
    createdDate: dates.entry || new Date(),
    firstContactDate: dates.firstContact || dates.entry || new Date(),
    lastContactDate: dates.lastContact || dates.firstContact || dates.entry || new Date()
  };
}

export function parseGoogleAdsImport(text = "") {
  const rows = String(text).replace(/\r/g, "").split("\n").map(parseLine).filter(Boolean);
  return {
    rows,
    total: rows.length,
    lost: rows.filter((row) => row.status === "LOST").length,
    booked: rows.filter((row) => row.status === "BOOKING_CONFIRMED").length,
    withoutName: rows.filter((row) => row.fullName.startsWith("Lead ")).length
  };
}

function findTripForCode(code, trips) {
  const hints = CURRENT_TRIP_HINTS[code];
  if (!hints) return null;
  const normalizedHints = hints.map(normalizeText);
  return trips.find((trip) => {
    const normalizedName = normalizeText(trip.name);
    return normalizedHints.every((hint) => normalizedName.includes(hint));
  }) || null;
}

function mergeNotes(existing = "", incoming = "") {
  const current = String(existing || "").trim();
  const next = String(incoming || "").trim();
  if (!next || current.includes(next)) return current;
  return current ? `${current}\n\n${next}` : next;
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

  const [trips, leadsSnapshot] = await Promise.all([getTrips(), getDocs(collection(db, "leads"))]);
  const leadsByIdentity = new Map();
  leadsSnapshot.docs.forEach((leadDoc) => {
    const data = leadDoc.data();
    identityKeys({
      fullName: data.fullName,
      phoneNormalized: data.phoneNormalized || normalizePhone(data.phone),
      email: normalizeEmail(data.email),
      instagramHandle: data.instagramHandle || ""
    }).forEach((key) => leadsByIdentity.set(key, { ref: leadDoc.ref, data }));
  });

  const operations = [];
  let created = 0;
  let updated = 0;
  let tagged = 0;

  parsed.rows.forEach((item) => {
    const match = identityKeys(item).map((key) => leadsByIdentity.get(key)).find(Boolean);
    const trip = findTripForCode(item.tripCode, trips);
    const tripIds = trip ? [trip.id] : [];
    const tripLabels = trip ? [trip.name] : [];
    if (trip) tagged += 1;
    const createdAt = toTimestamp(item.createdDate);
    const lastContactAt = toTimestamp(item.lastContactDate);
    const task = buildTask(item.status, item.notes, item.lastContactDate);

    if (match) {
      const existingTripIds = Array.isArray(match.data.tripIds) ? match.data.tripIds : [];
      const existingTripLabels = Array.isArray(match.data.tripLabels) ? match.data.tripLabels : [];
      operations.push({
        ref: match.ref,
        merge: true,
        data: {
          channel: item.entry.channel,
          source: item.entry.source,
          entryPreset: item.tripCode || item.entry.source,
          entryLabel: item.entry.label,
          status: item.status,
          lostReason: item.lostReason,
          notes: mergeNotes(match.data.notes, item.notes),
          tripIds: [...new Set([...existingTripIds, ...tripIds])],
          tripLabels: [...new Set([...existingTripLabels, ...tripLabels])],
          interest: [...new Set([...existingTripLabels, ...tripLabels])].join(", "),
          legacyInterestCode: item.tripCode,
          lastContactAt,
          updatedAt: lastContactAt,
          updatedBy: user.uid,
          imported: true,
          importBatch: "historical-private-paste-2026"
        }
      });
      operations.push({
        ref: doc(collection(db, "activities")),
        data: {
          leadId: match.ref.id,
          type: "LEAD_UPDATED",
          description: "Lead actualitzat durant la importació històrica privada.",
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
        instagramHandle: item.instagramHandle,
        facebookUrl: "",
        channel: item.entry.channel,
        source: item.entry.source,
        entryPreset: item.tripCode || item.entry.source,
        entryLabel: item.entry.label,
        campaign: "Importació històrica 2026",
        tripIds,
        tripLabels,
        interest: tripLabels.join(", "),
        legacyInterestCode: item.tripCode,
        notes: item.notes,
        status: item.status,
        lostReason: item.lostReason,
        priority: "NORMAL",
        temperature: item.status === "BOOKING_CONFIRMED" ? "HOT" : "WARM",
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
        importBatch: "historical-private-paste-2026"
      }
    });

    operations.push({
      ref: doc(collection(db, "activities")),
      data: {
        leadId: leadRef.id,
        type: "LEAD_CREATED",
        description: `Lead importat del llistat històric (${item.entry.label}).`,
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
          importBatch: "historical-private-paste-2026"
        }
      });
    }

    identityKeys(item).forEach((key) => leadsByIdentity.set(key, { ref: leadRef, data: item }));
    created += 1;
  });

  await commitOperations(operations);
  return { ...parsed, created, updated, tagged, untagged: parsed.total - tagged };
}

export function getGoogleAdsImportError(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat.",
    ADMIN_REQUIRED: "Només una usuària ADMIN pot fer aquesta importació.",
    NO_VALID_ROWS: "No s'ha detectat cap fila vàlida. Enganxa el bloc complet mantenint les columnes."
  };
  return messages[error?.message] || "No s'ha pogut completar la importació històrica.";
}
