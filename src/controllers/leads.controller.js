import {
  getLeadActivities,
  getLeadById,
  getLeadErrorMessage,
  getLeads
} from "../services/lead.service.js";

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
  NEW: "Nova",
  CONTACTED: "Contactada",
  INFO_SENT: "Informació enviada",
  FOLLOW_UP: "En seguiment",
  BOOKING_STARTED: "Reserva iniciada",
  CUSTOMER: "Clienta",
  LOST: "Perduda"
};

let leadsCache = [];

function getContentRoot() {
  return document.querySelector(".app-content");
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("ca-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function getInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "FV";
}

function renderLoading() {
  return `
    <section class="leads-page">
      <div class="leads-loading">
        <span class="leads-loading__spinner"></span>
        <p>Carregant futures viatgeres...</p>
      </div>
    </section>
  `;
}

function renderEmptyState() {
  return `
    <div class="leads-empty">
      <span>✦</span>
      <h2>Encara no hi ha futures viatgeres</h2>
      <p>Quan en registris una, apareixerà aquí preparada per fer-ne el seguiment.</p>
      <button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button>
    </div>
  `;
}

function renderLeadRows(leads) {
  if (!leads.length) return renderEmptyState();

  return leads
    .map(
      (lead) => `
        <button class="lead-row" type="button" data-lead-id="${lead.id}">
          <span class="lead-row__person">
            <span class="lead-row__avatar">${getInitials(lead.fullName)}</span>
            <span>
              <strong>${lead.fullName || "Sense nom"}</strong>
              <small>${lead.email || lead.phone || "Sense dades de contacte"}</small>
            </span>
          </span>
          <span class="lead-row__interest">${lead.interest || "Sense viatge assignat"}</span>
          <span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span>
          <span class="lead-status">${STATUS_LABELS[lead.status] || lead.status || "Nova"}</span>
          <span class="lead-row__date">${formatDate(lead.createdAt)}</span>
          <span class="lead-row__arrow">→</span>
        </button>
      `
    )
    .join("");
}

function renderLeadsView(leads) {
  return `
    <section class="leads-page">
      <header class="page-heading">
        <div>
          <span class="section-kicker">Gestió comercial</span>
          <h1>Futures viatgeres</h1>
          <p>Totes les oportunitats, centralitzades i preparades per al seguiment.</p>
        </div>
        <button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button>
      </header>

      <section class="leads-toolbar">
        <label class="leads-search">
          <span class="sr-only">Cercar</span>
          <input id="leadsSearch" type="search" placeholder="Cerca per nom, telèfon, correu o viatge..." />
        </label>
        <select id="leadsChannelFilter" class="leads-filter" aria-label="Filtrar per canal">
          <option value="">Tots els canals</option>
          <option value="WEB">Web</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="FACEBOOK">Facebook</option>
        </select>
        <div class="leads-count"><strong id="leadsCount">${leads.length}</strong> registrades</div>
      </section>

      <section class="leads-table-card">
        <div class="leads-table-head">
          <span>Futura viatgera</span>
          <span>Interès</span>
          <span>Canal</span>
          <span>Estat</span>
          <span>Alta</span>
          <span></span>
        </div>
        <div id="leadsRows">${renderLeadRows(leads)}</div>
      </section>
    </section>
  `;
}

function renderActivities(activities) {
  if (!activities.length) {
    return `<p class="lead-detail__muted">Encara no hi ha activitat registrada.</p>`;
  }

  return activities
    .map(
      (activity) => `
        <article class="timeline-item">
          <span class="timeline-item__dot"></span>
          <div>
            <strong>${activity.description || "Activitat registrada"}</strong>
            <small>${formatDate(activity.createdAt)}</small>
          </div>
        </article>
      `
    )
    .join("");
}

function renderLeadDetail(lead, activities) {
  return `
    <section class="lead-detail-page">
      <button class="lead-detail-back" type="button" data-back-to-leads>← Tornar a futures viatgeres</button>

      <header class="lead-detail-hero">
        <div class="lead-detail-hero__avatar">${getInitials(lead.fullName)}</div>
        <div class="lead-detail-hero__content">
          <span class="section-kicker">Futura viatgera</span>
          <h1>${lead.fullName}</h1>
          <div class="lead-detail-hero__meta">
            <span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span>
            <span>${lead.interest || "Sense viatge assignat"}</span>
            <span>${STATUS_LABELS[lead.status] || "Nova"}</span>
          </div>
        </div>
        <button class="primary-button primary-button--compact" type="button">Programar seguiment</button>
      </header>

      <div class="lead-detail-grid">
        <article class="content-card lead-detail-card">
          <header><span class="section-kicker">Contacte</span><h2>Dades principals</h2></header>
          <dl class="lead-data-list">
            <div><dt>Telèfon</dt><dd>${lead.phone || "—"}</dd></div>
            <div><dt>Correu electrònic</dt><dd>${lead.email || "—"}</dd></div>
            <div><dt>Canal d'entrada</dt><dd>${CHANNEL_LABELS[lead.channel] || "Altres"}</dd></div>
            <div><dt>Data d'alta</dt><dd>${formatDate(lead.createdAt)}</dd></div>
          </dl>
          ${lead.notes ? `<div class="lead-notes"><span>Primer missatge o observacions</span><p>${lead.notes}</p></div>` : ""}
        </article>

        <article class="content-card lead-detail-card">
          <header><span class="section-kicker">Historial</span><h2>Activitat</h2></header>
          <div class="timeline">${renderActivities(activities)}</div>
        </article>

        <aside class="lead-ai-card">
          <span>✦ TravelFlow AI</span>
          <h2>Primer contacte recomanat</h2>
          <p>Aquesta futura viatgera acaba d'entrar per ${CHANNEL_LABELS[lead.channel] || "un canal nou"}. Recomanem respondre avui i registrar la pròxima acció.</p>
          <button type="button" disabled>Generar missatge · Properament</button>
        </aside>
      </div>
    </section>
  `;
}

function applyFilters() {
  const search = document.querySelector("#leadsSearch")?.value.trim().toLowerCase() ?? "";
  const channel = document.querySelector("#leadsChannelFilter")?.value ?? "";

  const filtered = leadsCache.filter((lead) => {
    const haystack = [lead.fullName, lead.phone, lead.email, lead.interest]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (!search || haystack.includes(search)) && (!channel || lead.channel === channel);
  });

  const rows = document.querySelector("#leadsRows");
  const count = document.querySelector("#leadsCount");
  if (rows) rows.innerHTML = renderLeadRows(filtered);
  if (count) count.textContent = String(filtered.length);
}

export async function showLeadsView() {
  const root = getContentRoot();
  if (!root) return;
  root.innerHTML = renderLoading();

  try {
    leadsCache = await getLeads();
    root.innerHTML = renderLeadsView(leadsCache);
  } catch (error) {
    root.innerHTML = `<section class="leads-page"><div class="leads-error">${getLeadErrorMessage(error)}</div></section>`;
  }
}

export async function showLeadDetail(leadId) {
  const root = getContentRoot();
  if (!root) return;
  root.innerHTML = renderLoading();

  try {
    const [lead, activities] = await Promise.all([
      getLeadById(leadId),
      getLeadActivities(leadId)
    ]);

    if (!lead) {
      root.innerHTML = `<section class="leads-page"><div class="leads-error">No s'ha trobat aquesta futura viatgera.</div></section>`;
      return;
    }

    root.innerHTML = renderLeadDetail(lead, activities);
  } catch (error) {
    root.innerHTML = `<section class="leads-page"><div class="leads-error">${getLeadErrorMessage(error)}</div></section>`;
  }
}

function markLeadsNavigationActive() {
  document.querySelectorAll(".sidebar-nav__item").forEach((button) => {
    button.classList.toggle("is-active", button.textContent.trim().startsWith("Leads"));
  });
}

document.addEventListener("click", (event) => {
  const navButton = event.target.closest(".sidebar-nav__item");
  const leadRow = event.target.closest("[data-lead-id]");
  const backButton = event.target.closest("[data-back-to-leads]");
  const openNewLead = event.target.closest("[data-open-new-lead]");

  if (navButton?.textContent.trim().startsWith("Leads")) {
    markLeadsNavigationActive();
    showLeadsView();
    return;
  }

  if (leadRow) {
    showLeadDetail(leadRow.dataset.leadId);
    return;
  }

  if (backButton) {
    showLeadsView();
    return;
  }

  if (openNewLead) {
    document.querySelector(".page-heading .primary-button--compact")?.click();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "leadsSearch") applyFilters();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "leadsChannelFilter") applyFilters();
});

window.addEventListener("travelflow:lead-created", (event) => {
  if (event.detail?.id) showLeadDetail(event.detail.id);
});
