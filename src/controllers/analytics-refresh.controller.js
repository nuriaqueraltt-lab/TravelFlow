import { invalidateLeadsCache } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";
import { showAnalyticsView } from "./analytics.controller.js";

let analyticsDirty = false;
let refreshing = false;
let lastUpdatedAt = null;

function isAnalyticsVisible() {
  return Boolean(document.querySelector(".analytics-page"));
}

function formatTime(date) {
  return new Intl.DateTimeFormat("ca-ES", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ensureRefreshControls() {
  const page = document.querySelector(".analytics-page");
  const heading = page?.querySelector(":scope > .page-heading");
  if (!page || !heading || heading.querySelector("[data-refresh-analytics]")) return;

  const actions = document.createElement("div");
  actions.className = "page-heading__actions";
  actions.innerHTML = `
    <span data-analytics-freshness style="font-size:.82rem;opacity:.72;align-self:center;white-space:nowrap"></span>
    <button class="secondary-button" type="button" data-refresh-analytics>Actualitzar</button>
  `;
  heading.appendChild(actions);
  updateFreshnessText();
}

function updateFreshnessText() {
  const label = document.querySelector("[data-analytics-freshness]");
  if (!label) return;

  if (refreshing) {
    label.textContent = "Actualitzant dades...";
    return;
  }

  if (analyticsDirty) {
    label.textContent = "Hi ha canvis pendents d’actualitzar";
    return;
  }

  label.textContent = lastUpdatedAt
    ? `Actualitzat a les ${formatTime(lastUpdatedAt)}`
    : "Dades carregades de la sessió";
}

async function refreshAnalytics() {
  if (refreshing) return;
  refreshing = true;
  updateFreshnessText();

  const button = document.querySelector("[data-refresh-analytics]");
  if (button) {
    button.disabled = true;
    button.textContent = "Actualitzant...";
  }

  try {
    invalidateLeadsCache();
    await getTrips({ force: true });
    await showAnalyticsView();
    lastUpdatedAt = new Date();
    analyticsDirty = false;
  } catch (error) {
    console.error("No s'ha pogut actualitzar l'analítica:", error);
    window.alert("No s'ha pogut actualitzar l'analítica.");
  } finally {
    refreshing = false;
    ensureRefreshControls();
    updateFreshnessText();
  }
}

function markAnalyticsDirty() {
  analyticsDirty = true;
  updateFreshnessText();
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-analytics]")) refreshAnalytics();
});

window.addEventListener("travelflow:tasks-updated", markAnalyticsDirty);
window.addEventListener("travelflow:lead-created", markAnalyticsDirty);
window.addEventListener("travelflow:lead-deleted", markAnalyticsDirty);

const observer = new MutationObserver(() => {
  if (isAnalyticsVisible()) ensureRefreshControls();
});
observer.observe(document.body, { childList: true, subtree: true });
