import { createLead, getLeadErrorMessage } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";
import { LEAD_CHANNELS, LEAD_SOURCES } from "../config/app.constants.js";

const ENTRY_PRESETS = {
  WEB_FORM: { label: "Formulari web", channel: LEAD_CHANNELS.WEB, source: LEAD_SOURCES.WEBSITE_FORM, icon: "⌁" },
  GOOGLE_ADS: { label: "Google Ads", channel: LEAD_CHANNELS.WEB, source: LEAD_SOURCES.GOOGLE_ADS, icon: "G" },
  WHATSAPP: { label: "WhatsApp", channel: LEAD_CHANNELS.WHATSAPP, source: LEAD_SOURCES.WHATSAPP, icon: "W" },
  INSTAGRAM: { label: "Instagram", channel: LEAD_CHANNELS.INSTAGRAM, source: LEAD_SOURCES.INSTAGRAM_ORGANIC, icon: "I" },
  FACEBOOK: { label: "Facebook", channel: LEAD_CHANNELS.FACEBOOK, source: LEAD_SOURCES.FACEBOOK_ORGANIC, icon: "F" }
};

let tripsCache = [];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function renderSourceStep() {
  const options = Object.entries(ENTRY_PRESETS).map(([key, preset]) => `
    <button class="entry-source-card" type="button" data-entry-source="${key}">
      <span class="entry-source-card__icon">${preset.icon}</span>
      <span><strong>${preset.label}</strong><small>Crear amb aquesta entrada</small></span>
      <span class="entry-source-card__arrow">→</span>
    </button>`).join("");

  return `<div class="lead-entry-step" data-entry-step="source">
    <div class="lead-entry-heading"><span class="section-kicker">Nova futura viatgera</span><h2>Per on ens ha contactat?</h2><p>Tria l'entrada i prepararem automàticament el registre.</p></div>
    <div class="entry-source-grid">${options}</div>
  </div>`;
}

function renderChannelSpecificField(presetKey) {
  if (presetKey === "WHATSAPP") {
    return `<fieldset class="quick-lead-form__wide lead-entry-detail-options">
      <legend>D'on arriba aquest WhatsApp?</legend>
      <p>Si no selecciones cap opció, es guardarà com a Altres.</p>
      <div class="lead-entry-detail-options__choices">
        <label><input name="whatsappOrigin" type="radio" value="FACEBOOK_AD" /> <span>Publi Facebook</span></label>
        <label><input name="whatsappOrigin" type="radio" value="INSTAGRAM_AD" /> <span>Publi Instagram</span></label>
      </div>
    </fieldset>`;
  }
  if (presetKey === "GOOGLE_ADS") {
    return `<fieldset class="quick-lead-form__wide lead-entry-detail-options">
      <legend>Com ha entrat des de Google Ads? *</legend>
      <div class="lead-entry-detail-options__choices">
        <label><input name="googleAdsEntryMethod" type="radio" value="WHATSAPP" required /> <span>WhatsApp</span></label>
        <label><input name="googleAdsEntryMethod" type="radio" value="FORM" required /> <span>Formulari</span></label>
      </div>
      <div class="quick-lead-form__grid lead-entry-google-fields" data-google-ads-form-fields hidden>
        <label class="form-field"><span>ID campanya</span><div class="form-control form-control--plain"><input name="googleAdsCampaignId" type="text" /></div></label>
        <label class="form-field"><span>ID grup d'anuncis</span><div class="form-control form-control--plain"><input name="googleAdsAdGroupId" type="text" /></div></label>
        <label class="form-field"><span>ID anunci</span><div class="form-control form-control--plain"><input name="googleAdsAdId" type="text" /></div></label>
        <label class="form-field"><span>Tema de cerca</span><div class="form-control form-control--plain"><input name="googleAdsSearchTheme" type="text" /></div></label>
      </div>
    </fieldset>`;
  }
  if (presetKey === "INSTAGRAM") {
    return `<label class="form-field quick-lead-form__wide"><span>Usuari o enllaç d'Instagram</span><div class="form-control form-control--plain"><input name="instagramHandle" type="text" placeholder="@usuaria o https://instagram.com/usuaria" /></div></label>`;
  }
  if (presetKey === "FACEBOOK") {
    return `<label class="form-field quick-lead-form__wide"><span>Enllaç del perfil o conversa de Facebook</span><div class="form-control form-control--plain"><input name="facebookUrl" type="url" placeholder="https://facebook.com/... o https://m.me/..." /></div></label>`;
  }
  return "";
}

function renderTripOptions() {
  if (!tripsCache.length) return `<p class="lead-entry-trips__empty">Encara no hi ha etiquetes de viatge disponibles.</p>`;
  return tripsCache.map((trip) => `
    <label class="lead-edit-trip" data-trip-option>
      <input type="checkbox" name="tripIds" value="${trip.id}" data-trip-label="${escapeHtml(trip.name)}" />
      <span>${escapeHtml(trip.name)}</span>
    </label>`).join("");
}

function renderTripSearch() {
  return `<label class="trip-tag-search">
    <span class="trip-tag-search__label">Buscar etiqueta</span>
    <span class="trip-tag-search__control">
      <span aria-hidden="true">⌕</span>
      <input type="search" placeholder="Escriu el nom del viatge..." autocomplete="off" data-trip-tag-search />
    </span>
  </label>
  <p class="trip-tag-search__empty" data-trip-tag-search-empty hidden>No hi ha cap etiqueta que coincideixi amb la cerca.</p>`;
}

function renderLeadForm(presetKey) {
  const preset = ENTRY_PRESETS[presetKey];
  const phoneRequired = presetKey === "WHATSAPP" ? "required" : "";

  return `<div class="lead-entry-step" data-entry-step="form">
    <button class="lead-entry-back" type="button" data-entry-back>← Canviar entrada</button>
    <div class="lead-entry-heading lead-entry-heading--form"><span class="lead-entry-selected">${preset.icon} ${preset.label}</span><h2>Dades de la futura viatgera</h2><p>Només el nom és obligatori, excepte a WhatsApp, on també necessitem el telèfon.</p></div>
    <form class="quick-lead-form" id="quickLeadForm" novalidate>
      <input type="hidden" name="entryPreset" value="${presetKey}" />
      <input type="hidden" name="channel" value="${preset.channel}" />
      <input type="hidden" name="source" value="${preset.source}" />
      <input type="hidden" name="entryLabel" value="${preset.label}" />
      <div class="quick-lead-form__grid">
        <label class="form-field"><span>Nom *</span><div class="form-control form-control--plain"><input name="firstName" type="text" autocomplete="given-name" placeholder="Nom" required /></div></label>
        <label class="form-field"><span>Cognoms</span><div class="form-control form-control--plain"><input name="lastName" type="text" autocomplete="family-name" placeholder="Cognoms" /></div></label>
        <label class="form-field"><span>Telèfon${presetKey === "WHATSAPP" ? " *" : ""}</span><div class="form-control form-control--plain"><input name="phone" type="tel" autocomplete="tel" placeholder="+34 600 000 000" ${phoneRequired} /></div></label>
        <label class="form-field"><span>Correu electrònic</span><div class="form-control form-control--plain"><input name="email" type="email" autocomplete="email" placeholder="nom@correu.com" /></div></label>
        ${renderChannelSpecificField(presetKey)}
        <fieldset class="quick-lead-form__wide lead-edit-trips lead-entry-trips">
          <legend>Etiquetes de viatge</legend>
          <p>Selecciona un o diversos viatges d'interès. També pots deixar-ho sense etiqueta.</p>
          ${renderTripSearch()}
          <div class="trip-tag-options-list">${renderTripOptions()}</div>
        </fieldset>
        <fieldset class="quick-lead-form__wide lead-entry-dates">
          <legend>Dates del contacte</legend>
          <p>Només cal omplir-les si introdueixes una consulta d'un altre dia. Si les deixes buides, es guardarà la data d'avui.</p>
          <div class="quick-lead-form__grid">
            <label class="form-field"><span>Data d'entrada</span><div class="form-control form-control--plain"><input name="entryDate" type="date" /></div></label>
            <label class="form-field"><span>Data de l'últim contacte</span><div class="form-control form-control--plain"><input name="lastContactDate" type="date" /></div></label>
          </div>
        </fieldset>
        <label class="form-field quick-lead-form__wide"><span>Primer missatge o observacions</span><textarea class="quick-lead-form__textarea" name="notes" rows="4" placeholder="Enganxa aquí el missatge rebut o afegeix una nota breu..."></textarea></label>
      </div>
      <div class="quick-lead-form__actions"><button class="secondary-button" type="button" data-entry-close>Cancel·lar</button><button class="primary-button primary-button--compact" type="submit" data-save-lead>Guardar futura viatgera</button></div>
      <p class="quick-lead-form__message" id="quickLeadMessage" role="status"></p>
    </form>
  </div>`;
}

function filterTripOptions(searchInput) {
  const fieldset = searchInput.closest(".lead-edit-trips");
  if (!fieldset) return;
  const query = normalizeText(searchInput.value);
  const options = [...fieldset.querySelectorAll("[data-trip-option]")];
  let visible = 0;
  options.forEach((option) => {
    const matches = !query || normalizeText(option.textContent).includes(query);
    option.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = fieldset.querySelector("[data-trip-tag-search-empty]");
  if (empty) empty.hidden = visible > 0;
}

function createModal() {
  const modal = document.createElement("div");
  modal.className = "lead-entry-modal";
  modal.id = "leadEntryModal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `<button class="lead-entry-modal__backdrop" type="button" data-entry-close aria-label="Tancar"></button><section class="lead-entry-panel" role="dialog" aria-modal="true"><button class="lead-entry-panel__close" type="button" data-entry-close aria-label="Tancar">×</button><div class="lead-entry-panel__content">${renderSourceStep()}</div></section>`;
  document.body.appendChild(modal);
  return modal;
}

const modal = createModal();
const content = modal.querySelector(".lead-entry-panel__content");
function openModal() { content.innerHTML = renderSourceStep(); modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); document.body.classList.add("modal-open"); window.setTimeout(() => modal.querySelector("[data-entry-source]")?.focus(), 50); }
function closeModal() { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); document.body.classList.remove("modal-open"); }
async function showForm(presetKey) {
  content.innerHTML = `<div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant etiquetes...</p></div>`;
  try { tripsCache = await getTrips(); }
  catch (error) { console.error("No s'han pogut carregar les etiquetes:", error); tripsCache = []; }
  content.innerHTML = renderLeadForm(presetKey);
  content.querySelector("input[name='firstName']")?.focus();
}
function setSavingState(form, saving) { const saveButton = form.querySelector("[data-save-lead]"); const cancelButton = form.querySelector("[data-entry-close]"); if (saveButton) { saveButton.disabled = saving; saveButton.textContent = saving ? "Guardant..." : "Guardar futura viatgera"; } if (cancelButton) cancelButton.disabled = saving; }

document.addEventListener("click", (event) => {
  const newLeadButton = event.target.closest("[data-open-new-lead]");
  const sourceButton = event.target.closest("[data-entry-source]");
  const closeButton = event.target.closest("[data-entry-close]");
  const backButton = event.target.closest("[data-entry-back]");
  if (newLeadButton) { event.preventDefault(); openModal(); return; }
  if (sourceButton) { showForm(sourceButton.dataset.entrySource); return; }
  if (closeButton) { closeModal(); return; }
  if (backButton) content.innerHTML = renderSourceStep();
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#quickLeadForm [data-trip-tag-search]")) filterTripOptions(event.target);
});

document.addEventListener("change", (event) => {
  if (!event.target.matches('#quickLeadForm input[name="googleAdsEntryMethod"]')) return;
  const fields = event.target.closest("fieldset")?.querySelector("[data-google-ads-form-fields]");
  if (fields) fields.hidden = event.target.value !== "FORM";
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "quickLeadForm") return;
  event.preventDefault();
  const form = event.target;
  const message = form.querySelector("#quickLeadMessage");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const leadInput = Object.fromEntries(new FormData(form).entries());
  const selectedTrips = [...form.querySelectorAll('input[name="tripIds"]:checked')];
  leadInput.tripIds = JSON.stringify(selectedTrips.map((input) => input.value));
  leadInput.tripLabels = JSON.stringify(selectedTrips.map((input) => input.dataset.tripLabel));
  message.classList.remove("is-error", "is-success"); message.textContent = ""; setSavingState(form, true);
  try {
    const lead = await createLead(leadInput);
    message.classList.add("is-success"); message.textContent = `${lead.fullName} s'ha guardat correctament.`;
    window.dispatchEvent(new CustomEvent("travelflow:lead-created", { detail: lead }));
    window.setTimeout(closeModal, 850);
  } catch (error) {
    console.error("No s'ha pogut crear el lead:", error);
    message.classList.add("is-error"); message.textContent = getLeadErrorMessage(error); setSavingState(form, false);
  }
});

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal.classList.contains("is-open")) closeModal(); });
