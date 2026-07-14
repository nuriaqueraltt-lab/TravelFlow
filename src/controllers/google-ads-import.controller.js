import {
  getGoogleAdsImportError,
  importGoogleAdsLeads,
  parseGoogleAdsImport
} from "../services/google-ads-import.service.js";
import { getCurrentUserProfile } from "../services/user-profile.service.js";
import { showLeadsView } from "./leads.controller.js";

function isAdmin() {
  return getCurrentUserProfile()?.role === "ADMIN";
}

function renderModal() {
  return `
    <div class="google-ads-import-modal is-open" id="googleAdsImportModal">
      <button class="google-ads-import-modal__backdrop" type="button" data-close-google-ads-import aria-label="Tancar"></button>
      <section class="google-ads-import-panel" role="dialog" aria-modal="true" aria-labelledby="googleAdsImportTitle">
        <button class="google-ads-import-panel__close" type="button" data-close-google-ads-import aria-label="Tancar">×</button>
        <span class="section-kicker">Importació privada</span>
        <h2 id="googleAdsImportTitle">Importar leads de Google Ads</h2>
        <p>Enganxa directament les files del full. Les dades passaran del navegador a Firestore i no es guardaran a GitHub.</p>

        <label class="google-ads-import-field">
          <span>Files del full</span>
          <textarea id="googleAdsImportText" rows="14" placeholder="Enganxa aquí el bloc complet amb les columnes separades per tabulacions..."></textarea>
        </label>

        <div class="google-ads-import-preview" id="googleAdsImportPreview" hidden></div>
        <p class="google-ads-import-message" id="googleAdsImportMessage" role="status"></p>

        <div class="google-ads-import-actions">
          <button class="secondary-button" type="button" data-preview-google-ads-import>Revisar dades</button>
          <button class="primary-button primary-button--compact" type="button" data-run-google-ads-import>Importar a Firestore</button>
        </div>
      </section>
    </div>`;
}

function ensureImportButton() {
  if (!isAdmin()) return;
  const heading = document.querySelector(".leads-page .page-heading");
  if (!heading || heading.querySelector("[data-open-google-ads-import]")) return;

  const actions = document.createElement("div");
  actions.className = "leads-page-actions";

  const currentPrimary = heading.querySelector("[data-open-new-lead]");
  if (currentPrimary) actions.appendChild(currentPrimary);

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "secondary-button";
  importButton.dataset.openGoogleAdsImport = "";
  importButton.textContent = "Importar Google Ads";
  actions.appendChild(importButton);
  heading.appendChild(actions);
}

function openModal() {
  if (!isAdmin() || document.querySelector("#googleAdsImportModal")) return;
  document.body.insertAdjacentHTML("beforeend", renderModal());
  document.body.classList.add("modal-open");
  window.setTimeout(() => document.querySelector("#googleAdsImportText")?.focus(), 50);
}

function closeModal() {
  document.querySelector("#googleAdsImportModal")?.remove();
  document.body.classList.remove("modal-open");
}

function previewImport() {
  const text = document.querySelector("#googleAdsImportText")?.value || "";
  const preview = document.querySelector("#googleAdsImportPreview");
  const message = document.querySelector("#googleAdsImportMessage");
  const parsed = parseGoogleAdsImport(text);

  message.textContent = "";
  message.className = "google-ads-import-message";

  if (!parsed.total) {
    preview.hidden = true;
    message.classList.add("is-error");
    message.textContent = "No s'ha detectat cap fila vàlida.";
    return;
  }

  preview.hidden = false;
  preview.innerHTML = `
    <strong>${parsed.total} leads detectats</strong>
    <span>${parsed.lost} perduts · ${parsed.booked} reservats · ${parsed.withoutName} sense nom</span>
    <small>Els duplicats es detectaran per telèfon, correu o nom i se'ls corregirà el canal a Google Ads.</small>`;
}

async function runImport(button) {
  const text = document.querySelector("#googleAdsImportText")?.value || "";
  const message = document.querySelector("#googleAdsImportMessage");
  button.disabled = true;
  message.className = "google-ads-import-message";
  message.textContent = "Important dades...";

  try {
    const result = await importGoogleAdsLeads(text);
    message.classList.add("is-success");
    message.textContent = `${result.created} leads creats i ${result.updated} existents actualitzats a Google Ads.`;
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
    window.setTimeout(async () => {
      closeModal();
      await showLeadsView();
    }, 1200);
  } catch (error) {
    console.error("No s'ha pogut importar Google Ads:", error);
    message.classList.add("is-error");
    message.textContent = getGoogleAdsImportError(error);
    button.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-google-ads-import]")) {
    openModal();
    return;
  }
  if (event.target.closest("[data-close-google-ads-import]")) {
    closeModal();
    return;
  }
  if (event.target.closest("[data-preview-google-ads-import]")) {
    previewImport();
    return;
  }
  const runButton = event.target.closest("[data-run-google-ads-import]");
  if (runButton) runImport(runButton);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector("#googleAdsImportModal")) closeModal();
});

window.addEventListener("travelflow:user-ready", ensureImportButton);

const observer = new MutationObserver(ensureImportButton);
observer.observe(document.body, { childList: true, subtree: true });
ensureImportButton();
