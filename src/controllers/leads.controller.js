import { getLeadActivities, getLeadById, getLeadErrorMessage, getLeads, updateLead } from "../services/lead.service.js";
import { updateLeadEntryChannel } from "../services/lead-channel.service.js";
import { DEFAULT_TRIP_PRICE_CONCEPTS, getTrips } from "../services/trip.service.js";
import { LEAD_CHANNELS, LEAD_SOURCES } from "../config/app.constants.js";
import {
  addExpiredLeadToNextYear,
  declineExpiredLeadNextYear,
  ensureExpiredLeadNextYearTasks,
  getExpiredLeadFollowUpError
} from "../services/expired-lead-followup.service.js";
import {
  cancelBooking,
  confirmBooking,
  getLeadTasks,
  getWorkflowErrorMessage,
  markLeadLost,
  markNoResponse,
  markReplied,
  recordManualContact
} from "../services/workflow.service.js";
import { clearManualNextAction, saveManualNextAction } from "../services/next-action.service.js";
import { getTripInterestStatus, hasActiveTripInterests } from "../services/trip-interest.model.js";

const CHANNEL_LABELS = { WEB: "Web", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", EMAIL: "Email", PHONE: "Telèfon", OTHER: "Altres" };
const SOURCE_LABELS = { WEBSITE_FORM: "Formulari web", GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", INSTAGRAM_ORGANIC: "Instagram", FACEBOOK_ORGANIC: "Facebook", MANYCHAT: "ManyChat", REFERRAL: "Recomanació", RETURNING_CUSTOMER: "Clienta repetidora", MANUAL: "Entrada manual", OTHER: "Altres" };
const STATUS_LABELS = { NEW: "Nou", INFO_SENT: "Informació enviada", FOLLOW_UP: "En seguiment", REPLIED: "Ha contestat", PENDING_DECISION: "Pendent de decisió", BOOKING_CONFIRMED: "Reserva confirmada", CONTACT_LATER: "Contactar més endavant", LOST: "Perdut" };
const LOST_LABELS = { NO_RESPONSE: "Sense resposta", PRICE: "Preu", DATES: "Dates", HEALTH: "Salut", NO_HOLIDAYS: "No té vacances", BOOKED_ELSEWHERE: "Viatja amb una altra agència", DESTINATION: "Destinació no adequada", OTHER: "Altres" };
const ENTRY_PRESETS = {
  WEB_FORM: { label: "Formulari web", channel: LEAD_CHANNELS.WEB, source: LEAD_SOURCES.WEBSITE_FORM },
  GOOGLE_ADS: { label: "Google Ads", channel: LEAD_CHANNELS.WEB, source: LEAD_SOURCES.GOOGLE_ADS },
  WHATSAPP: { label: "WhatsApp", channel: LEAD_CHANNELS.WHATSAPP, source: LEAD_SOURCES.WHATSAPP },
  INSTAGRAM: { label: "Instagram", channel: LEAD_CHANNELS.INSTAGRAM, source: LEAD_SOURCES.INSTAGRAM_ORGANIC },
  FACEBOOK: { label: "Facebook", channel: LEAD_CHANNELS.FACEBOOK, source: LEAD_SOURCES.FACEBOOK_ORGANIC },
  REFERRAL: { label: "Recomanació", channel: LEAD_CHANNELS.OTHER, source: LEAD_SOURCES.REFERRAL },
  RETURNING_CUSTOMER: { label: "Clienta repetidora", channel: LEAD_CHANNELS.OTHER, source: LEAD_SOURCES.RETURNING_CUSTOMER },
  OTHER: { label: "Altres", channel: LEAD_CHANNELS.OTHER, source: LEAD_SOURCES.OTHER }
};

function formatCurrency(value) { return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0); }

function bookingConceptsForTrip(lead, tripId) {
  const trip = tripsCache.find((item) => item.id === tripId);
  const catalogue = Array.isArray(trip?.priceConcepts) ? trip.priceConcepts : DEFAULT_TRIP_PRICE_CONCEPTS;
  const saved = Array.isArray(lead?.tripInterests?.[tripId]?.bookingPriceConcepts) ? lead.tripInterests[tripId].bookingPriceConcepts : [];
  const savedById = new Map(saved.map((concept) => [concept.id, concept]));
  const concepts = catalogue.map((concept) => savedById.get(concept.id) || concept);
  saved.forEach((concept) => { if (!concepts.some((item) => item.id === concept.id)) concepts.push(concept); });
  return concepts.map((concept, index) => ({ ...concept, order: index, selected: concept.application === "REQUIRED" || savedById.has(concept.id) }));
}

function renderBookingConcepts(lead, tripId, active) {
  const concepts = bookingConceptsForTrip(lead, tripId);
  if (!concepts.length) return `<div class="booking-pricing-empty" data-booking-pricing="${tripId}" ${active ? "" : "hidden"}>Aquest viatge encara no té conceptes de preu.</div>`;
  const initialTotal = concepts.reduce((total, concept) => concept.selected && concept.application !== "INFORMATIONAL" ? total + (Number(concept.amount) || 0) : total, 0);
  return `<section class="booking-pricing" data-booking-pricing="${tripId}" ${active ? "" : "hidden"}><header><div><span>Conceptes contractats</span><small>Els obligatoris ja estan inclosos. Marca els opcionals que corresponguin.</small></div><strong data-booking-total>${formatCurrency(initialTotal)}</strong></header><div class="booking-pricing__list">${concepts.map((concept) => `<label class="booking-price-option ${concept.application === "REQUIRED" ? "is-required" : ""}"><input type="checkbox" name="bookingConceptId" value="${escapeHtml(concept.id)}" data-concept-name="${escapeHtml(concept.name)}" data-concept-amount="${Number(concept.amount) || 0}" data-concept-application="${concept.application}" data-concept-price-status="${concept.priceStatus}" ${concept.selected ? "checked" : ""} ${concept.application === "REQUIRED" ? "disabled" : ""}><span><strong>${escapeHtml(concept.name)}</strong><small>${concept.application === "REQUIRED" ? "Obligatori" : concept.application === "INFORMATIONAL" ? "Informatiu · no suma al total" : "Opcional"}${concept.priceStatus === "ESTIMATED" ? " · estimat" : ""}</small></span><b>${formatCurrency(concept.amount)}</b></label>`).join("")}</div></section>`;
}

let leadsCache = [];
let currentLeadId = null;
let tripsCache = [];

function root() { return document.querySelector(".app-content"); }
function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}
function dateInputValue(value) {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}
function initials(name = "") { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "FV"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function normalizeText(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
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
  const contacts = links.length ? `<div class="lead-contact-links">${links.join("")}</div>` : "";
  return `${contacts}<div class="lead-trip-relationships">${renderTripRelationships(lead)}</div>`;
}

function renderRows(leads) {
  if (!leads.length) return `<div class="leads-empty"><h2>No hi ha resultats</h2><p>Prova una altra cerca o crea una futura viatgera.</p></div>`;
  return leads.map((lead) => `<button class="lead-row" type="button" data-lead-id="${lead.id}"><span class="lead-row__person"><span class="lead-row__avatar">${initials(lead.fullName)}</span><span><strong>${escapeHtml(lead.fullName)}</strong><small>${escapeHtml(lead.email || lead.phone || "Sense contacte")}</small></span></span><span class="lead-row__interest">${escapeHtml(lead.tripLabels?.join(", ") || lead.interest || "Sense viatge")}</span><span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span><span class="lead-status">${STATUS_LABELS[lead.status] || lead.status}</span><span class="lead-row__date">${formatDate(lead.nextActionAt)}</span><span>→</span></button>`).join("");
}
function renderFilterOptions(items, labels, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${items.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value)}</option>`).join("")}`;
}
function getTripFilterOptions(leads) {
  const trips = new Map();
  leads.forEach((lead) => (lead.tripIds || []).forEach((tripId, index) => {
    if (tripId && !trips.has(tripId)) trips.set(tripId, lead.tripLabels?.[index] || lead.tripInterests?.[tripId]?.tripName || "Viatge");
  }));
  return [...trips.entries()].sort((a, b) => a[1].localeCompare(b[1], "ca"));
}
function renderList(leads) {
  const origins = [...new Set(leads.map((lead) => lead.source || lead.channel || "OTHER"))].sort((a, b) => (SOURCE_LABELS[a] || CHANNEL_LABELS[a] || a).localeCompare(SOURCE_LABELS[b] || CHANNEL_LABELS[b] || b, "ca"));
  const originLabels = { ...CHANNEL_LABELS, ...SOURCE_LABELS };
  const tripOptions = getTripFilterOptions(leads).map(([tripId, label]) => `<option value="${escapeHtml(tripId)}">${escapeHtml(label)}</option>`).join("");
  return `<section class="leads-page"><header class="page-heading"><div><span class="section-kicker">Gestió comercial</span><h1>Futures viatgeres</h1><p>Cerca, filtra i obre qualsevol historial comercial.</p></div><button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button></header><section class="leads-toolbar"><label class="leads-search leads-toolbar__field"><span>Cerca</span><input id="leadsSearch" type="search" placeholder="Nom, telèfon, correu o viatge..." /></label><label class="leads-toolbar__field"><span>Origen</span><select id="leadsSourceFilter" class="leads-filter">${renderFilterOptions(origins, originLabels, "Tots els orígens")}</select></label><label class="leads-toolbar__field"><span>Viatge</span><select id="leadsTripFilter" class="leads-filter"><option value="">Tots els viatges</option>${tripOptions}</select></label><label class="leads-toolbar__field"><span>Estat</span><select id="leadsStatusFilter" class="leads-filter">${renderFilterOptions(Object.keys(STATUS_LABELS), STATUS_LABELS, "Tots els estats")}</select></label><div class="leads-toolbar__actions"><div class="leads-count"><strong id="leadsCount">${leads.length}</strong> registrades</div><button class="secondary-button leads-clear-filters" type="button" data-clear-lead-filters>Netejar</button></div></section><section class="leads-table-card"><div class="leads-table-head"><span>Futura viatgera</span><span>Viatge</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div id="leadsRows">${renderRows(leads)}</div></section></section>`;
}
function renderTimeline(activities, tasks) {
  const items = [...activities.map((item) => ({ ...item, timelineDate: item.createdAt, pending: false })), ...tasks.filter((task) => task.status === "PENDING").map((task) => ({ description: task.title, timelineDate: task.dueAt, pending: true }))].sort((a, b) => (a.timelineDate?.toMillis?.() ?? 0) - (b.timelineDate?.toMillis?.() ?? 0));
  return items.length ? items.map((item) => `<article class="timeline-item ${item.pending ? "is-pending" : ""}"><span class="timeline-item__dot"></span><div><strong>${escapeHtml(item.description || "Activitat")}</strong><small>${formatDate(item.timelineDate, true)}${item.pending ? " · Pendent" : ""}</small></div></article>`).join("") : `<p>Encara no hi ha activitat.</p>`;
}
function renderTripStatusOptions(status) { return Object.entries(STATUS_LABELS).filter(([value]) => value !== "BOOKING_CONFIRMED" || status === value).map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`).join(""); }
function renderTripOptions(lead) { const selected = new Set(lead.tripIds || []); return tripsCache.map((trip) => { const status = getTripInterestStatus(lead, trip.id); return `<label class="lead-edit-trip" data-trip-option><input type="checkbox" name="tripIds" value="${trip.id}" data-trip-label="${escapeHtml(trip.name)}" ${selected.has(trip.id) ? "checked" : ""}><span>${escapeHtml(trip.name)}</span><select data-trip-status="${trip.id}" aria-label="Estat per ${escapeHtml(trip.name)}" ${selected.has(trip.id) ? "" : "disabled"}>${renderTripStatusOptions(status)}</select></label>`; }).join(""); }
function renderTripSearch() { return `<label class="trip-tag-search"><span class="trip-tag-search__label">Buscar etiqueta</span><span class="trip-tag-search__control"><span aria-hidden="true">⌕</span><input type="search" placeholder="Escriu el nom del viatge..." autocomplete="off" data-trip-tag-search /></span></label><p class="trip-tag-search__empty" data-trip-tag-search-empty hidden>No hi ha cap etiqueta que coincideixi amb la cerca.</p>`; }
function currentEntryPreset(lead) { if (lead.entryPreset && ENTRY_PRESETS[lead.entryPreset]) return lead.entryPreset; return Object.entries(ENTRY_PRESETS).find(([, preset]) => preset.channel === lead.channel && preset.source === lead.source)?.[0] || "OTHER"; }
function renderEntryOptions(lead) { const selected = currentEntryPreset(lead); return Object.entries(ENTRY_PRESETS).map(([value, preset]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${preset.label}</option>`).join(""); }
function renderEditForm(lead) { return `<form class="lead-edit-form" data-form="edit"><div class="lead-edit-grid"><label>Nom *<input name="firstName" required value="${escapeHtml(lead.firstName || "")}"></label><label>Cognoms<input name="lastName" value="${escapeHtml(lead.lastName || "")}"></label><label>Telèfon<input name="phone" value="${escapeHtml(lead.phone || "")}"></label><label>Correu<input name="email" type="email" value="${escapeHtml(lead.email || "")}"></label><label>Instagram<input name="instagramHandle" value="${escapeHtml(lead.instagramHandle || "")}"></label><label>Facebook<input name="facebookUrl" value="${escapeHtml(lead.facebookUrl || "")}"></label><label>Canal d'entrada<select name="entryPreset">${renderEntryOptions(lead)}</select></label></div><label>Observacions<textarea name="notes">${escapeHtml(lead.notes || "")}</textarea></label><fieldset class="lead-edit-trips"><legend>Viatges i estat comercial</legend><p class="lead-edit-trips__hint">Cada viatge conserva el seu propi estat. Una reserva no tanca els altres interessos.</p>${renderTripSearch()}<div class="trip-tag-options-list">${renderTripOptions(lead)}</div></fieldset><div class="lead-edit-actions"><button type="button" class="secondary-button" data-cancel-edit>Cancel·lar</button><button class="primary-button primary-button--compact">Guardar canvis</button></div></form>`; }

function renderTripRelationships(lead) { return (lead.tripIds || []).map((tripId, index) => { const status = getTripInterestStatus(lead, tripId); const interest = lead.tripInterests?.[tripId] || {}; const dui = interest.dui || (lead.bookingTripId === tripId && lead.bookingDui); const booked = status === "BOOKING_CONFIRMED"; const hasPricing = Array.isArray(interest.bookingPriceConcepts); return `<article><div><strong>${escapeHtml(lead.tripLabels?.[index] || interest.tripName || "Viatge")}</strong><span class="lead-status">${STATUS_LABELS[status] || status}</span></div><small>${booked ? `Reserva confirmada${dui ? " · DUI" : ""}${hasPricing ? ` · Total ${formatCurrency(interest.bookingTotal)}` : " · Preu pendent"}` : "Interès actiu"}</small><div class="lead-trip-booking-actions">${booked ? `<button type="button" data-edit-trip-booking="${tripId}">Editar reserva</button><button class="is-danger" type="button" data-cancel-trip-booking="${tripId}">Cancel·lar</button>` : `<button type="button" data-confirm-trip-booking="${tripId}">Confirmar reserva</button>`}</div></article>`; }).join("") || "<p>Encara no hi ha cap viatge vinculat.</p>"; }
function renderExpiredLeadBanner(lead, tasks) { const pendingTask = tasks.find((task) => task.status === "PENDING" && task.type === "NEXT_YEAR_INTEREST"); if (!lead.lostAutomatically || !pendingTask) return ""; return `<section class="lead-action-panel"><div><span class="section-kicker">Viatge finalitzat</span><h2>Vols preguntar-li si vol viatjar l’any vinent?</h2><p>Aquest lead ha passat a perdut perquè el viatge ja ha finalitzat. Pots mantenir el contacte afegint-la a un viatge del proper any.</p></div><div class="lead-edit-actions"><button class="primary-button primary-button--compact" type="button" data-action="next-year">Afegir a interessades proper any</button><button class="secondary-button" type="button" data-action="decline-next-year">No està interessada</button></div></section>`; }

function renderDetail(lead, activities, tasks) {
  const pending = tasks.find((task) => task.status === "PENDING");
  const terminal = lead.status === "LOST" || (lead.status === "BOOKING_CONFIRMED" && !hasActiveTripInterests(lead));
  const nextTitle = terminal ? "Sense acció" : pending?.title || lead.nextActionTitle || "Sense acció";
  const nextDate = terminal ? null : pending?.dueAt || lead.nextActionAt;
  const trip = lead.tripLabels?.join(", ") || lead.interest || "Sense viatge";
  return `<section class="lead-detail-page"><button class="lead-detail-back" type="button" data-back-to-leads>← Tornar</button><header class="lead-detail-hero"><div class="lead-detail-hero__avatar">${initials(lead.fullName)}</div><div class="lead-detail-hero__content"><span class="section-kicker">Futura viatgera</span><h1>${escapeHtml(lead.fullName)}</h1><div class="lead-detail-hero__meta"><span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span><span>${escapeHtml(trip)}</span></div>${renderContactLinks(lead)}</div><button class="secondary-button" type="button" data-edit-lead>Editar dades i etiquetes</button></header>${renderExpiredLeadBanner(lead, tasks)}<section id="leadEditPanel"></section><section class="lead-summary-grid"><article><span>Estat</span><strong>${STATUS_LABELS[lead.status] || lead.status}</strong></article><article><span>Viatge</span><strong>${escapeHtml(trip)}</strong></article><article><span>Pròxima acció</span><strong>${escapeHtml(nextTitle)}</strong>${terminal ? "" : '<button class="link-button" type="button" data-action="edit-next-action">Editar pròxima acció</button>'}</article><article><span>Data pròxima acció</span><strong>${formatDate(nextDate)}</strong></article><article><span>Sense resposta</span><strong>${Number(lead.noResponseCount || 0)} de 2</strong></article></section><section class="lead-quick-actions"><button data-action="contact">Afegir contacte</button><button data-action="replied">Ha contestat</button><button data-action="no-response">Sense resposta</button><button data-action="schedule">Programar seguiment</button><button data-action="booking">Reserva confirmada</button><button class="is-danger" data-action="lost">Marcar com a perdut</button></section><section class="lead-action-panel" id="leadActionPanel"></section><div class="lead-detail-grid"><article class="content-card lead-detail-card"><header><span class="section-kicker">Contacte</span><h2>Dades principals</h2></header><dl class="lead-data-list"><div><dt>Telèfon</dt><dd>${escapeHtml(lead.phone || "—")}</dd></div><div><dt>Correu</dt><dd>${escapeHtml(lead.email || "—")}</dd></div>${lead.instagramHandle ? `<div><dt>Instagram</dt><dd>${escapeHtml(lead.instagramHandle)}</dd></div>` : ""}${lead.facebookUrl ? `<div><dt>Facebook</dt><dd>Enllaç guardat</dd></div>` : ""}<div><dt>Canal</dt><dd>${CHANNEL_LABELS[lead.channel] || "Altres"}</dd></div><div><dt>Alta</dt><dd>${formatDate(lead.createdAt)}</dd></div></dl>${lead.notes ? `<div class="lead-notes"><span>Observacions</span><p>${escapeHtml(lead.notes)}</p></div>` : ""}</article><article class="content-card lead-detail-card"><header><span class="section-kicker">Historial complet</span><h2>Interaccions comercials</h2></header><div class="timeline">${renderTimeline(activities, tasks)}</div></article></div></section>`;
}

function renderActionForm(action, lead = null, pending = null, selectedTripId = "") {
  if (action === "contact") return `<form class="lead-inline-form" data-form="contact"><label>Interacció o nota<textarea name="description" required placeholder="Ex. Informació enviada per WhatsApp"></textarea></label><label>Estat<select name="status"><option value="INFO_SENT">Informació enviada</option><option value="FOLLOW_UP">En seguiment</option><option value="PENDING_DECISION">Pendent de decisió</option></select></label><button class="primary-button primary-button--compact">Guardar contacte</button></form>`;
  if (action === "schedule" || action === "edit-next-action") {
    const title = pending?.title || lead?.nextActionTitle || "";
    const dueAt = pending?.dueAt || lead?.nextActionAt || null;
    return `<form class="lead-inline-form" data-form="next-action"><label>Títol de l'acció<input name="title" required value="${escapeHtml(title)}" placeholder="Ex. Trucar clienta" /></label><label>Data<input name="dueAt" type="date" required value="${dateInputValue(dueAt)}" /></label><div class="lead-edit-actions"><button class="primary-button primary-button--compact" type="submit">Guardar</button><button class="secondary-button" type="button" data-cancel-next-action>Cancel·lar</button>${title || dueAt ? '<button class="secondary-button is-danger" type="button" data-remove-next-action>Eliminar pròxima acció</button>' : ""}</div></form>`;
  }
  if (action === "lost") return `<form class="lead-inline-form" data-form="lost"><label>Motiu obligatori<select name="reason" required><option value="">Selecciona...</option>${Object.entries(LOST_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>Observacions<textarea name="note"></textarea></label><button class="primary-button primary-button--compact">Confirmar pèrdua</button></form>`;
  if (action === "booking") {
    const selectedIndex = lead?.tripIds?.indexOf(selectedTripId) ?? -1;
    const selectedName = selectedIndex >= 0 ? lead.tripLabels?.[selectedIndex] || lead.tripInterests?.[selectedTripId]?.tripName || "Viatge" : "";
    const selectedDui = selectedTripId ? Boolean(lead.tripInterests?.[selectedTripId]?.dui || (lead.bookingTripId === selectedTripId && lead.bookingDui)) : Boolean(lead.bookingDui);
    const activeTripId = selectedTripId || lead.bookingTripId || "";
    const options = (lead?.tripIds || []).map((tripId, index) => `<option value="${tripId}" ${activeTripId === tripId ? "selected" : ""}>${escapeHtml(lead.tripLabels?.[index] || "Viatge")}</option>`).join("");
    const pricing = (lead?.tripIds || []).map((tripId) => renderBookingConcepts(lead, tripId, activeTripId === tripId)).join("");
    return `<form class="lead-inline-form lead-booking-form" data-form="booking">${selectedTripId ? `<label>Viatge de la reserva<input type="hidden" name="tripId" value="${selectedTripId}"><input value="${escapeHtml(selectedName)}" disabled></label>` : `<label>Viatge de la reserva<select name="tripId" required><option value="">Selecciona...</option>${options}</select></label>`}<label class="checkbox-field"><input type="checkbox" name="dui" ${selectedDui ? "checked" : ""}><span>DUI · Habitació doble d'ús individual</span></label>${pricing}<button class="primary-button primary-button--compact">Guardar reserva</button></form>`;
  }
  if (action === "next-year") { const nextYear = new Date().getFullYear() + 1; const options = tripsCache.filter((trip) => Number(trip.year) >= nextYear).map((trip) => `<option value="${trip.id}">${escapeHtml(trip.name)}</option>`).join(""); return `<form class="lead-inline-form" data-form="next-year"><label>Viatge del proper any<select name="tripId" required><option value="">Selecciona...</option>${options}</select></label><div></div><button class="primary-button primary-button--compact">Afegir a la llista</button></form>`; }
  return "";
}

async function refreshDetail() { if (!currentLeadId) return; const [lead, activities, tasks, trips] = await Promise.all([getLeadById(currentLeadId), getLeadActivities(currentLeadId), getLeadTasks(currentLeadId), getTrips()]); tripsCache = trips; root().innerHTML = renderDetail(lead, activities, tasks); }
export async function showLeadsView() { root().innerHTML = loading(); try { leadsCache = await getLeads(); await ensureExpiredLeadNextYearTasks(); root().innerHTML = renderList(leadsCache); } catch (error) { root().innerHTML = `<div class="leads-error">${getLeadErrorMessage(error)}</div>`; } }

window.addEventListener("travelflow:restore-navigation", (event) => {
  currentLeadId = event.detail?.currentLeadId || null;
});
export async function showLeadDetail(leadId) { currentLeadId = leadId; root().innerHTML = loading(); try { await refreshDetail(); } catch (error) { root().innerHTML = `<div class="leads-error">${getLeadErrorMessage(error)}</div>`; } }
function filterRows() {
  const search = normalizeText(document.querySelector("#leadsSearch")?.value || "");
  const source = document.querySelector("#leadsSourceFilter")?.value || "";
  const tripId = document.querySelector("#leadsTripFilter")?.value || "";
  const status = document.querySelector("#leadsStatusFilter")?.value || "";
  const filtered = leadsCache.filter((lead) => {
    const matchesSearch = !search || normalizeText([lead.fullName, lead.phone, lead.email, lead.instagramHandle, lead.interest, ...(lead.tripLabels || [])].join(" ")).includes(search);
    const matchesSource = !source || (lead.source || lead.channel || "OTHER") === source;
    const matchesTrip = !tripId || lead.tripIds?.includes(tripId);
    const relevantStatus = tripId ? getTripInterestStatus(lead, tripId) : lead.status;
    return matchesSearch && matchesSource && matchesTrip && (!status || relevantStatus === status);
  });
  document.querySelector("#leadsRows").innerHTML = renderRows(filtered);
  document.querySelector("#leadsCount").textContent = filtered.length;
  document.querySelectorAll("#leadsSourceFilter, #leadsTripFilter, #leadsStatusFilter").forEach((select) => select.classList.toggle("leads-filter-active", Boolean(select.value)));
}
function filterEditTripOptions(searchInput) { const fieldset = searchInput.closest(".lead-edit-trips"); if (!fieldset) return; const query = normalizeText(searchInput.value); const options = [...fieldset.querySelectorAll("[data-trip-option]")]; let visible = 0; options.forEach((option) => { const matches = !query || normalizeText(option.textContent).includes(query); option.hidden = !matches; if (matches) visible += 1; }); const empty = fieldset.querySelector("[data-trip-tag-search-empty]"); if (empty) empty.hidden = visible > 0; }
async function runQuickAction(action) {
  const lead = await getLeadById(currentLeadId);
  if (["contact", "schedule", "lost", "next-year", "edit-next-action", "booking"].includes(action)) {
    const tasks = action === "edit-next-action" ? await getLeadTasks(currentLeadId) : [];
    const pending = tasks.find((task) => task.status === "PENDING") || null;
    document.querySelector("#leadActionPanel").innerHTML = renderActionForm(action, lead, pending);
    return;
  }
  try {
    if (action === "replied") await markReplied(lead);
    if (action === "no-response") await markNoResponse(lead);
    if (action === "decline-next-year" && window.confirm("Confirmes que no vol entrar al llistat del proper any?")) await declineExpiredLeadNextYear(lead.id);
    await refreshDetail();
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) { window.alert(action === "decline-next-year" ? getExpiredLeadFollowUpError(error) : getWorkflowErrorMessage(error)); }
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest(".sidebar-nav__item");
  if (nav?.textContent.trim().startsWith("Leads")) { showLeadsView(); return; }
  const row = event.target.closest("[data-lead-id]"); if (row) { showLeadDetail(row.dataset.leadId); return; }
  if (event.target.closest("[data-back-to-leads]")) { currentLeadId = null; showLeadsView(); return; }
  if (event.target.closest("[data-edit-lead]")) { const lead = await getLeadById(currentLeadId); document.querySelector("#leadEditPanel").innerHTML = renderEditForm(lead); return; }
  if (event.target.closest("[data-cancel-edit]")) { document.querySelector("#leadEditPanel").innerHTML = ""; return; }
  if (event.target.closest("[data-cancel-next-action]")) { document.querySelector("#leadActionPanel").innerHTML = ""; return; }
  const tripBookingButton = event.target.closest("[data-confirm-trip-booking], [data-edit-trip-booking]");
  if (tripBookingButton) {
    const lead = await getLeadById(currentLeadId);
    const tripId = tripBookingButton.dataset.confirmTripBooking || tripBookingButton.dataset.editTripBooking;
    document.querySelector("#leadActionPanel").innerHTML = renderActionForm("booking", lead, null, tripId);
    document.querySelector("#leadActionPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const cancelTripBookingButton = event.target.closest("[data-cancel-trip-booking]");
  if (cancelTripBookingButton) {
    if (!window.confirm("Vols cancel·lar aquesta reserva? El viatge tornarà a quedar en seguiment.")) return;
    try { const lead = await getLeadById(currentLeadId); await cancelBooking(lead, { tripId: cancelTripBookingButton.dataset.cancelTripBooking }); await refreshDetail(); window.dispatchEvent(new CustomEvent("travelflow:tasks-updated")); }
    catch (error) { window.alert(getWorkflowErrorMessage(error)); }
    return;
  }
  if (event.target.closest("[data-remove-next-action]")) {
    if (!window.confirm("Vols eliminar la pròxima acció i cancel·lar totes les tasques pendents?")) return;
    try { const lead = await getLeadById(currentLeadId); await clearManualNextAction({ lead }); await refreshDetail(); window.dispatchEvent(new CustomEvent("travelflow:tasks-updated")); }
    catch (error) { window.alert(getWorkflowErrorMessage(error)); }
    return;
  }
  const action = event.target.closest("[data-action]"); if (action) runQuickAction(action.dataset.action);
});
document.addEventListener("input", (event) => { if (event.target.id === "leadsSearch") filterRows(); if (event.target.matches(".lead-edit-form [data-trip-tag-search]")) filterEditTripOptions(event.target); });
document.addEventListener("change", (event) => {
  if (event.target.matches("#leadsSourceFilter, #leadsTripFilter, #leadsStatusFilter")) filterRows();
  if (event.target.matches('.lead-booking-form select[name="tripId"]')) {
    event.target.closest("form").querySelectorAll("[data-booking-pricing]").forEach((section) => { section.hidden = section.dataset.bookingPricing !== event.target.value; });
    refreshBookingTotal(event.target.closest("form"));
  }
  if (event.target.matches('.lead-booking-form input[name="bookingConceptId"]')) refreshBookingTotal(event.target.closest("form"));
  if (event.target.matches('.lead-edit-form input[name="tripIds"]')) {
    const status = event.target.closest("[data-trip-option]")?.querySelector("[data-trip-status]");
    if (status) status.disabled = !event.target.checked;
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-clear-lead-filters]")) return;
  ["leadsSearch", "leadsSourceFilter", "leadsTripFilter", "leadsStatusFilter"].forEach((id) => { const field = document.getElementById(id); if (field) field.value = ""; });
  filterRows();
});
document.addEventListener("submit", async (event) => {
  const formType = event.target.dataset.form; if (!formType) return; event.preventDefault();
  const lead = await getLeadById(currentLeadId); const formData = new FormData(event.target); const data = Object.fromEntries(formData.entries());
  try {
    if (formType === "contact") await recordManualContact({ lead, description: data.description, status: data.status });
    if (formType === "next-action") await saveManualNextAction({ lead, title: data.title, dueAt: data.dueAt });
    if (formType === "lost") await markLeadLost({ lead, reason: data.reason, note: data.note });
    if (formType === "next-year") await addExpiredLeadToNextYear({ leadId: currentLeadId, tripId: data.tripId });
    if (formType === "booking") {
      const pricing = event.target.querySelector(`[data-booking-pricing="${CSS.escape(data.tripId)}"]`);
      const priceConcepts = [...(pricing?.querySelectorAll('input[type="checkbox"][name="bookingConceptId"]:checked') || [])].map((input) => ({ id: input.value, name: input.dataset.conceptName, amount: input.dataset.conceptAmount, application: input.dataset.conceptApplication, priceStatus: input.dataset.conceptPriceStatus }));
      await confirmBooking(lead, { tripId: data.tripId, dui: formData.has("dui"), priceConcepts });
    }
    if (formType === "edit") { const selected = [...event.target.querySelectorAll('input[name="tripIds"]:checked')]; data.tripIds = JSON.stringify(selected.map((input) => input.value)); data.tripLabels = JSON.stringify(selected.map((input) => input.dataset.tripLabel)); data.tripStatuses = JSON.stringify(Object.fromEntries(selected.map((input) => [input.value, event.target.querySelector(`[data-trip-status="${input.value}"]`)?.value || "NEW"]))); await updateLead(currentLeadId, data, lead); const preset = ENTRY_PRESETS[data.entryPreset] || ENTRY_PRESETS.OTHER; await updateLeadEntryChannel(currentLeadId, { ...preset, entryPreset: data.entryPreset || "OTHER", entryLabel: preset.label }, lead); }
    await refreshDetail(); window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
  } catch (error) { window.alert(formType === "edit" ? getLeadErrorMessage(error) : formType === "next-year" ? getExpiredLeadFollowUpError(error) : getWorkflowErrorMessage(error)); }
});

function refreshBookingTotal(form) {
  const tripId = form?.querySelector('[name="tripId"]')?.value;
  const section = tripId ? form.querySelector(`[data-booking-pricing="${CSS.escape(tripId)}"]`) : null;
  if (!section) return;
  const total = [...section.querySelectorAll('input[type="checkbox"][name="bookingConceptId"]:checked')].reduce((sum, input) => input.dataset.conceptApplication === "INFORMATIONAL" ? sum : sum + (Number(input.dataset.conceptAmount) || 0), 0);
  const output = section.querySelector("[data-booking-total]");
  if (output) output.textContent = formatCurrency(total);
}
window.addEventListener("travelflow:lead-created", (event) => { if (event.detail?.id) showLeadDetail(event.detail.id); });
