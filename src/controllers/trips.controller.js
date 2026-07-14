import { createTripTag, getTripErrorMessage, getTrips, seedInitialTrips, updateTripDates } from "../services/trip.service.js";

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
  return `<section class="trips-management-page"><header class="page-heading"><div><span class="section-kicker">Configuració comercial</span><h1>Etiquetes de viatge</h1><p>Crea i gestiona els viatges que es poden assignar als leads.</p></div><button class="primary-button primary-button--compact" type="button" data-create-trip>+ Nou viatge</button></header><section class="trips-management-summary"><div><strong>${trips.length}</strong><span>Etiquetes totals</span></div><div><strong>${trips.filter((trip) => !trip.startDate || !trip.endDate).length}</strong><span>Amb dates pendents</span></div></section><section class="trips-management-search"><label><span>Buscar viatge</span><input id="tripsSearch" type="search" placeholder="Nom o any del viatge..." autocomplete="off" /></label><div><strong id="tripsVisibleCount">${trips.length}</strong><span> visibles</span></div></section><section class="trips-management-card"><div class="trips-management-head"><span>Viatge</span><span>Dates i tancament</span><span></span></div><div id="tripRows">${renderTripRows(trips)}</div></section></section>`;
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
async function showTripsView() { const root = getRoot(); if (!root) return; root.innerHTML = '<section class="trips-management-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant viatges...</p></div></section>'; try { await seedInitialTrips(); tripsCache = await getTrips({ force: true }); root.innerHTML = renderTripsView(tripsCache); } catch (error) { root.innerHTML = `<section class="trips-management-page"><div class="leads-error">${getTripErrorMessage(error)}</div></section>`; } }
function enableTripsButton() { const button = [...document.querySelectorAll(".sidebar-nav__item")].find((item) => item.textContent.trim().startsWith("Viatges")); if (!button) return; button.disabled = false; button.querySelector("small")?.remove(); }
const observer = new MutationObserver(enableTripsButton); observer.observe(document.body, { childList: true, subtree: true }); enableTripsButton();

document.addEventListener("click", (event) => {
  const navButton = event.target.closest(".sidebar-nav__item");
  const createButton = event.target.closest("[data-create-trip]");
  const editButton = event.target.closest("[data-edit-trip]");
  const closeButton = event.target.closest("[data-close-trip-modal]");
  if (navButton?.textContent.trim().startsWith("Viatges")) { setTripsActive(); showTripsView(); return; }
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
    await showTripsView();
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) {
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});