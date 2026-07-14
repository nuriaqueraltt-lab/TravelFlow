import { getLeadActivities, getLeadById, getLeadErrorMessage, getLeads, updateLead } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";
import {
  confirmBooking,
  getLeadTasks,
  getWorkflowErrorMessage,
  markLeadLost,
  markNoResponse,
  markReplied,
  recordManualContact,
  scheduleManualFollowUp
} from "../services/workflow.service.js";

const CHANNEL_LABELS = { WEB: "Web", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", EMAIL: "Email", PHONE: "Telèfon", OTHER: "Altres" };
const STATUS_LABELS = { NEW: "Nou", INFO_SENT: "Informació enviada", FOLLOW_UP: "En seguiment", REPLIED: "Ha contestat", PENDING_DECISION: "Pendent de decisió", BOOKING_CONFIRMED: "Reserva confirmada", CONTACT_LATER: "Contactar més endavant", LOST: "Perdut" };
const LOST_LABELS = { NO_RESPONSE: "Sense resposta", PRICE: "Preu", DATES: "Dates", HEALTH: "Salut", NO_HOLIDAYS: "No té vacances", BOOKED_ELSEWHERE: "Viatja amb una altra agència", DESTINATION: "Destinació no adequada", OTHER: "Altres" };
let leadsCache = [];
let currentLeadId = null;
let tripsCache = [];

function root() { return document.querySelector(".app-content"); }
function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}
function initials(name = "") { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "FV"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function loading() { return `<section class="leads-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant...</p></div></section>`; }
function whatsappNumber(phone = "") { let digits = String(phone).replace(/\D/g, ""); if (!digits) return ""; if (digits.startsWith("00")) digits = digits.slice(2); if (digits.length === 9) digits = `34${digits}`; return digits; }
function instagramUrl(value = "") { const clean = String(value).trim(); if (!clean) return ""; if (/^https?:\/\//i.test(clean)) return clean; return `https://www.instagram.com/${clean.replace(/^@/, "")}/`; }
function safeExternalUrl(value = "") { const clean = String(value).trim(); return /^https?:\/\//i.test(clean) ? clean : ""; }

function renderContactLinks(lead) {
  const links = [];
  const waNumber = whatsappNumber(lead.phone);
  if (waNumber) links.push(`<a class="lead-contact-button lead-contact-button--whatsapp" href="https://wa.me/${waNumber}" target="_blank" rel="noopener noreferrer">Obrir WhatsApp</a>`);
  const igUrl = instagramUrl(lead.instagramHandle);
  if (igUrl) links.push(`<a class="lead-contact-button lead-contact-button--instagram" href="${escapeHtml(igUrl)}" target="_blank" rel="noopener noreferrer">Obrir Instagram</a>`);
  const fbUrl = safeExternalUrl(lead.facebookUrl);
  if (fbUrl) links.push(`<a class="lead-contact-button lead-contact-button--facebook" href="${escapeHtml(fbUrl)}" target="_blank" rel="noopener noreferrer">Obrir Facebook</a>`);
  if (lead.email) links.push(`<a class="lead-contact-button" href="mailto:${encodeURIComponent(lead.email)}">Enviar correu</a>`);
  return links.length ? `<div class="lead-contact-links">${links.join("")}</div>` : "";
}

function renderRows(leads) {
  if (!leads.length) return `<div class="leads-empty"><h2>No hi ha resultats</h2><p>Prova una altra cerca o crea una futura viatgera.</p></div>`;
  return leads.map((lead) => `<button class="lead-row" type="button" data-lead-id="${lead.id}"><span class="lead-row__person"><span class="lead-row__avatar">${initials(lead.fullName)}</span><span><strong>${escapeHtml(lead.fullName)}</strong><small>${escapeHtml(lead.email || lead.phone || "Sense contacte")}</small></span></span><span class="lead-row__interest">${escapeHtml(lead.tripLabels?.join(", ") || lead.interest || "Sense viatge")}</span><span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span><span class="lead-status">${STATUS_LABELS[lead.status] || lead.status}</span><span class="lead-row__date">${formatDate(lead.nextActionAt)}</span><span>→</span></button>`).join("");
}

function renderList(leads) {
  return `<section class="leads-page"><header class="page-heading"><div><span class="section-kicker">Gestió comercial</span><h1>Futures viatgeres</h1><p>Cerca, filtra i obre qualsevol historial comercial.</p></div><button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button></header><section class="leads-toolbar"><label class="leads-search"><input id="leadsSearch" type="search" placeholder="Nom, telèfon, correu o viatge..." /></label><select id="leadsChannelFilter" class="leads-filter"><option value="">Tots els canals</option><option value="WEB">Web</option><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option></select><div class="leads-count"><strong id="leadsCount">${leads.length}</strong> registrades</div></section><section class="leads-table-card"><div class="leads-table-head"><span>Futura viatgera</span><span>Viatge</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div id="leadsRows">${renderRows(leads)}</div></section></section>`;
}

function renderTimeline(activities, tasks) {
  const items = [...activities.map((item) => ({ ...item, timelineDate: item.createdAt, pending: false })), ...tasks.filter((task) => task.status === "PENDING").map((task) => ({ description: task.title, timelineDate: task.dueAt, pending: true }))].sort((a, b) => (a.timelineDate?.toMillis?.() ?? 0) - (b.timelineDate?.toMillis?.() ?? 0));
  return items.length ? items.map((item) => `<article class="timeline-item ${item.pending ? "is-pending" : ""}"><span class="timeline-item__dot"></span><div><strong>${escapeHtml(item.description || "Activitat")}</strong><small>${formatDate(item.timelineDate, true)}${item.pending ? " · Pendent" : ""}</small></div></article>`).join("") : `<p>Encara no hi ha activitat.</p>`;
}

function renderTripOptions(selectedIds = []) {
  const selected = new Set(selectedIds || []);
  return tripsCache.map((trip) => `<label class="lead-edit-trip"><input type="checkbox" name="tripIds" value="${trip.id}" data-trip-label="${escapeHtml(trip.name)}" ${selected.has(trip.id) ? "checked" : ""}><span>${escapeHtml(trip.name)}</span></label>`).join("");
}

function renderEditForm(lead) {
  return `<form class="lead-edit-form" data-form="edit"><div class="lead-edit-grid"><label>Nom *<input name="firstName" required value="${escapeHtml(lead.firstName || "")}"></label><label>Cognoms<input name="lastName" value="${escapeHtml(lead.lastName || "")}"></label><label>Telèfon<input name="phone" value="${escapeHtml(lead.phone || "")}"></label><label>Correu<input name="email" type="email" value="${escapeHtml(lead.email || "")}"></label><label>Instagram<input name="instagramHandle" value="${escapeHtml(lead.instagramHandle || "")}" placeholder="@usuari o enllaç"></label><label>Facebook<input name="facebookUrl" value="${escapeHtml(lead.facebookUrl || "")}" placeholder="Enllaç del perfil o conversa"></label></div><label>Observacions<textarea name="notes">${escapeHtml(lead.notes || "")}</textarea></label><fieldset class="lead-edit-trips"><legend>Etiquetes de viatge</legend><div>${renderTripOptions(lead.tripIds)}</div></fieldset><div class="lead-edit-actions"><button type="button" class="secondary-button" data-cancel-edit>Cancel·lar</button><button class="primary-button primary-button--compact">Guardar canvis</button></div></form>`;
}

function renderDetail(lead, activities, tasks) {
  const pending = tasks.find((task) => task.status === "PENDING");
  const trip = lead.tripLabels?.join(", ") || lead.interest || "Sense viatge";
  return `<section class="lead-detail-page"><button class="lead-detail-back" type="button" data-back-to-leads>← Tornar</button><header class="lead-detail-hero"><div class="lead-detail-hero__avatar">${initials(lead.fullName)}</div><div class="lead-detail-hero__content"><span class="section-kicker">Futura viatgera</span><h1>${escapeHtml(lead.fullName)}</h1><div class="lead-detail-hero__meta"><span class="lead-channel lead-channel--${String(lead.channel).toLowerCase()}">${CHANNEL_LABELS[lead.channel]}</span><span>${escapeHtml(trip)}</span></div>${renderContactLinks(lead)}</div><button class="secondary-button" type="button" data-edit-lead>Editar dades i etiquetes</button></header><section id="leadEditPanel"></section><section class="lead-summary-grid"><article><span>Estat</span><strong>${STATUS_LABELS[lead.status] || lead.status}</strong></article><article><span>Viatge</span><strong>${escapeHtml(trip)}</strong></article><article><span>Pròxima acció</span><strong>${escapeHtml(pending?.title || lead.nextActionTitle || "Sense acció")}</strong></article><article><span>Data pròxima acció</span><strong>${formatDate(pending?.dueAt || lead.nextActionAt)}</strong></article><article><span>Sense resposta</span><strong>${Number(lead.noResponseCount || 0)} de 2</strong></article></section><section class="lead-quick-actions"><button data-action="contact">Afegir contacte</button><button data-action="replied">Ha contestat</button><button data-action="no-response">Sense resposta</button><button data-action="schedule">Programar seguiment</button><button data-action="booking">Reserva confirmada</button><button class="is-danger" data-action="lost">Marcar com a perdut</button></section><section class="lead-action-panel" id="leadActionPanel"></section><div class="lead-detail-grid"><article class="content-card lead-detail-card"><header><span class="section-kicker">Contacte</span><h2>Dades principals</h2></header><dl class="lead-data-list"><div><dt>Telèfon</dt><dd>${escapeHtml(lead.phone || "—")}</dd></div><div><dt>Correu</dt><dd>${escapeHtml(lead.email || "—")}</dd></div>${lead.instagramHandle ? `<div><dt>Instagram</dt><dd>${escapeHtml(lead.instagramHandle)}</dd></div>` : ""}${lead.facebookUrl ? `<div><dt>Facebook</dt><dd>Enllaç guardat</dd></div>` : ""}<div><dt>Canal</dt><dd>${CHANNEL_LABELS[lead.channel]}</dd></div><div><dt>Alta</dt><dd>${formatDate(lead.createdAt)}</dd></div></dl>${lead.notes ? `<div class="lead-notes"><span>Observacions</span><p>${escapeHtml(lead.notes)}</p></div>` : ""}</article><article class="content-card lead-detail-card"><header><span class="section-kicker">Historial complet</span><h2>Interaccions comercials</h2></header><div class="timeline">${renderTimeline(activities, tasks)}</div></article></div></section>`;
}

function renderActionForm(action) {
  if (action === "contact") return `<form class="lead-inline-form" data-form="contact"><label>Interacció o nota<textarea name="description" required placeholder="Ex. Informació enviada per WhatsApp"></textarea></label><label>Estat<select name="status"><option value="INFO_SENT">Informació enviada</option><option value="FOLLOW_UP">En seguiment</option><option value="PENDING_DECISION">Pendent de decisió</option></select></label><button class="primary-button primary-button--compact">Guardar contacte</button></form>`;
  if (action === "schedule") return `<form class="lead-inline-form" data-form="schedule"><label>Pròxima acció<input name="title" required placeholder="Ex. Trucar clienta" /></label><label>Data<input name="dueAt" type="date" required /></label><button class="primary-button primary-button--compact">Programar</button></form>`;
  if (action === "lost") return `<form class="lead-inline-form" data-form="lost"><label>Motiu obligatori<select name="reason" required><option value="">Selecciona...</option>${Object.entries(LOST_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>Observacions<textarea name="note"></textarea></label><button class="primary-button primary-button--compact">Confirmar pèrdua</button></form>`;
  return "";
}

async function refreshDetail() {
  if (!currentLeadId) return;
  const [lead, activities, tasks, trips] = await Promise.all([getLeadById(currentLeadId), getLeadActivities(currentLeadId), getLeadTasks(currentLeadId), getTrips()]);
  tripsCache = trips;
  root().innerHTML = renderDetail(lead, activities, tasks);
}

export async function showLeadsView() { root().innerHTML = loading(); try { leadsCache = await getLeads(); root().innerHTML = renderList(leadsCache); } catch (error) { root().innerHTML = `<div class="leads-error">${getLeadErrorMessage(error)}</div>`; } }
export async function showLeadDetail(leadId) { currentLeadId = leadId; root().innerHTML = loading(); try { await refreshDetail(); } catch (error) { root().innerHTML = `<div class="leads-error">${getLeadErrorMessage(error)}</div>`; } }
function filterRows() { const search = document.querySelector("#leadsSearch")?.value.toLowerCase().trim() || ""; const channel = document.querySelector("#leadsChannelFilter")?.value || ""; const filtered = leadsCache.filter((lead) => (!channel || lead.channel === channel) && (!search || [lead.fullName, lead.phone, lead.email, lead.instagramHandle, lead.interest, ...(lead.tripLabels || [])].join(" ").toLowerCase().includes(search))); document.querySelector("#leadsRows").innerHTML = renderRows(filtered); document.querySelector("#leadsCount").textContent = filtered.length; }

async function runQuickAction(action) {
  const lead = await getLeadById(currentLeadId);
  if (["contact", "schedule", "lost"].includes(action)) { document.querySelector("#leadActionPanel").innerHTML = renderActionForm(action); return; }
  try { if (action === "replied") await markReplied(lead); if (action === "no-response") await markNoResponse(lead); if (action === "booking" && window.confirm("Confirmes que la reserva està confirmada?")) await confirmBooking(lead); await refreshDetail(); window.dispatchEvent(new CustomEvent("travelflow:tasks-updated")); } catch (error) { window.alert(getWorkflowErrorMessage(error)); }
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest(".sidebar-nav__item");
  if (nav?.textContent.trim().startsWith("Leads")) { showLeadsView(); return; }
  const row = event.target.closest("[data-lead-id]"); if (row) { showLeadDetail(row.dataset.leadId); return; }
  if (event.target.closest("[data-back-to-leads]")) { currentLeadId = null; showLeadsView(); return; }
  if (event.target.closest("[data-edit-lead]")) { const lead = await getLeadById(currentLeadId); document.querySelector("#leadEditPanel").innerHTML = renderEditForm(lead); return; }
  if (event.target.closest("[data-cancel-edit]")) { document.querySelector("#leadEditPanel").innerHTML = ""; return; }
  const action = event.target.closest("[data-action]"); if (action) runQuickAction(action.dataset.action);
});
document.addEventListener("input", (event) => { if (event.target.id === "leadsSearch") filterRows(); });
document.addEventListener("change", (event) => { if (event.target.id === "leadsChannelFilter") filterRows(); });
document.addEventListener("submit", async (event) => {
  const formType = event.target.dataset.form; if (!formType) return; event.preventDefault();
  const lead = await getLeadById(currentLeadId); const formData = new FormData(event.target); const data = Object.fromEntries(formData.entries());
  try {
    if (formType === "contact") await recordManualContact({ lead, description: data.description, status: data.status });
    if (formType === "schedule") await scheduleManualFollowUp({ lead, title: data.title, dueAt: data.dueAt });
    if (formType === "lost") await markLeadLost({ lead, reason: data.reason, note: data.note });
    if (formType === "edit") {
      const selected = [...event.target.querySelectorAll('input[name="tripIds"]:checked')];
      data.tripIds = JSON.stringify(selected.map((input) => input.value));
      data.tripLabels = JSON.stringify(selected.map((input) => input.dataset.tripLabel));
      await updateLead(currentLeadId, data);
    }
    await refreshDetail(); window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) { window.alert(formType === "edit" ? getLeadErrorMessage(error) : getWorkflowErrorMessage(error)); }
});
window.addEventListener("travelflow:lead-created", (event) => { if (event.detail?.id) showLeadDetail(event.detail.id); });
