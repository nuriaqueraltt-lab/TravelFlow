import { getLeadsByTrip } from "../services/lead.service.js";
import { getTripErrorMessage, getTrips, updateTripOperations } from "../services/trip.service.js";

const PROCESS_STEPS = [
  ["published", "Publicat"],
  ["sentToInterested", "Enviat a interessades"],
  ["sentToInfoGroup", "Enviat al grup informatiu"],
  ["minimumTravelersConfirmed", "Mínim de viatgeres confirmades"],
  ["secondPaymentRequested", "Demanat el segon pagament"],
  ["travelersGroupCreated", "Grup de viatgeres creat"],
  ["allSecondPaymentsPaid", "Totes han pagat el segon pagament"],
  ["flightsPurchased", "Vols comprats"],
  ["insuranceIssued", "Assegurança feta"],
  ["contractsSent", "Contractes enviats"],
  ["finalPaymentConfirmed", "Últim pagament confirmat"],
  ["travelerInvoicesCreated", "Factures de viatgeres fetes"],
  ["supplierInvoicesCorrect", "Factures de proveïdors correctes"]
];

let currentTrip = null;
let currentTripLeads = [];

const CHANNEL_LABELS = {
  WEB: "Web",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  EMAIL: "Email",
  PHONE: "Telèfon",
  OTHER: "Altres"
};

const STATUS_LABELS = {
  NEW: "Nou",
  INFO_SENT: "Informació enviada",
  FOLLOW_UP: "En seguiment",
  REPLIED: "Ha contestat",
  PENDING_DECISION: "Pendent de decisió",
  BOOKING_CONFIRMED: "Reserva confirmada",
  CONTACT_LATER: "Contactar més endavant",
  LOST: "Perdut"
};

function root() {
  return document.querySelector(".app-content");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "FV";
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function renderRows(leads) {
  if (!leads.length) {
    return `<div class="leads-empty"><h2>No hi ha leads vinculats</h2><p>Aquest viatge encara no té futures viatgeres associades.</p></div>`;
  }

  return leads.map((lead) => `
    <button class="lead-row" type="button" data-lead-id="${lead.id}">
      <span class="lead-row__person">
        <span class="lead-row__avatar">${initials(lead.fullName)}</span>
        <span>
          <strong>${escapeHtml(lead.fullName)}</strong>
          <small>${escapeHtml(lead.email || lead.phone || lead.instagramHandle || "Sense contacte")}</small>
        </span>
      </span>
      <span class="lead-row__interest">${escapeHtml(lead.tripLabels?.join(", ") || "Sense viatge")}</span>
      <span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span>
      <span class="lead-status">${STATUS_LABELS[lead.status] || lead.status}</span>
      <span class="lead-row__date">${formatDate(lead.nextActionAt)}</span>
      <span>→</span>
    </button>
  `).join("");
}

function renderProcessChecklist(trip) {
  const checklist = trip.processChecklist || {};
  return PROCESS_STEPS.map(([key, label]) => `<label class="trip-process-step ${checklist[key] === true ? "is-complete" : ""}"><input type="checkbox" name="${key}" ${checklist[key] === true ? "checked" : ""}><span><i aria-hidden="true">✓</i>${label}</span></label>`).join("");
}

function renderTripDetail(trip, leads, message = "") {
  const matching = [...leads].sort((a, b) => {
    if (a.status === "LOST" && b.status !== "LOST") return 1;
    if (a.status !== "LOST" && b.status === "LOST") return -1;
    const aDate = a.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const bDate = b.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
  const completed = PROCESS_STEPS.filter(([key]) => trip.processChecklist?.[key] === true).length;
  return `<section class="trip-detail-page">
    <header class="page-heading"><div><span class="section-kicker">Fitxa operativa del viatge</span><h1>${escapeHtml(trip.name?.replace(/^\d{4}\s*-\s*/, "") || "Viatge")}</h1><p>${formatDate(trip.startDate)} – ${formatDate(trip.endDate)} · ${matching.length} futures viatgeres vinculades.</p></div><button class="secondary-button" type="button" data-back-trips>← Tornar a Viatges</button></header>
    <section class="trip-operations-card">
      <header><div><span class="section-kicker">Organització</span><h2>Seguiment operatiu</h2></div><strong>${completed} de ${PROCESS_STEPS.length} completats</strong></header>
      <div class="trip-progress"><span style="width:${Math.round((completed / PROCESS_STEPS.length) * 100)}%"></span></div>
      <form id="tripOperationsForm" data-trip-id="${trip.id}">
        <label class="form-field trip-tour-leader"><span>Tour Leader · Coordinadora del viatge</span><input name="tourLeaderName" type="text" value="${escapeHtml(trip.tourLeaderName || "")}" placeholder="Nom de la coordinadora"></label>
        <fieldset class="trip-process-list"><legend>Checklist del viatge</legend>${renderProcessChecklist(trip)}</fieldset>
        <div class="trip-operations-actions"><p class="quick-lead-form__message ${message ? "is-success" : ""}" id="tripOperationsMessage">${escapeHtml(message)}</p><button class="primary-button primary-button--compact" type="submit">Guardar canvis</button></div>
      </form>
    </section>
    <section class="trip-travelers-section"><header><div><span class="section-kicker">Seguiment comercial</span><h2>Reserves i interessades</h2></div><span>${matching.filter((lead) => lead.status === "BOOKING_CONFIRMED").length} reserves confirmades</span></header><section class="leads-table-card"><div class="leads-table-head"><span>Futura viatgera</span><span>Viatges</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div>${renderRows(matching)}</div></section></section>
  </section>`;
}

export async function showLeadsForTrip(tripId) {
  const container = root();
  if (!container || !tripId) return;

  container.innerHTML = `<section class="leads-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant els leads del viatge...</p></div></section>`;

  try {
    const [leads, trips] = await Promise.all([getLeadsByTrip(tripId), getTrips()]);
    currentTrip = trips.find((item) => item.id === tripId);
    currentTripLeads = leads;
    if (!currentTrip) throw new Error("TRIP_REQUIRED");
    container.innerHTML = renderTripDetail(currentTrip, currentTripLeads);
  } catch (error) {
    console.error("No s'han pogut carregar els leads del viatge:", error);
    container.innerHTML = `<div class="leads-error">No s'han pogut carregar els leads d'aquest viatge.</div>`;
  }
}

document.addEventListener("change", (event) => {
  const step = event.target.closest?.("#tripOperationsForm .trip-process-step input");
  if (step) step.closest(".trip-process-step").classList.toggle("is-complete", step.checked);
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.id !== "tripOperationsForm") return;
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const message = form.querySelector("#tripOperationsMessage");
  const data = new FormData(form);
  submit.disabled = true;
  message.className = "quick-lead-form__message";
  message.textContent = "Guardant...";
  try {
    const updated = await updateTripOperations(form.dataset.tripId, {
      tourLeaderName: data.get("tourLeaderName") || "",
      processChecklist: Object.fromEntries(PROCESS_STEPS.map(([key]) => [key, data.has(key)]))
    });
    currentTrip = { ...currentTrip, ...updated };
    root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, "Canvis guardats correctament.");
  } catch (error) {
    submit.disabled = false;
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});
