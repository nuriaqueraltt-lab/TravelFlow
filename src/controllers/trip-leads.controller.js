import { getLeadsByTrip } from "../services/lead.service.js";
import { getTripById, getTripErrorMessage, TRIP_PROCESS_STEPS, updateTripOperations } from "../services/trip.service.js";
import { getTripInterestStatus } from "../services/trip-interest.model.js";

let currentTrip = null;
let currentTripLeads = [];
let currentTripTab = "summary";

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

const TAB_LABELS = {
  summary: "Resum",
  leads: "Leads",
  bookings: "Reserves",
  operations: "Operativa",
  analytics: "Analítica"
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

function getSortedLeads(trip, leads) {
  return leads.map((lead) => ({ ...lead, status: getTripInterestStatus(lead, trip.id) })).sort((a, b) => {
    if (a.status === "LOST" && b.status !== "LOST") return 1;
    if (a.status !== "LOST" && b.status === "LOST") return -1;
    const aDate = a.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const bDate = b.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

function renderRows(leads, { bookingsOnly = false } = {}) {
  if (!leads.length) {
    return `<div class="leads-empty"><h2>${bookingsOnly ? "Encara no hi ha reserves" : "No hi ha leads vinculats"}</h2><p>${bookingsOnly ? "Quan una interessada confirmi la reserva apareixerà aquí." : "Aquest viatge encara no té futures viatgeres associades."}</p></div>`;
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
  return TRIP_PROCESS_STEPS.map(([key, label]) => `<label class="trip-process-step ${checklist[key] === true ? "is-complete" : ""}"><input type="checkbox" name="${key}" ${checklist[key] === true ? "checked" : ""}><span><i aria-hidden="true">✓</i>${label}</span></label>`).join("");
}

function renderTabs(activeTab) {
  return `<nav class="trip-detail-tabs" aria-label="Apartats de la fitxa del viatge">${Object.entries(TAB_LABELS).map(([key, label]) => `<button type="button" data-trip-tab="${key}" class="${activeTab === key ? "is-active" : ""}">${label}</button>`).join("")}</nav>`;
}

function renderSummary(trip, leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED");
  const lost = leads.filter((lead) => lead.status === "LOST");
  const active = leads.filter((lead) => !["BOOKING_CONFIRMED", "LOST"].includes(lead.status));
  const completed = TRIP_PROCESS_STEPS.filter(([key]) => trip.processChecklist?.[key] === true).length;
  const nextStep = TRIP_PROCESS_STEPS.find(([key]) => trip.processChecklist?.[key] !== true)?.[1] || "Checklist complet";
  const conversion = leads.length ? Math.round((bookings.length / leads.length) * 100) : 0;

  return `<section class="trip-summary-view">
    <section class="trip-summary-grid">
      <article><span>Leads totals</span><strong>${leads.length}</strong><small>${active.length} encara actius</small></article>
      <article><span>Reserves confirmades</span><strong>${bookings.length}</strong><small>${conversion}% de conversió</small></article>
      <article><span>Leads perduts</span><strong>${lost.length}</strong><small>${leads.length ? Math.round((lost.length / leads.length) * 100) : 0}% del total</small></article>
      <article><span>Operativa completada</span><strong>${completed}/${TRIP_PROCESS_STEPS.length}</strong><small>${escapeHtml(nextStep)}</small></article>
    </section>
    <section class="trip-overview-card">
      <div class="trip-overview-card__main">
        <span class="section-kicker">Situació actual</span>
        <h2>${escapeHtml(trip.tourLeaderName || "Coordinadora pendent d’assignar")}</h2>
        <p>${escapeHtml({ AVAILABLE: "El viatge encara té places disponibles.", CONFIRMED: "El grup està confirmat.", FULL: "El grup està complet." }[trip.groupStatus || "AVAILABLE"])}</p>
      </div>
      <dl>
        <div><dt>Inici</dt><dd>${formatDate(trip.startDate)}</dd></div>
        <div><dt>Final</dt><dd>${formatDate(trip.endDate)}</dd></div>
        <div><dt>Tancament comercial</dt><dd>${formatDate(trip.closingDate)}</dd></div>
        <div><dt>Pròxima acció operativa</dt><dd>${escapeHtml(nextStep)}</dd></div>
      </dl>
    </section>
    <section class="trip-quick-access">
      <button type="button" data-trip-tab="leads"><strong>Gestionar leads</strong><span>${active.length} interessades actives →</span></button>
      <button type="button" data-trip-tab="bookings"><strong>Veure reserves</strong><span>${bookings.length} viatgeres confirmades →</span></button>
      <button type="button" data-trip-tab="operations"><strong>Continuar operativa</strong><span>${completed} passos completats →</span></button>
    </section>
  </section>`;
}

function renderLeadsView(leads) {
  return `<section class="trip-travelers-section"><header><div><span class="section-kicker">Seguiment comercial</span><h2>Leads del viatge</h2></div><span>${leads.length} persones vinculades</span></header><section class="leads-table-card"><div class="leads-table-head"><span>Futura viatgera</span><span>Viatges</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div>${renderRows(leads)}</div></section></section>`;
}

function renderBookingsView(leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED");
  return `<section class="trip-travelers-section"><header><div><span class="section-kicker">Viatgeres confirmades</span><h2>Reserves</h2></div><span>${bookings.length} reserves confirmades</span></header><section class="leads-table-card"><div class="leads-table-head"><span>Viatgera</span><span>Viatges</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div>${renderRows(bookings, { bookingsOnly: true })}</div></section></section>`;
}

function renderOperationsView(trip, message = "") {
  const completed = TRIP_PROCESS_STEPS.filter(([key]) => trip.processChecklist?.[key] === true).length;
  return `<section class="trip-operations-card">
    <header><div><span class="section-kicker">Organització</span><h2>Seguiment operatiu</h2></div><strong>${completed} de ${TRIP_PROCESS_STEPS.length} completats</strong></header>
    <div class="trip-progress"><span style="width:${Math.round((completed / TRIP_PROCESS_STEPS.length) * 100)}%"></span></div>
    <form id="tripOperationsForm" data-trip-id="${trip.id}">
      <div class="trip-operations-fields"><label class="form-field trip-tour-leader"><span>Tour Leader · Coordinadora del viatge</span><input name="tourLeaderName" type="text" value="${escapeHtml(trip.tourLeaderName || "")}" placeholder="Nom de la coordinadora"></label><label class="form-field trip-group-status"><span>Estat del grup</span><select name="groupStatus"><option value="AVAILABLE" ${(trip.groupStatus || "AVAILABLE") === "AVAILABLE" ? "selected" : ""}>Places disponibles</option><option value="CONFIRMED" ${trip.groupStatus === "CONFIRMED" ? "selected" : ""}>Grup confirmat</option><option value="FULL" ${trip.groupStatus === "FULL" ? "selected" : ""}>Grup complet</option></select></label></div>
      <fieldset class="trip-process-list"><legend>Checklist del viatge</legend>${renderProcessChecklist(trip)}</fieldset>
      <div class="trip-operations-actions"><p class="quick-lead-form__message ${message ? "is-success" : ""}" id="tripOperationsMessage">${escapeHtml(message)}</p><button class="primary-button primary-button--compact" type="submit">Guardar canvis</button></div>
    </form>
  </section>`;
}

function renderAnalyticsView(leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
  const channelCounts = Object.entries(leads.reduce((acc, lead) => {
    const channel = lead.channel || "OTHER";
    acc[channel] = (acc[channel] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const maxChannel = Math.max(...channelCounts.map(([, count]) => count), 1);
  const statusCounts = Object.entries(leads.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  return `<section class="trip-analytics-view">
    <section class="trip-analytics-highlight"><span class="section-kicker">Conversió del viatge</span><strong>${leads.length ? Math.round((bookings / leads.length) * 100) : 0}%</strong><p>${bookings} reserves de ${leads.length} leads vinculats.</p></section>
    <section class="trip-analytics-grid">
      <article><header><h2>Leads per canal</h2><span>${channelCounts.length} canals</span></header><div class="trip-bars">${channelCounts.length ? channelCounts.map(([channel, count]) => `<div><span>${CHANNEL_LABELS[channel] || "Altres"}</span><i><b style="width:${Math.round((count / maxChannel) * 100)}%"></b></i><strong>${count}</strong></div>`).join("") : "<p>Encara no hi ha dades.</p>"}</div></article>
      <article><header><h2>Estats comercials</h2><span>${leads.length} leads</span></header><ul class="trip-status-list">${statusCounts.length ? statusCounts.map(([status, count]) => `<li><span>${STATUS_LABELS[status] || status}</span><strong>${count}</strong></li>`).join("") : "<li>Encara no hi ha dades.</li>"}</ul></article>
    </section>
  </section>`;
}

function renderActiveTab(trip, leads, message = "") {
  if (currentTripTab === "leads") return renderLeadsView(leads);
  if (currentTripTab === "bookings") return renderBookingsView(leads);
  if (currentTripTab === "operations") return renderOperationsView(trip, message);
  if (currentTripTab === "analytics") return renderAnalyticsView(leads);
  return renderSummary(trip, leads);
}

function renderTripDetail(trip, leads, message = "") {
  const matching = getSortedLeads(trip, leads);
  const bookings = matching.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
  return `<section class="trip-detail-page">
    <button class="trip-detail-back" type="button" data-back-trips>← Tornar a Viatges</button>
    <header class="page-heading"><div><span class="section-kicker">Fitxa central del viatge</span><h1>${escapeHtml(trip.name?.replace(/^\d{4}\s*-\s*/, "") || "Viatge")}</h1><p>${formatDate(trip.startDate)} – ${formatDate(trip.endDate)} · ${matching.length} leads · ${bookings} reserves.</p></div></header>
    ${renderTabs(currentTripTab)}
    <div class="trip-detail-content">${renderActiveTab(trip, matching, message)}</div>
  </section>`;
}

export async function showLeadsForTrip(tripId) {
  const container = root();
  if (!container || !tripId) return;

  currentTripTab = "summary";
  container.innerHTML = `<section class="leads-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant la fitxa del viatge...</p></div></section>`;

  try {
    const [leads, trip] = await Promise.all([getLeadsByTrip(tripId), getTripById(tripId)]);
    currentTrip = trip;
    currentTripLeads = leads;
    container.innerHTML = renderTripDetail(currentTrip, currentTripLeads);
  } catch (error) {
    console.error("No s'ha pogut carregar la fitxa del viatge:", error);
    container.innerHTML = `<div class="leads-error">No s'ha pogut carregar la fitxa d'aquest viatge.</div>`;
  }
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest?.("[data-trip-tab]");
  if (!tabButton || !currentTrip) return;
  currentTripTab = tabButton.dataset.tripTab;
  root().innerHTML = renderTripDetail(currentTrip, currentTripLeads);
});

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
      groupStatus: data.get("groupStatus") || "AVAILABLE",
      processChecklist: Object.fromEntries(TRIP_PROCESS_STEPS.map(([key]) => [key, data.has(key)]))
    });
    currentTrip = { ...currentTrip, ...updated };
    root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, "Canvis guardats correctament.");
  } catch (error) {
    submit.disabled = false;
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});
