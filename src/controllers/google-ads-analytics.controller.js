import { getGoogleAdsLeads, invalidateGoogleAdsReportCache } from "../services/google-ads-analytics.service.js";
import { getTripInterestStatus, isBookedForTrip } from "../services/trip-interest.model.js";
import { showAnalyticsView } from "./analytics.controller.js";

const STATUS_LABELS = {
  NEW: "Nou", INFO_SENT: "Informació enviada", FOLLOW_UP: "En seguiment", REPLIED: "Ha contestat",
  PENDING_DECISION: "Pendent de decisió", CONTACT_LATER: "Contactar més endavant",
  BOOKING_CONFIRMED: "Reserva confirmada", CANCELLED: "Reserva cancel·lada", LOST: "Perdut"
};
const LOST_LABELS = {
  NO_RESPONSE: "Sense resposta", PRICE: "Preu", DATES: "Dates", HEALTH: "Salut",
  NO_HOLIDAYS: "No té vacances", BOOKED_ELSEWHERE: "Viatja amb una altra agència",
  DESTINATION: "Destinació no adequada", OTHER: "Altres"
};
const TERMINAL = new Set(["BOOKING_CONFIRMED", "CANCELLED", "LOST"]);

let reportState = {
  leads: [], range: "month", startDate: "", endDate: "", method: "", tripId: "", campaignId: "",
  updatedAt: null, loadingToken: 0
};

function root() { return document.querySelector(".app-content"); }
function esc(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function toDate(value) { if (!value) return null; if (typeof value.toDate === "function") return value.toDate(); const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function startOfDay(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function endOfDay(value) { const date = new Date(value); date.setHours(23, 59, 59, 999); return date; }
function localIso(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function percent(part, total) { return total ? Math.round((part / total) * 1000) / 10 : 0; }
function formatPercent(value) { return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value)}%`; }
function formatMoney(value) { return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value) || 0); }
function formatDate(value) { const date = toDate(value); return date ? new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "—"; }

function presetBounds(range) {
  const now = new Date();
  const end = endOfDay(now);
  if (range === "week") { const start = startOfDay(now); const day = start.getDay() || 7; start.setDate(start.getDate() - day + 1); return { start, end }; }
  if (range === "year") return { start: new Date(now.getFullYear(), 0, 1), end };
  if (range === "all") return { start: new Date(2000, 0, 1), end };
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
}

function currentBounds() {
  if (reportState.range === "custom" && reportState.startDate && reportState.endDate) {
    return { start: startOfDay(new Date(`${reportState.startDate}T12:00:00`)), end: endOfDay(new Date(`${reportState.endDate}T12:00:00`)) };
  }
  return presetBounds(reportState.range);
}

function previousBounds(bounds) {
  if (reportState.range === "all") return null;
  const duration = bounds.end.getTime() - bounds.start.getTime() + 1;
  return { start: new Date(bounds.start.getTime() - duration), end: new Date(bounds.start.getTime() - 1) };
}

function entryMethod(lead) { return lead.googleAdsEntryMethod || "OTHER"; }
function methodLabel(method) { return ({ FORM: "Formulari", WHATSAPP: "WhatsApp", OTHER: "Sense identificar" })[method] || method; }
function statusFor(lead, tripId = reportState.tripId) { return tripId ? getTripInterestStatus(lead, tripId) : lead.status || "NEW"; }
function isBooked(lead, tripId = reportState.tripId) {
  if (tripId) return isBookedForTrip(lead, tripId);
  return lead.status === "BOOKING_CONFIRMED" || Object.values(lead.tripInterests || {}).some((interest) => interest?.status === "BOOKING_CONFIRMED");
}
function wasConverted(lead, tripId = reportState.tripId) {
  if (isBooked(lead, tripId)) return true;
  if (tripId) { const interest = lead.tripInterests?.[tripId]; return interest?.status === "CANCELLED" && Boolean(interest.bookedAt); }
  return Object.values(lead.tripInterests || {}).some((interest) => ["BOOKING_CONFIRMED", "CANCELLED"].includes(interest?.status) && Boolean(interest.bookedAt));
}
function isLost(lead, tripId = reportState.tripId) { return statusFor(lead, tripId) === "LOST"; }
function lostReason(lead, tripId = reportState.tripId) { return tripId ? lead.tripInterests?.[tripId]?.lostReason || lead.lostReason || "OTHER" : lead.lostReason || "OTHER"; }
function hasActiveOpportunity(lead) {
  if (reportState.tripId) return !TERMINAL.has(statusFor(lead));
  if (!TERMINAL.has(lead.status || "NEW")) return true;
  return (lead.tripIds || []).some((tripId) => !TERMINAL.has(getTripInterestStatus(lead, tripId)));
}
function bookingValue(lead) {
  const interests = Object.entries(lead.tripInterests || {}).filter(([tripId, interest]) => (!reportState.tripId || tripId === reportState.tripId) && interest?.status === "BOOKING_CONFIRMED");
  if (interests.length) return interests.reduce((sum, [, interest]) => sum + (Number(interest.bookingTotal) || 0), 0);
  return isBooked(lead) ? Number(lead.bookingTotal) || 0 : 0;
}

function basePeriodLeads(bounds) {
  return reportState.leads.filter((lead) => { const created = toDate(lead.createdAt); return created && created >= bounds.start && created <= bounds.end; });
}
function matchesReportFilters(lead, { ignoreMethod = false } = {}) {
  if (!ignoreMethod && reportState.method && entryMethod(lead) !== reportState.method) return false;
  if (reportState.tripId && !(lead.tripIds || []).includes(reportState.tripId)) return false;
  if (reportState.campaignId && (lead.googleAdsCampaignId || "") !== reportState.campaignId) return false;
  return true;
}
function selectedLeads(bounds = currentBounds(), options = {}) { return basePeriodLeads(bounds).filter((lead) => matchesReportFilters(lead, options)); }
function groupBy(items, getKey) { return items.reduce((map, item) => { const key = getKey(item); if (!map.has(key)) map.set(key, []); map.get(key).push(item); return map; }, new Map()); }

function metric(label, value, hint, accent = "") {
  return `<article class="ga-report-metric ${accent ? `is-${accent}` : ""}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`;
}

function aggregateTrips(leads) {
  const rows = new Map();
  leads.forEach((lead) => (lead.tripIds || []).forEach((tripId, index) => {
    if (reportState.tripId && tripId !== reportState.tripId) return;
    if (!rows.has(tripId)) rows.set(tripId, { id: tripId, name: lead.tripLabels?.[index] || lead.tripInterests?.[tripId]?.tripName || "Viatge", leads: [] });
    rows.get(tripId).leads.push(lead);
  }));
  return [...rows.values()].map((row) => {
    const bookings = row.leads.filter((lead) => isBooked(lead, row.id)).length;
    const lost = row.leads.filter((lead) => isLost(lead, row.id));
    const value = row.leads.reduce((sum, lead) => { const interest = lead.tripInterests?.[row.id]; return sum + (interest?.status === "BOOKING_CONFIRMED" ? Number(interest.bookingTotal) || 0 : 0); }, 0);
    const reasons = [...groupBy(lost, (lead) => lostReason(lead, row.id)).entries()].sort((a, b) => b[1].length - a[1].length);
    return { ...row, count: row.leads.length, bookings, lost: lost.length, value, conversion: percent(bookings, row.leads.length), reason: reasons[0] ? LOST_LABELS[reasons[0][0]] || "Altres" : "—" };
  }).sort((a, b) => b.count - a.count);
}

function aggregateCampaigns(leads) {
  return [...groupBy(leads.filter((lead) => entryMethod(lead) === "FORM"), (lead) => lead.googleAdsCampaignId || "UNATTRIBUTED").entries()].map(([id, rows]) => ({
    id, label: id === "UNATTRIBUTED" ? "Sense campanya identificada" : id,
    leads: rows.length, bookings: rows.filter((lead) => isBooked(lead)).length,
    lost: rows.filter((lead) => isLost(lead)).length,
    conversion: percent(rows.filter((lead) => isBooked(lead)).length, rows.length)
  })).sort((a, b) => b.leads - a.leads);
}

function renderFilters() {
  const bounds = currentBounds();
  const current = basePeriodLeads(bounds);
  const trips = new Map();
  current.forEach((lead) => (lead.tripIds || []).forEach((id, index) => trips.set(id, lead.tripLabels?.[index] || lead.tripInterests?.[id]?.tripName || "Viatge")));
  const campaigns = [...new Set(current.filter((lead) => entryMethod(lead) === "FORM").map((lead) => lead.googleAdsCampaignId).filter(Boolean))].sort();
  return `<section class="ga-report-filters no-print"><div class="ga-report-range">${[["week", "Setmana"], ["month", "Mes"], ["year", "Any"], ["all", "Tot"], ["custom", "Personalitzat"]].map(([value, label]) => `<button type="button" data-ga-range="${value}" class="${reportState.range === value ? "is-active" : ""}">${label}</button>`).join("")}</div><div class="ga-report-filter-grid"><label>Mètode<select data-ga-filter="method"><option value="">WhatsApp i formulari</option><option value="WHATSAPP" ${reportState.method === "WHATSAPP" ? "selected" : ""}>WhatsApp</option><option value="FORM" ${reportState.method === "FORM" ? "selected" : ""}>Formulari</option></select></label><label>Viatge<select data-ga-filter="tripId"><option value="">Tots els viatges</option>${[...trips.entries()].sort((a, b) => a[1].localeCompare(b[1], "ca")).map(([id, name]) => `<option value="${esc(id)}" ${reportState.tripId === id ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label><label>Campanya del formulari<select data-ga-filter="campaignId"><option value="">Totes les campanyes</option>${campaigns.map((id) => `<option value="${esc(id)}" ${reportState.campaignId === id ? "selected" : ""}>${esc(id)}</option>`).join("")}</select></label><div class="ga-report-custom ${reportState.range === "custom" ? "is-visible" : ""}"><label>Des de<input type="date" data-ga-filter="startDate" value="${reportState.startDate}"></label><label>Fins a<input type="date" data-ga-filter="endDate" value="${reportState.endDate}"></label></div><button type="button" data-ga-reset>Restablir</button></div></section>`;
}

function renderMethodComparison(leads) {
  const rows = ["WHATSAPP", "FORM"].map((method) => { const items = leads.filter((lead) => entryMethod(lead) === method); const bookings = items.filter((lead) => isBooked(lead)).length; return { method, leads: items.length, bookings, lost: items.filter((lead) => isLost(lead)).length, conversion: percent(bookings, items.length) }; });
  return `<article class="ga-report-card"><header><div><span class="section-kicker">Entrada</span><h2>WhatsApp vs. formulari</h2></div></header><div class="ga-method-grid">${rows.map((row) => `<div><span>${methodLabel(row.method)}</span><strong>${row.leads}</strong><small>${row.bookings} reserves · ${formatPercent(row.conversion)} conversió · ${row.lost} perduts</small></div>`).join("")}</div></article>`;
}

function renderTrips(rows) {
  return `<article class="ga-report-card ga-report-wide"><header><div><span class="section-kicker">Demanda i resultat</span><h2>Rendiment per viatge</h2></div></header><div class="ga-report-table"><table><thead><tr><th>Viatge</th><th>Leads</th><th>Reserves</th><th>Conversió</th><th>Perduts</th><th>Valor reserves</th><th>Principal fre</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.count}</td><td>${row.bookings}</td><td>${formatPercent(row.conversion)}</td><td>${row.lost}</td><td>${formatMoney(row.value)}</td><td>${esc(row.reason)}</td></tr>`).join("") : '<tr><td colspan="7">No hi ha viatges vinculats en aquest període.</td></tr>'}</tbody></table></div></article>`;
}

function renderCampaigns(rows, formLeads) {
  const attributed = formLeads.filter((lead) => lead.googleAdsCampaignId).length;
  const themes = [...groupBy(formLeads, (lead) => lead.googleAdsSearchTheme || "Sense tema identificat").entries()].map(([label, values]) => ({ label, count: values.length, bookings: values.filter((lead) => isBooked(lead)).length })).sort((a, b) => b.count - a.count).slice(0, 8);
  return `<section class="ga-report-two"><article class="ga-report-card"><header><div><span class="section-kicker">Formularis</span><h2>Campanyes identificades</h2></div><span>${attributed} de ${formLeads.length} atribuïts</span></header><div class="ga-ranking">${rows.length ? rows.slice(0, 8).map((row) => `<div><span><strong>${esc(row.label)}</strong><small>${row.leads} leads · ${row.bookings} reserves · ${row.lost} perduts</small></span><b>${formatPercent(row.conversion)}</b></div>`).join("") : '<p>No hi ha formularis en aquest període.</p>'}</div></article><article class="ga-report-card"><header><div><span class="section-kicker">Cerca</span><h2>Temes de cerca</h2></div></header><div class="ga-ranking">${themes.length ? themes.map((row) => `<div><span><strong>${esc(row.label)}</strong><small>${row.bookings} reserves</small></span><b>${row.count}</b></div>`).join("") : '<p>No hi ha temes de cerca registrats.</p>'}</div></article></section>`;
}


function renderAdDetails(formLeads) {
  const aggregate = (field, emptyLabel) => [...groupBy(formLeads, (lead) => lead[field] || emptyLabel).entries()]
    .map(([label, values]) => ({ label, leads: values.length, bookings: values.filter((lead) => isBooked(lead)).length, lost: values.filter((lead) => isLost(lead)).length }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 10);
  const groups = aggregate("googleAdsAdGroupId", "Sense grup identificat");
  const ads = aggregate("googleAdsAdId", "Sense anunci identificat");
  const renderRows = (rows) => rows.length
    ? rows.map((row) => '<div><span><strong>' + esc(row.label) + '</strong><small>' + row.bookings + ' reserves · ' + row.lost + ' perduts</small></span><b>' + row.leads + '</b></div>').join("")
    : "<p>No hi ha dades registrades.</p>";
  return '<section class="ga-report-two"><article class="ga-report-card"><header><div><span class="section-kicker">Formularis</span><h2>Grups d’anuncis</h2></div></header><div class="ga-ranking">' + renderRows(groups) + '</div></article><article class="ga-report-card"><header><div><span class="section-kicker">Formularis</span><h2>Anuncis</h2></div></header><div class="ga-ranking">' + renderRows(ads) + '</div></article></section>';
}

function renderDataQuality(leads) {
  const withPhone = leads.filter((lead) => Boolean(lead.phoneNormalized || lead.phone)).length;
  const withEmail = leads.filter((lead) => Boolean(lead.email)).length;
  const withoutContact = leads.filter((lead) => !lead.phoneNormalized && !lead.phone && !lead.email).length;
  const duplicateKeys = new Map();
  leads.forEach((lead) => {
    const keys = [lead.phoneNormalized, lead.email?.toLowerCase()].filter(Boolean);
    keys.forEach((key) => duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1));
  });
  const possibleDuplicates = leads.filter((lead) => [lead.phoneNormalized, lead.email?.toLowerCase()].filter(Boolean).some((key) => (duplicateKeys.get(key) || 0) > 1)).length;
  const bookingDays = leads.map((lead) => {
    const booked = reportState.tripId ? toDate(lead.tripInterests?.[reportState.tripId]?.bookedAt) : toDate(lead.bookedAt);
    const created = toDate(lead.createdAt);
    return booked && created ? Math.max(0, (booked - created) / 86400000) : null;
  }).filter((value) => value != null);
  const lostDays = leads.map((lead) => {
    const lostAt = toDate(lead.lostAt);
    const created = toDate(lead.createdAt);
    return lostAt && created ? Math.max(0, (lostAt - created) / 86400000) : null;
  }).filter((value) => value != null);
  const average = (values) => values.length ? new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(values.reduce((sum, value) => sum + value, 0) / values.length) + " dies" : "—";
  return '<article class="ga-report-card ga-report-wide"><header><div><span class="section-kicker">Dades i velocitat</span><h2>Qualitat del registre</h2></div></header><div class="ga-follow-grid"><div><strong>' + withPhone + '</strong><span>amb telèfon</span></div><div><strong>' + withEmail + '</strong><span>amb correu</span></div><div><strong>' + withoutContact + '</strong><span>sense telèfon ni correu</span></div><div><strong>' + possibleDuplicates + '</strong><span>possibles duplicats</span></div><div><strong>' + average(bookingDays) + '</strong><span>temps mitjà fins a reserva</span></div><div><strong>' + average(lostDays) + '</strong><span>temps mitjà fins a pèrdua</span></div></div></article>';
}

function renderLosses(leads) {
  const lost = leads.filter((lead) => isLost(lead));
  const rows = [...groupBy(lost, (lead) => lostReason(lead)).entries()].map(([key, values]) => ({ label: LOST_LABELS[key] || "Altres", count: values.length, share: percent(values.length, lost.length) })).sort((a, b) => b.count - a.count);
  return `<article class="ga-report-card"><header><div><span class="section-kicker">Resultat comercial</span><h2>Motius de pèrdua</h2></div><span>${lost.length} perduts</span></header><div class="ga-ranking">${rows.length ? rows.map((row) => `<div><span><strong>${esc(row.label)}</strong><small>${formatPercent(row.share)} dels perduts</small></span><b>${row.count}</b></div>`).join("") : '<p>No hi ha leads perduts en aquest període.</p>'}</div></article>`;
}

function renderFollowUp(leads) {
  const now = new Date();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3);
  const active = leads.filter(hasActiveOpportunity);
  const noResponse = leads.filter((lead) => Number(lead.noResponseCount || 0) > 0).length;
  const repeated = leads.filter((lead) => Number(lead.noResponseCount || 0) >= 2).length;
  const overdue = active.filter((lead) => { const due = toDate(lead.nextActionAt); return due && due < now; }).length;
  const withoutAction = active.filter((lead) => !lead.nextActionAt).length;
  const stalled = active.filter((lead) => { const updated = toDate(lead.updatedAt) || toDate(lead.createdAt); return updated && updated < cutoff; }).length;
  return `<article class="ga-report-card"><header><div><span class="section-kicker">Seguiment</span><h2>Qualitat de la gestió</h2></div></header><div class="ga-follow-grid"><div><strong>${noResponse}</strong><span>amb algun intent sense resposta</span></div><div><strong>${repeated}</strong><span>amb dos o més intents</span></div><div><strong>${overdue}</strong><span>amb acció vençuda</span></div><div><strong>${withoutAction}</strong><span>actius sense pròxima acció</span></div><div><strong>${stalled}</strong><span>actius sense canvis en 3 dies</span></div></div></article>`;
}

function renderInsights(leads, trips) {
  if (!leads.length) return `<section class="ga-report-insights"><p>No hi ha leads de Google Ads amb els filtres seleccionats.</p></section>`;
  const topTrip = trips[0];
  const lost = leads.filter((lead) => isLost(lead));
  const topReason = [...groupBy(lost, (lead) => lostReason(lead)).entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const form = leads.filter((lead) => entryMethod(lead) === "FORM");
  const whatsapp = leads.filter((lead) => entryMethod(lead) === "WHATSAPP");
  const formConversion = percent(form.filter((lead) => isBooked(lead)).length, form.length);
  const whatsappConversion = percent(whatsapp.filter((lead) => isBooked(lead)).length, whatsapp.length);
  const items = [];
  if (topTrip) items.push(`${topTrip.name} és el viatge amb més interès: ${topTrip.count} leads i ${topTrip.bookings} reserves.`);
  if (topReason) items.push(`${LOST_LABELS[topReason[0]] || "Altres"} és el principal motiu de pèrdua (${topReason[1].length} casos).`);
  if (form.length && whatsapp.length) items.push(`${formConversion >= whatsappConversion ? "El formulari" : "WhatsApp"} presenta millor conversió: ${formatPercent(Math.max(formConversion, whatsappConversion))}.`);
  return `<section class="ga-report-insights"><header><span class="section-kicker">Lectura automàtica</span><h2>Conclusions del període</h2></header><div>${items.map((text) => `<p>${esc(text)}</p>`).join("")}</div></section>`;
}

function renderReport() {
  const bounds = currentBounds();
  const leads = selectedLeads(bounds);
  const previous = previousBounds(bounds);
  const previousLeads = previous ? selectedLeads(previous) : [];
  const bookings = leads.filter((lead) => isBooked(lead)).length;
  const conversions = leads.filter((lead) => wasConverted(lead)).length;
  const lost = leads.filter((lead) => isLost(lead)).length;
  const active = leads.filter(hasActiveOpportunity).length;
  const value = leads.reduce((sum, lead) => sum + bookingValue(lead), 0);
  const conversion = percent(conversions, leads.length);
  const priorConversion = percent(previousLeads.filter((lead) => wasConverted(lead)).length, previousLeads.length);
  const trips = aggregateTrips(leads);
  const formLeads = leads.filter((lead) => entryMethod(lead) === "FORM");
  const campaigns = aggregateCampaigns(leads);
  const dateLabel = `${formatDate(bounds.start)} — ${formatDate(bounds.end)}`;
  const freshness = reportState.updatedAt ? `Actualitzat a les ${reportState.updatedAt.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })}` : "";
  return `<section class="ga-report-page"><header class="ga-report-hero"><div><button type="button" class="ga-report-back no-print" data-back-commercial-analytics>← Tornar a Analítica</button><span class="section-kicker">Informe comercial · Google Ads</span><h1>Qualitat i conversió dels leads</h1><p>${dateLabel} · Resultats basats exclusivament en els leads registrats a TravelFlow.</p></div><aside class="no-print"><button type="button" data-ga-refresh>Actualitzar</button><button type="button" class="is-primary" data-ga-print>Imprimir / desar PDF</button><small>${freshness}</small></aside></header>${renderFilters()}<section class="ga-report-metrics">${metric("Leads", leads.length, previous ? `${previousLeads.length} al període anterior` : "Període complet", "brand")}${metric("Oportunitats actives", active, "Encara poden avançar")}${metric("Reserves actives", bookings, `${formatMoney(value)} de valor`, "success")}${metric("Conversions", conversions, "Inclou cancel·lacions posteriors")}${metric("Perduts", lost, `${formatPercent(percent(lost, leads.length))} del total`, lost ? "warning" : "")}${metric("Conversió", formatPercent(conversion), previous ? `${conversion - priorConversion >= 0 ? "+" : ""}${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(conversion - priorConversion)} punts` : "Sense comparativa", "dark")}</section>${renderInsights(leads, trips)}<section class="ga-report-two">${renderMethodComparison(leads)}${renderFollowUp(leads)}</section>${renderTrips(trips)}${renderCampaigns(campaigns, formLeads)}${renderAdDetails(formLeads)}${renderDataQuality(leads)}<section class="ga-report-two">${renderLosses(leads)}<article class="ga-report-card"><header><div><span class="section-kicker">Estat actual</span><h2>Distribució comercial</h2></div></header><div class="ga-ranking">${Object.entries(STATUS_LABELS).map(([key, label]) => { const count = leads.filter((lead) => statusFor(lead) === key).length; return count ? `<div><span><strong>${label}</strong></span><b>${count}</b></div>` : ""; }).join("") || "<p>Sense dades.</p>"}</div></article></section><footer class="ga-report-footer">TravelFlow · Dones i Viatgeres · Informe generat el ${new Intl.DateTimeFormat("ca-ES", { dateStyle: "long" }).format(new Date())}</footer></section>`;
}

async function loadReport({ force = false } = {}) {
  const container = root();
  if (!container) return;
  const token = ++reportState.loadingToken;
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Analítica" } }));
  container.innerHTML = '<section class="ga-report-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant l’informe de Google Ads...</p></div></section>';
  try {
    if (force) invalidateGoogleAdsReportCache();
    const current = currentBounds();
    const previous = previousBounds(current);
    const leads = await getGoogleAdsLeads({ start: previous?.start || current.start, end: current.end, force });
    if (token !== reportState.loadingToken) return;
    reportState.leads = leads;
    reportState.updatedAt = new Date();
    container.innerHTML = renderReport();
  } catch (error) {
    if (token !== reportState.loadingToken) return;
    console.error("No s'ha pogut preparar l'informe de Google Ads:", error);
    container.innerHTML = '<div class="leads-error">No s’ha pogut carregar l’informe de Google Ads.</div>';
  }
}

function rerender() { const container = root(); if (container?.querySelector(".ga-report-page")) container.innerHTML = renderReport(); }

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-google-ads-report]")) loadReport();
  if (event.target.closest("[data-back-commercial-analytics]")) showAnalyticsView();
  if (event.target.closest("[data-ga-refresh]")) loadReport({ force: true });
  if (event.target.closest("[data-ga-print]")) window.print();
  if (event.target.closest("[data-ga-reset]")) { reportState = { ...reportState, range: "month", startDate: "", endDate: "", method: "", tripId: "", campaignId: "" }; loadReport(); }
  const range = event.target.closest("[data-ga-range]");
  if (range) {
    reportState.range = range.dataset.gaRange;
    if (reportState.range === "custom" && (!reportState.startDate || !reportState.endDate)) { const defaults = presetBounds("month"); reportState.startDate = localIso(defaults.start); reportState.endDate = localIso(defaults.end); }
    loadReport();
  }
});

document.addEventListener("change", (event) => {
  const field = event.target.dataset.gaFilter;
  if (!field) return;
  reportState[field] = event.target.value;
  if (["startDate", "endDate"].includes(field)) {
    if (reportState.startDate && reportState.endDate && reportState.startDate <= reportState.endDate) loadReport(); else rerender();
    return;
  }
  rerender();
});
