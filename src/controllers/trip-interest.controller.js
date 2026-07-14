import { createTripTag, getTripErrorMessage, getTrips } from "../services/trip.service.js";

let tripsCache = [];

function formatTripDates(trip) {
  if (!trip.startDate && !trip.endDate) return "Sense dates";
  return `${trip.startDate || "?"} → ${trip.endDate || "?"}`;
}

function renderTripOptions() {
  if (!tripsCache.length) {
    return `<p class="trip-tags-empty">Encara no hi ha etiquetes de viatge. Crea'n la primera aquí sota.</p>`;
  }

  return tripsCache
    .map(
      (trip) => `
        <label class="trip-tag-option">
          <input type="checkbox" value="${trip.id}" data-trip-name="${trip.name}" />
          <span>
            <strong>${trip.name}</strong>
            <small>${formatTripDates(trip)}</small>
          </span>
        </label>
      `
    )
    .join("");
}

function renderTripSelector() {
  return `
    <div class="trip-interest-field quick-lead-form__wide" data-trip-interest>
      <div class="trip-interest-field__heading">
        <div>
          <span>Viatges d'interès</span>
          <small>Pots seleccionar més d'una etiqueta.</small>
        </div>
        <button class="link-button" type="button" data-toggle-new-trip>+ Crear etiqueta</button>
      </div>

      <div class="trip-tag-options" data-trip-options>${renderTripOptions()}</div>

      <div class="trip-tag-create" data-new-trip-form hidden>
        <label class="form-field">
          <span>Nom del viatge</span>
          <div class="form-control form-control--plain">
            <input type="text" data-trip-name-input placeholder="Ex. Irlanda 2027" />
          </div>
        </label>
        <label class="form-field">
          <span>Data d'inici</span>
          <div class="form-control form-control--plain">
            <input type="date" data-trip-start-input />
          </div>
        </label>
        <label class="form-field">
          <span>Data de finalització</span>
          <div class="form-control form-control--plain">
            <input type="date" data-trip-end-input />
          </div>
        </label>
        <button class="secondary-button" type="button" data-create-trip-tag>Guardar etiqueta</button>
        <p class="trip-tag-create__message" data-trip-message role="status"></p>
      </div>

      <input type="hidden" name="tripIds" value="[]" />
      <input type="hidden" name="tripLabels" value="[]" />
    </div>
  `;
}

async function loadTrips() {
  try {
    tripsCache = await getTrips();
  } catch (error) {
    console.error("No s'han pogut carregar les etiquetes de viatge:", error);
    tripsCache = [];
  }
}

async function enhanceCurrentLeadForm() {
  const form = document.querySelector("#quickLeadForm");
  if (!form || form.querySelector("[data-trip-interest]")) return;

  await loadTrips();
  const oldInterest = form.querySelector("input[name='interest']")?.closest("label");
  if (!oldInterest) return;
  oldInterest.outerHTML = renderTripSelector();
}

function syncSelectedTrips(form) {
  const selected = [...form.querySelectorAll("[data-trip-options] input:checked")];
  const ids = selected.map((input) => input.value);
  const labels = selected.map((input) => input.dataset.tripName);
  form.querySelector("input[name='tripIds']").value = JSON.stringify(ids);
  form.querySelector("input[name='tripLabels']").value = JSON.stringify(labels);
}

document.addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-entry-source]");
  const toggleButton = event.target.closest("[data-toggle-new-trip]");
  const createButton = event.target.closest("[data-create-trip-tag]");

  if (sourceButton) {
    window.setTimeout(enhanceCurrentLeadForm, 0);
    return;
  }

  if (toggleButton) {
    const wrapper = toggleButton.closest("[data-trip-interest]");
    const panel = wrapper?.querySelector("[data-new-trip-form]");
    if (panel) panel.hidden = !panel.hidden;
    return;
  }

  if (createButton) {
    const wrapper = createButton.closest("[data-trip-interest]");
    const nameInput = wrapper.querySelector("[data-trip-name-input]");
    const startInput = wrapper.querySelector("[data-trip-start-input]");
    const endInput = wrapper.querySelector("[data-trip-end-input]");
    const message = wrapper.querySelector("[data-trip-message]");

    createButton.disabled = true;
    message.textContent = "Guardant etiqueta...";

    try {
      const trip = await createTripTag({
        name: nameInput.value,
        startDate: startInput.value,
        endDate: endInput.value
      });
      tripsCache.push(trip);
      tripsCache.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
      wrapper.querySelector("[data-trip-options]").innerHTML = renderTripOptions();
      const createdInput = wrapper.querySelector(`[data-trip-options] input[value="${trip.id}"]`);
      if (createdInput) createdInput.checked = true;
      nameInput.value = "";
      startInput.value = "";
      endInput.value = "";
      wrapper.querySelector("[data-new-trip-form]").hidden = true;
      message.textContent = "";
    } catch (error) {
      message.textContent = getTripErrorMessage(error);
    } finally {
      createButton.disabled = false;
    }
  }
});

document.addEventListener(
  "submit",
  (event) => {
    if (event.target.id === "quickLeadForm") syncSelectedTrips(event.target);
  },
  true
);
