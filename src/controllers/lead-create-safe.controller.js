import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import { db } from "../services/firebase.service.js";
import { getCurrentUser } from "../services/auth.service.js";
import { getTrips } from "../services/trip.service.js";
import {
  ACTIVITY_TYPES,
  FOLLOW_UP_DEFAULTS,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  TASK_STATUSES,
  TASK_TYPES
} from "../config/app.constants.js";

const PRIMARY_SAVE_TIMEOUT = 15000;
const SUPPORT_SAVE_TIMEOUT = 5000;
let saving = false;

function withTimeout(promise, milliseconds, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(code)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeInstagram(value = "") {
  const clean = String(value).trim();
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : clean.replace(/^@/, "");
}

function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function localDate(value, hour) {
  if (!value) return new Date();
  const date = new Date(`${value}T${String(hour).padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_CONTACT_DATE");
  return date;
}

function addDays(baseDate, days) {
  const date = new Date(baseDate);
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function setSavingState(form, isSaving) {
  const save = form.querySelector("[data-save-lead]");
  const cancel = form.querySelector("[data-entry-close]");
  if (save) {
    save.disabled = isSaving;
    save.textContent = isSaving ? "Guardant..." : "Guardar futura viatgera";
  }
  if (cancel) cancel.disabled = isSaving;
}

function setMessage(form, text, type = "") {
  const message = form.querySelector("#quickLeadMessage");
  if (!message) return;
  message.classList.remove("is-error", "is-success");
  if (type) message.classList.add(`is-${type}`);
  message.textContent = text;
}

function errorMessage(error) {
  const messages = {
    AUTH_REQUIRED: "La sessió ha caducat. Torna a iniciar sessió.",
    FIRST_NAME_REQUIRED: "Introdueix el nom de la futura viatgera.",
    ENTRY_SOURCE_REQUIRED: "Selecciona el canal d’entrada abans de guardar.",
    ENTRY_DATE_FUTURE: "La data d’entrada no pot ser posterior a avui.",
    LAST_CONTACT_DATE_FUTURE: "La data de l’últim contacte no pot ser posterior a avui.",
    CONTACT_DATE_ORDER: "L’últim contacte no pot ser anterior a la data d’entrada.",
    INVALID_CONTACT_DATE: "Alguna de les dates indicades no és vàlida.",
    LEAD_SAVE_TIMEOUT: "Firestore tarda massa a respondre. Comprova la connexió i torna-ho a provar.",
    "permission-denied": "No tens permisos per crear aquest lead.",
    unavailable: "No s’ha pogut connectar amb Firestore. Revisa la connexió."
  };
  return messages[error?.message] || messages[error?.code] || "No s’ha pogut guardar la futura viatgera.";
}

async function createLeadSafely(form) {
  const user = getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");

  const data = Object.fromEntries(new FormData(form).entries());
  const selectedTrips = [...form.querySelectorAll('input[name="tripIds"]:checked')];
  const tripIds = selectedTrips.map((input) => input.value);
  const tripLabels = selectedTrips.map((input) => input.dataset.tripLabel).filter(Boolean);
  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  if (!firstName) throw new Error("FIRST_NAME_REQUIRED");
  if (!data.channel || !data.source) throw new Error("ENTRY_SOURCE_REQUIRED");

  const today = todayIso();
  if (data.entryDate && data.entryDate > today) throw new Error("ENTRY_DATE_FUTURE");
  if (data.lastContactDate && data.lastContactDate > today) throw new Error("LAST_CONTACT_DATE_FUTURE");
  if (data.entryDate && data.lastContactDate && data.lastContactDate < data.entryDate) throw new Error("CONTACT_DATE_ORDER");

  const entryDate = localDate(data.entryDate, 10);
  const lastContactDate = localDate(data.lastContactDate || data.entryDate, 12);
  const entryTimestamp = Timestamp.fromDate(entryDate);
  const lastContactTimestamp = Timestamp.fromDate(lastContactDate);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  let waitForTripDates = false;
  if (tripIds.length) {
    try {
      const trips = await getTrips();
      const selected = tripIds.map((id) => trips.find((trip) => trip.id === id)).filter(Boolean);
      waitForTripDates = selected.length > 0 && selected.every((trip) => trip.datesPending === true || (!trip.startDate && !trip.endDate));
    } catch (error) {
      console.warn("No s’han pogut comprovar les dates dels viatges.", error);
    }
  }

  const firstFollowUpAt = waitForTripDates
    ? null
    : Timestamp.fromDate(addDays(lastContactDate, FOLLOW_UP_DEFAULTS.FIRST_DAYS));
  const leadRef = doc(collection(db, "leads"));

  await withTimeout(setDoc(leadRef, {
    firstName,
    lastName,
    fullName,
    fullNameSearch: fullName.toLowerCase(),
    phone: String(data.phone || "").trim(),
    phoneNormalized: normalizePhone(data.phone),
    email: normalizeEmail(data.email),
    instagramHandle: normalizeInstagram(data.instagramHandle),
    facebookUrl: String(data.facebookUrl || "").trim(),
    channel: data.channel,
    source: data.source,
    entryPreset: data.entryPreset || "",
    tripIds,
    tripLabels,
    interest: tripLabels.join(", "),
    notes: String(data.notes || "").trim(),
    status: waitForTripDates ? LEAD_STATUSES.CONTACT_LATER : LEAD_STATUSES.NEW,
    priority: LEAD_PRIORITIES.NORMAL,
    temperature: LEAD_TEMPERATURES.WARM,
    ownerId: user.uid,
    createdBy: user.uid,
    updatedBy: user.uid,
    active: true,
    noResponseCount: 0,
    lastContactAt: lastContactTimestamp,
    nextActionTitle: waitForTripDates ? "" : "Primer seguiment pendent",
    nextActionAt: firstFollowUpAt,
    createdAt: entryTimestamp,
    updatedAt: serverTimestamp()
  }), PRIMARY_SAVE_TIMEOUT, "LEAD_SAVE_TIMEOUT");

  const batch = writeBatch(db);
  batch.set(doc(collection(db, "activities")), {
    leadId: leadRef.id,
    type: ACTIVITY_TYPES.LEAD_CREATED,
    description: `Nova consulta rebuda per ${data.entryLabel || data.channel}.`,
    channel: data.channel,
    source: data.source,
    createdBy: user.uid,
    createdAt: entryTimestamp
  });

  if (!waitForTripDates && firstFollowUpAt) {
    batch.set(doc(collection(db, "tasks")), {
      leadId: leadRef.id,
      leadName: fullName,
      tripName: tripLabels[0] || "",
      title: "Primer seguiment pendent",
      type: TASK_TYPES.FIRST_FOLLOW_UP,
      status: TASK_STATUSES.PENDING,
      automatic: true,
      sequence: 1,
      dueAt: firstFollowUpAt,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  try {
    await withTimeout(batch.commit(), SUPPORT_SAVE_TIMEOUT, "SUPPORT_SAVE_TIMEOUT");
  } catch (error) {
    console.warn("El lead s’ha guardat, però falta completar activitat o tasca inicial.", error);
  }

  return {
    id: leadRef.id,
    fullName,
    channel: data.channel,
    source: data.source,
    tripIds,
    tripLabels
  };
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("#quickLeadForm");
  if (!form) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (saving) return;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  saving = true;
  setSavingState(form, true);
  setMessage(form, "Guardant la futura viatgera...");

  try {
    const lead = await createLeadSafely(form);
    setMessage(form, `${lead.fullName} s’ha guardat correctament.`, "success");
    window.dispatchEvent(new CustomEvent("travelflow:lead-created", { detail: lead }));
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated", { detail: { source: "lead-created", leadId: lead.id } }));
    window.setTimeout(() => {
      document.querySelector("#leadEntryModal")?.classList.remove("is-open");
      document.querySelector("#leadEntryModal")?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
    }, 500);
  } catch (error) {
    console.error("No s’ha pogut crear el lead:", error);
    setMessage(form, errorMessage(error), "error");
    setSavingState(form, false);
  } finally {
    saving = false;
  }
}, true);
