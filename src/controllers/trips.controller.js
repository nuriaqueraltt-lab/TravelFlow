import { createTripTag, getTripErrorMessage, getTrips, seedInitialTrips, TRIP_PROCESS_STEPS, updateTripDates } from "../services/trip.service.js";
import { showLeadsForTrip } from "./trip-leads.controller.js?v=20260721-2";
import { getConfirmedBookings } from "../services/lead.service.js";
import { isBookedForTrip } from "../services/trip-interest.model.js";
import { getClients } from "../services/client.service.js";

let tripsCache = [];

function getRoot() { return document.querySelector(".app-content"); }
function formatDate(value) { if (!value) return "Pendent"; return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function normalizeText(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }

function renderTripRows(trips) {
  if (!trips.length) return `<div class="leads-empty"><h2>No hi ha coincidències</h2><p>Prova una altra cerca o crea una nova etiqueta de viatge.</p></div>`;
  return trips.map((trip) => `<article class="trip-management-row" data-trip-id="${trip.id}" data-trip-name="${escapeHtml(trip.name)}" data-start-date="${trip.startDate || ""}" data-end-date="${trip.endDate || ""}" data-closing-date="${trip.closingDate || ""}" data-image-url="${escapeHtml(trip.imageUrl || "")}"><div class="trip-management-row__name"><strong>${escapeHtml(trip.name)}</strong><span class="trip-year-badge">${trip.year || "—"}</span></div><div class="trip-management-row__dates"><span>${trip.startDate ? `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}` : "Dates pendents"}</span><small>${trip.closingDate ? `Tancament: ${formatDate(trip.closingDate)}` : "Tancament pendent"}</small></div><button class="secondary-button trip-edit-button" type="button" data-edit-trip>Editar</button></article>`).join("");
}

function renderTripsView(trips) {
  return `<section class="trips-management-page"><header class="page-heading"><div><span class="section-kicker">Configuració comercial</span><h1>Etiquetes de viatge</h1><p>Crea i gestiona els viatges que es poden assignar als leads.</p></div><button class="primary-button primary-button--compact" type="button" data-create-trip>+ Nou viatge</button></header><nav class="trips-section-tabs" aria-label="Apartats de viatges"><button type="button" data-open-trips-hub>Viatges actuals</button><button class="is-active" type="button">Etiquetes de viatge</button></nav><section class="trips-management-summary"><div><strong>${trips.length}</strong><span>Etiquetes totals</span></div><div><strong>${trips.filter((trip) => !trip.startDate || !trip.endDate).length}</strong><span>Amb dates pendents</span></div></section><section class="trips-management-search"><label><span>Buscar viatge</span><input id="tripsSearch" type="search" placeholder="Nom o any del viatge..." autocomplete="off" /></label><div><strong id="tripsVisibleCount">${trips.length}</strong><span> visibles</span></div></section><section class="trips-management-card"><div class="trips-management-head"><span>Viatge</span><span>Dates i tancament</span><span></span></div><div id="tripRows">${renderTripRows(trips)}</div></section></section>`;
}

function currentTrips(trips) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return trips
    .filter((trip) => trip.endDate && trip.endDate >= today)
    .sort((a, b) => String(a.startDate || "9999-12-31").localeCompare(String(b.startDate || "9999-12-31")));
}

function clientForBooking(booking, clients) {
  return clients.find((client) => client.id === booking.clientId || client.leadIds?.includes(booking.id));
}

function renderBookingList(bookings, tripId, clients) {
  if (!bookings.length) return `<p class="trips-hub-card__empty">Encara no hi ha reserves confirmades.</p>`;
  return `<ul class="trips-hub-bookings">${bookings.map((booking) => { const client = clientForBooking(booking, clients); const dui = booking.tripInterests?.[tripId]?.dui ?? (booking.bookingTripId === tripId ? booking.bookingDui : undefined); return `<li><button type="button" ${client ? `data-open-client-id="${client.id}"` : `data-lead-id="${booking.id}"`}>${escapeHtml(client?.fullName || booking.fullName)}</button><span class="${dui === true ? "is-dui" : ""}">${typeof dui === "boolean" ? `DUI: ${dui ? "Sí" : "No"}` : "DUI pendent"}</span></li>`; }).join("")}</ul>`;
}

function bookingsForTrip(bookings, tripId) {
  return bookings.filter((booking) => isBookedForTrip(booking, tripId));
}

function processSummary(trip) {
  const checklist = trip.processChecklist || {};
  const completed = TRIP_PROCESS_STEPS.filter(([key]) => checklist[key] === true);
  const next = TRIP_PROCESS_STEPS.find(([key]) => checklist[key] !== true);
  return { last: completed.at(-1)?.[1] || "Encara cap", next: next?.[1] || "Checklist complet" };
}

function groupStatusLabel(status = "AVAILABLE") {
  return { AVAILABLE: "Places disponibles", CONFIRMED: "Grup confirmat", FULL: "Grup complet" }[status] || "Places disponibles";
}

function renderCurrentTripCards(trips, bookings, clients) {
  if (!trips.length) return `<div class="leads-empty"><h2>No hi ha viatges actuals</h2><p>Configura les dates des de l'apartat Etiquetes.</p></div>`;
  return trips.map((trip) => {
    const process = processSummary(trip);
    return `
    <article class="trips-hub-card">
      <div class="trips-hub-card__image" style="--trip-image: url('${escapeHtml(trip.imageUrl || "")}')"><span>${trip.year || "—"}</span><span class="trip-group-badge trip-group-badge--${String(trip.groupStatus || "AVAILABLE").toLowerCase()}">${groupStatusLabel(trip.groupStatus)}</span></div>
      <div class="trips-hub-card__content">
        <div><strong>${escapeHtml(trip.name.replace(/^\d{4}\s*-\s*/, ""))}</strong><span>${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}</span><span class="trips-hub-card__leader">Tour Leader: <b>${escapeHtml(trip.tourLeaderName || "Pendent d'assignar")}</b></span></div>
        <dl class="trips-hub-process"><div><dt>Última acció</dt><dd>${escapeHtml(process.last)}</dd></div><div><dt>Pròxima acció</dt><dd>${escapeHtml(process.next)}</dd></div></dl>
        <section class="trips-hub-card__bookings"><h3>Reserves confirmades</h3>${renderBookingList(bookingsForTrip(bookings, trip.id), trip.id, clients)}</section>
        <button class="secondary-button" type="button" data-open-trip="${trip.id}">Obrir fitxa del viatge →</button>
      </div>
    </article>
  `; }).join("");
}

function renderTripsHub(trips, bookings, clients) {
  const activeTrips = currentTrips(trips);
  return `<section class="trips-hub-page">
    <header class="page-heading"><div><span class="section-kicker">Gestió de viatges</span><h1>Viatges actuals</h1><p>Consulta els viatges programats i les futures viatgeres vinculades.</p></div><button class="secondary-button" type="button" data-open-trip-tags>Gestionar etiquetes</button></header>
    <nav class="trips-section-tabs" aria-label="Apartats de viatges"><button class="is-active" type="button">Viatges actuals</button><button type="button" data-open-trip-tags>Etiquetes de viatge</button></nav>
    <section class="trips-hub-summary"><div><strong>${activeTrips.length}</strong><span>Viatges actuals</span></div><div><strong>${trips.filter((trip) => !trip.startDate || !trip.endDate).length}</strong><span>Pendents de dates</span></div></section>
    <section class="trips-hub-grid">${renderCurrentTripCards(activeTrips, bookings, clients)}</section>
  </section>`;
}

function renderTripForm({ mode, row = null }) {
  const isCreate = mode === "create";
  return `<div class="trip-date-modal is-open" id="tripDateModal"><button class="trip-date-modal__backdrop" type="button" data-close-trip-modal></button><section class="trip-date-panel" role="dialog" aria-modal="true"><button class="trip-date-panel__close" type="button" data-close-trip-modal>×</button><span class="section-kicker">${isCreate ? "Nou viatge" : "Editar viatge"}</span><h2>${isCreate ? "Crear etiqueta de viatge" : escapeHtml(row.dataset.tripName)}</h2><form id="${isCreate ? "tripCreateForm" : "tripDateForm"}" ${isCreate ? "" : `data-trip-id="${row.dataset.tripId}"`}>
  ${isCreate ? `<label class="form-field"><span>Nom del viatge *</span><input name="name" type="text" placeholder="Ex. Japó 2027" required></label>` : ""}
  <label class="form-field"><span>Data d'inici</span><input name="startDate" type="date" value="${row?.dataset.startDate || ""}"><small>La pots deixar pendent en crear el viatge.</small></label>
  <label class="form-field"><span>Data de finalització</span><input name="endDate" type="date" value="${row?.dataset.endDate || ""}"></label>
  <label class="form-field"><span>Data de tancament comercial</span><input name="closingDate" type="date" value="${row?.dataset.closingDate || ""}"><small>A partir d'aquesta data es generarà l'acció «Viatge tancat».</small></label>
  <label class="form-field"><span>URL de la imatge</span><input name="imageUrl" type="url" value="${escapeHtml(row?.dataset.imageUrl || "")}" placeholder="Opcional"></label>
  <div class="quick-lead-form__actions"><button class="secondary-button" type="button" data-close-trip-modal>Cancel·lar</button><button class="primary-button primary-button--compact" type="submit">${isCreate ? "Crear viatge" : "Guardar"}</button></div><p class="quick-lead-form__message" id="tripDateMessage"></p></form></section></div>`;
}

function filterTrips() {
  const query = normalizeText(document.querySelector("#tripsSearch")?.value || "");
  const filtered = tripsCache.filter((trip) => !query || normalizeText(`${trip.name} ${trip.year || ""}`).includes(query));
  const rows = document.querySelector("#tripRows");
  const count = document.querySelector("#tripsVisibleCount");
  if (rows) rows.innerHTML = renderTripRows(filtered);
  if (count) count.textContent = filtered.length;
}

function setTripsActive() { document.querySelectorAll(".sidebar-nav__item").forEach((button) => button.classList.toggle("is-active", button.textContent.trim().startsWith("Viatges"))); }
async function loadTrips() { await seedInitialTrips(); tripsCache = await getTrips(); return tripsCache; }
async function showTripsHub() { const root = getRoot(); if (!root) return; root.innerHTML = '<section class="trips-hub-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant viatges...</p></div></section>'; try { const [trips, bookings, clients] = await Promise.all([loadTrips(), getConfirmedBookings(), getClients()]); root.innerHTML = renderTripsHub(trips, bookings, clients); } catch (error) { root.innerHTML = `<section class="trips-hub-page"><div class="leads-error">${getTripErrorMessage(error)}</div></section>`; } }
async function showTripTags() { const root = getRoot(); if (!root) return; root.innerHTML = '<section class="trips-management-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant etiquetes...</p></div></section>'; try { root.innerHTML = renderTripsView(await loadTrips()); } catch (error) { root.innerHTML = `<section class="trips-management-page"><div class="leads-error">${getTripErrorMessage(error)}</div></section>`; } }

document.addEventListener("click", (event) => {
  const navButton = event.target.closest(".sidebar-nav__item");
  const createButton = event.target.closest("[data-create-trip]");
  const editButton = event.target.closest("[data-edit-trip]");
  const closeButton = event.target.closest("[data-close-trip-modal]");
  const tagsButton = event.target.closest("[data-open-trip-tags]");
  const hubButton = event.target.closest("[data-open-trips-hub]");
  const tripButton = event.target.closest("[data-open-trip]");
  const backButton = event.target.closest("[data-back-trips]");
  if (navButton?.textContent.trim().startsWith("Viatges") || backButton) { setTripsActive(); showTripsHub(); return; }
  if (hubButton) { setTripsActive(); showTripsHub(); return; }
  if (tagsButton) { setTripsActive(); showTripTags(); return; }
  if (tripButton) { setTripsActive(); showLeadsForTrip(tripButton.dataset.openTrip); return; }
  if (createButton) { document.body.insertAdjacentHTML("beforeend", renderTripForm({ mode: "create" })); return; }
  if (editButton) { document.body.insertAdjacentHTML("beforeend", renderTripForm({ mode: "edit", row: editButton.closest("[data-trip-id]") })); return; }
  if (closeButton) document.querySelector("#tripDateModal")?.remove();
});

document.addEventListener("input", (event) => {
  if (event.target.id === "tripsSearch") filterTrips();
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["tripCreateForm", "tripDateForm"].includes(form.id)) return;
  event.preventDefault();
  const message = form.querySelector("#tripDateMessage");
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === "tripCreateForm") await createTripTag(data);
    else await updateTripDates(form.dataset.tripId, data);
    document.querySelector("#tripDateModal")?.remove();
    await showTripTags();
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) {
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});
