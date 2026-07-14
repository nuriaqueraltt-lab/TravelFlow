import {
  getTripErrorMessage,
  getTrips,
  seedInitialTrips,
  updateTripDates
} from "../services/trip.service.js";

function getRoot() {
  return document.querySelector(".app-content");
}

function formatDate(value) {
  if (!value) return "Dates pendents";
  return new Intl.DateTimeFormat("ca-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

function renderTripRows(trips) {
  return trips
    .map(
      (trip) => `
        <article class="trip-management-row" data-trip-id="${trip.id}">
          <div class="trip-management-row__name">
            <strong>${trip.name}</strong>
            <span class="trip-year-badge">${trip.year || "—"}</span>
          </div>
          <div class="trip-management-row__dates">
            <span>${trip.startDate ? `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}` : "Dates pendents"}</span>
            ${trip.datesPending ? '<small class="trip-pending-badge">Pendent</small>' : ""}
          </div>
          <button class="secondary-button trip-edit-button" type="button" data-edit-trip>Editar dates</button>
        </article>
      `
    )
    .join("");
}

function renderTripsView(trips) {
  const pending = trips.filter((trip) => trip.datesPending).length;

  return `
    <section class="trips-management-page">
      <header class="page-heading">
        <div>
          <span class="section-kicker">Configuració comercial</span>
          <h1>Etiquetes de viatge</h1>
          <p>Gestiona els viatges vinculats als leads i les dates que controlen el calendari de seguiment.</p>
        </div>
      </header>

      <section class="trips-management-summary">
        <div><strong>${trips.length}</strong><span>Etiquetes totals</span></div>
        <div><strong>${pending}</strong><span>Amb dates pendents</span></div>
      </section>

      <section class="trips-management-card">
        <div class="trips-management-head">
          <span>Viatge</span><span>Dates</span><span></span>
        </div>
        <div>${renderTripRows(trips)}</div>
      </section>
    </section>
  `;
}

function renderEditForm(tripId, tripName) {
  return `
    <div class="trip-date-modal is-open" id="tripDateModal">
      <button class="trip-date-modal__backdrop" type="button" data-close-trip-modal></button>
      <section class="trip-date-panel" role="dialog" aria-modal="true">
        <button class="trip-date-panel__close" type="button" data-close-trip-modal>×</button>
        <span class="section-kicker">Editar dates</span>
        <h2>${tripName}</h2>
        <form id="tripDateForm" data-trip-id="${tripId}">
          <label class="form-field"><span>Data d'inici</span><input name="startDate" type="date" required /></label>
          <label class="form-field"><span>Data de finalització</span><input name="endDate" type="date" required /></label>
          <div class="quick-lead-form__actions">
            <button class="secondary-button" type="button" data-close-trip-modal>Cancel·lar</button>
            <button class="primary-button primary-button--compact" type="submit">Guardar dates</button>
          </div>
          <p class="quick-lead-form__message" id="tripDateMessage"></p>
        </form>
      </section>
    </div>
  `;
}

function setTripsActive() {
  document.querySelectorAll(".sidebar-nav__item").forEach((button) => {
    button.classList.toggle("is-active", button.textContent.trim().startsWith("Viatges"));
  });
}

async function showTripsView() {
  const root = getRoot();
  if (!root) return;
  root.innerHTML = '<section class="trips-management-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant etiquetes de viatge...</p></div></section>';

  try {
    await seedInitialTrips();
    const trips = await getTrips();
    root.innerHTML = renderTripsView(trips);
  } catch (error) {
    root.innerHTML = `<section class="trips-management-page"><div class="leads-error">${getTripErrorMessage(error)}</div></section>`;
  }
}

function enableTripsButton() {
  const button = [...document.querySelectorAll(".sidebar-nav__item")]
    .find((item) => item.textContent.trim().startsWith("Viatges"));
  if (!button) return;
  button.disabled = false;
  button.querySelector("small")?.remove();
}

const observer = new MutationObserver(enableTripsButton);
observer.observe(document.body, { childList: true, subtree: true });
enableTripsButton();

document.addEventListener("click", (event) => {
  const navButton = event.target.closest(".sidebar-nav__item");
  const editButton = event.target.closest("[data-edit-trip]");
  const closeButton = event.target.closest("[data-close-trip-modal]");

  if (navButton?.textContent.trim().startsWith("Viatges")) {
    setTripsActive();
    showTripsView();
    return;
  }

  if (editButton) {
    const row = editButton.closest("[data-trip-id]");
    const name = row.querySelector("strong")?.textContent || "Viatge";
    document.body.insertAdjacentHTML("beforeend", renderEditForm(row.dataset.tripId, name));
    return;
  }

  if (closeButton) document.querySelector("#tripDateModal")?.remove();
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "tripDateForm") return;
  event.preventDefault();

  const form = event.target;
  const message = form.querySelector("#tripDateMessage");
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    await updateTripDates(form.dataset.tripId, data);
    document.querySelector("#tripDateModal")?.remove();
    await showTripsView();
  } catch (error) {
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});