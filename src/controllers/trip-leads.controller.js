import { getLeads } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";

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

export async function showLeadsForTrip(tripId) {
  const container = root();
  if (!container || !tripId) return;

  container.innerHTML = `<section class="leads-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant els leads del viatge...</p></div></section>`;

  try {
    const [leads, trips] = await Promise.all([getLeads(), getTrips()]);
    const trip = trips.find((item) => item.id === tripId);
    const matching = leads
      .filter((lead) => Array.isArray(lead.tripIds) && lead.tripIds.includes(tripId))
      .sort((a, b) => {
        if (a.status === "LOST" && b.status !== "LOST") return 1;
        if (a.status !== "LOST" && b.status === "LOST") return -1;
        const aDate = a.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        const bDate = b.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });

    container.innerHTML = `
      <section class="leads-page trip-leads-page">
        <header class="page-heading">
          <div>
            <span class="section-kicker">Leads per viatge</span>
            <h1>${escapeHtml(trip?.name?.replace(/^\d{4}\s*-\s*/, "") || "Viatge")}</h1>
            <p>${matching.length} futures viatgeres vinculades · ${matching.filter((lead) => lead.status !== "LOST").length} actives.</p>
          </div>
          <button class="secondary-button" type="button" data-back-dashboard>← Tornar al Dashboard</button>
        </header>
        <section class="leads-table-card">
          <div class="leads-table-head"><span>Futura viatgera</span><span>Viatges</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div>
          <div>${renderRows(matching)}</div>
        </section>
      </section>
    `;
  } catch (error) {
    console.error("No s'han pogut carregar els leads del viatge:", error);
    container.innerHTML = `<div class="leads-error">No s'han pogut carregar els leads d'aquest viatge.</div>`;
  }
}
