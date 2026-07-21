import { getLeads, invalidateLeadsCache } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";
import { getTripInterestStatus, isBookedForTrip } from "../services/trip-interest.model.js";

const STATUS_LABELS = {
  NEW: "Nou",
  INFO_SENT: "Informació enviada",
  FOLLOW_UP: "En seguiment",
  REPLIED: "Ha contestat",
  PENDING_DECISION: "Pendent de decisió",
  CONTACT_LATER: "Contactar més endavant",
  BOOKING_CONFIRMED: "Reserva confirmada",
  LOST: "Perdut"
};

const SOURCE_LABELS = {
  INSTAGRAM_ORGANIC: "Instagram",
  FACEBOOK_ORGANIC: "Facebook",
  WEBSITE_FORM: "Web",
  GOOGLE_ADS: "Google Ads",
  WHATSAPP: "WhatsApp",
  REFERRAL: "Recomanació",
  RETURNING_CUSTOMER: "Clienta repetidora",
  MANYCHAT: "Instagram / ManyChat",
  MANUAL: "Entrada manual",
  OTHER: "Altres"
};

const LOST_LABELS = {
  NO_RESPONSE: "Sense resposta",
  PRICE: "Preu",
  DATES: "Dates",
  HEALTH: "Salut",
  NO_HOLIDAYS: "No té vacances",
  BOOKED_ELSEWHERE: "Viatja amb una altra agència",
  DESTINATION: "Destinació no adequada",
  OTHER: "Altres"
};

const FUNNEL_STAGES = [
  { key: "created", label: "Lead creat" },
  { key: "info", label: "Informació enviada" },
  { key: "follow", label: "Seguiment" },
  { key: "decision", label: "Pendent decisió" },
  { key: "booking", label: "Reserva" }
];

let analyticsState = {
  leads: [],
  trips: [],
  range: "month",
  startDate: "",
  endDate: "",
  tripId: "",
  source: "",
  status: ""
};
let analyticsDirty = false;
let analyticsRefreshing = false;
let analyticsUpdatedAt = null;

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

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function getPresetDates(range) {
  const now = new Date();
  const end = endOfDay(now);
  let start = startOfDay(now);

  if (range === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }
  if (range === "month") start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "year") start = new Date(now.getFullYear(), 0, 1);
  if (range === "all") start = new Date(2000, 0, 1);

  return { start, end };
}

function getDateBounds() {
  if (analyticsState.range === "custom" && analyticsState.startDate && analyticsState.endDate) {
    return {
      start: startOfDay(new Date(`${analyticsState.startDate}T12:00:00`)),
      end: endOfDay(new Date(`${analyticsState.endDate}T12:00:00`))
    };
  }
  return getPresetDates(analyticsState.range);
}

function sourceKey(lead) {
  if (lead.source && SOURCE_LABELS[lead.source]) return lead.source;
  if (lead.channel === "INSTAGRAM") return "INSTAGRAM_ORGANIC";
  if (lead.channel === "FACEBOOK") return "FACEBOOK_ORGANIC";
  if (lead.channel === "WHATSAPP") return "WHATSAPP";
  if (lead.channel === "WEB" || lead.channel === "EMAIL") return "WEBSITE_FORM";
  return "OTHER";
}

function percentage(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function selectedStatus(lead) {
  return analyticsState.tripId ? getTripInterestStatus(lead, analyticsState.tripId) : lead.status || "NEW";
}

function selectedLostReason(lead) {
  if (!analyticsState.tripId) return lead.lostReason || "OTHER";
  return lead.tripInterests?.[analyticsState.tripId]?.lostReason || lead.lostReason || "OTHER";
}

function isBookingForSelection(lead) {
  return selectedStatus(lead) === "BOOKING_CONFIRMED";
}

function bookingDateForSelection(lead) {
  if (analyticsState.tripId) {
    return toDate(lead.tripInterests?.[analyticsState.tripId]?.bookedAt)
      || (lead.bookingTripId === analyticsState.tripId ? toDate(lead.bookedAt) : null);
  }
  return toDate(lead.bookedAt);
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value)}%`;
}

function matchesDimensionFilters(lead, { bookingTripOnly = false } = {}) {
  if (analyticsState.tripId) {
    if (bookingTripOnly ? !isBookedForTrip(lead, analyticsState.tripId) : !(lead.tripIds || []).includes(analyticsState.tripId)) return false;
  }
  if (analyticsState.source && sourceKey(lead) !== analyticsState.source) return false;
  const status = selectedStatus(lead);
  if (analyticsState.status && status !== analyticsState.status) return false;
  return true;
}

function filteredLeads(bounds = getDateBounds()) {
  const { start, end } = bounds;
  return analyticsState.leads.filter((lead) => {
    const createdAt = toDate(lead.createdAt);
    if (!createdAt || createdAt < start || createdAt > end) return false;
    return matchesDimensionFilters(lead);
  });
}

function previousBounds(bounds) {
  if (analyticsState.range === "all") return null;
  const duration = bounds.end.getTime() - bounds.start.getTime() + 1;
  return { start: new Date(bounds.start.getTime() - duration), end: new Date(bounds.start.getTime() - 1) };
}

function leadReachedStage(lead, stage) {
  const status = selectedStatus(lead);
  const stageIndex = { created: 0, info: 1, follow: 2, decision: 3, booking: 4 }[stage];
  const statusIndex = {
    NEW: 0,
    INFO_SENT: 1,
    FOLLOW_UP: 2,
    REPLIED: 2,
    PENDING_DECISION: 3,
    CONTACT_LATER: 3,
    BOOKING_CONFIRMED: 4,
    LOST: 1
  }[status] ?? 0;
  return statusIndex >= stageIndex;
}

function groupBy(items, getKey) {
  return items.reduce((map, item) => {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
}

function aggregateSources(leads) {
  return [...groupBy(leads, sourceKey).entries()].map(([key, rows]) => {
    const bookings = rows.filter(isBookingForSelection).length;
    return { key, label: SOURCE_LABELS[key] || "Altres", leads: rows.length, bookings, conversion: percentage(bookings, rows.length) };
  }).sort((a, b) => b.leads - a.leads);
}

function aggregateTrips(leads) {
  const tripMap = new Map(analyticsState.trips.map((trip) => [trip.id, trip]));
  const rows = new Map();

  leads.forEach((lead) => {
    (lead.tripIds || []).forEach((tripId) => {
      if (!tripMap.has(tripId)) return;
      if (!rows.has(tripId)) rows.set(tripId, []);
      rows.get(tripId).push(lead);
    });
  });

  return [...rows.entries()].map(([tripId, tripLeads]) => {
    const trip = tripMap.get(tripId);
    const bookings = tripLeads.filter((lead) => isBookedForTrip(lead, tripId)).length;
    const lost = tripLeads.filter((lead) => getTripInterestStatus(lead, tripId) === "LOST");
    const reasons = [...groupBy(lost, (lead) => lead.lostReason || "OTHER").entries()]
      .map(([reason, values]) => ({ reason, count: values.length }))
      .sort((a, b) => b.count - a.count);
    return {
      id: tripId,
      name: trip?.name || "Viatge",
      leads: tripLeads.length,
      bookings,
      lost: lost.length,
      conversion: percentage(bookings, tripLeads.length),
      mainLostReason: reasons[0] ? LOST_LABELS[reasons[0].reason] || "Altres" : "—"
    };
  });
}

function metricTrend(current, previous, { inverse = false, points = false } = {}) {
  if (previous == null) return { label: "Sense comparativa", tone: "neutral", icon: "→" };
  const diff = points ? current - previous : previous ? ((current - previous) / previous) * 100 : current ? 100 : 0;
  const rounded = Math.round(diff * 10) / 10;
  const positive = inverse ? rounded < 0 : rounded > 0;
  const negative = inverse ? rounded > 0 : rounded < 0;
  const value = points ? `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(rounded)} punts` : formatPercent(rounded);
  return { label: `${rounded > 0 ? "+" : ""}${value} vs. període anterior`, tone: positive ? "good" : negative ? "bad" : "neutral", icon: rounded > 0 ? "↗" : rounded < 0 ? "↘" : "→" };
}

function renderMetric(label, value, hint, trend, accent = "") {
  return `<article class="analytics-premium-metric ${accent ? `is-${accent}` : ""}"><div><span>${label}</span><i></i></div><strong>${value}</strong><small>${hint}</small><span class="analytics-premium-trend is-${trend.tone}"><b>${trend.icon}</b>${escapeHtml(trend.label)}</span></article>`;
}

function renderFilters() {
  const tripOptions = analyticsState.trips.map((trip) => `<option value="${trip.id}" ${analyticsState.tripId === trip.id ? "selected" : ""}>${escapeHtml(trip.name)}</option>`).join("");
  const sourceOptions = Object.entries(SOURCE_LABELS).map(([key, label]) => `<option value="${key}" ${analyticsState.source === key ? "selected" : ""}>${label}</option>`).join("");
  const statusOptions = Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${analyticsState.status === key ? "selected" : ""}>${label}</option>`).join("");

  const { start, end } = getDateBounds();
  const dateFormat = new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "short", year: start.getFullYear() !== end.getFullYear() ? "numeric" : undefined });
  return `<section class="analytics-filters">
    <div class="analytics-premium-filter-title"><div><span class="section-kicker">Període analitzat</span><strong>${dateFormat.format(start)} — ${dateFormat.format(end)}</strong></div><button type="button" data-analytics-reset>Restablir filtres</button></div>
    <div class="analytics-range-tabs">
      ${[
        ["today", "Avui"], ["week", "Aquesta setmana"], ["month", "Aquest mes"], ["year", "Aquest any"], ["all", "Tot"], ["custom", "Personalitzat"]
      ].map(([value, label]) => `<button type="button" data-analytics-range="${value}" class="${analyticsState.range === value ? "is-active" : ""}">${label}</button>`).join("")}
    </div>
    <div class="analytics-filter-grid">
      <label>Viatge<select data-analytics-filter="tripId"><option value="">Tots els viatges</option>${tripOptions}</select></label>
      <label>Origen<select data-analytics-filter="source"><option value="">Tots els orígens</option>${sourceOptions}</select></label>
      <label>Estat<select data-analytics-filter="status"><option value="">Tots els estats</option>${statusOptions}</select></label>
      <div class="analytics-custom-dates ${analyticsState.range === "custom" ? "is-visible" : ""}">
        <label>Des de<input type="date" data-analytics-filter="startDate" value="${analyticsState.startDate}"></label>
        <label>Fins a<input type="date" data-analytics-filter="endDate" value="${analyticsState.endDate}"></label>
      </div>
    </div>
  </section>`;
}

function renderSourcePerformance(rows) {
  const max = Math.max(...rows.map((row) => row.leads), 1);
  return `<article class="analytics-card analytics-source-performance"><header><div><span class="section-kicker">Canals</span><h2>Origen i qualitat dels leads</h2></div><span>Volum · reserves · conversió</span></header><div>${rows.length ? rows.map((row) => `<div class="analytics-source-row"><div><strong>${escapeHtml(row.label)}</strong><span>${row.leads} leads · ${row.bookings} reserves</span></div><div class="analytics-bar"><span style="width:${Math.max((row.leads / max) * 100, 4)}%"></span></div><b>${formatPercent(row.conversion)}</b></div>`).join("") : '<p class="analytics-empty">No hi ha dades d’origen en aquest període.</p>'}</div></article>`;
}

function buildInsights(leads, sources, trips) {
  if (!leads.length) return [{ tone: "neutral", title: "Encara no hi ha dades", text: "Amplia el període o elimina algun filtre per veure una lectura comercial completa." }];
  const rows = [];
  const volume = sources[0];
  const quality = [...sources].filter((row) => row.leads >= 3).sort((a, b) => b.conversion - a.conversion || b.bookings - a.bookings)[0];
  const demand = [...trips].sort((a, b) => b.leads - a.leads)[0];
  const lost = leads.filter((lead) => selectedStatus(lead) === "LOST");
  const reasons = [...groupBy(lost, selectedLostReason).entries()].map(([key, values]) => ({ key, count: values.length })).sort((a, b) => b.count - a.count);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3);
  const stalled = leads.filter((lead) => ["NEW", "INFO_SENT"].includes(selectedStatus(lead)) && (toDate(lead.updatedAt) || toDate(lead.createdAt)) < cutoff).length;
  if (volume) rows.push({ tone: "brand", title: `${volume.label} aporta més volum`, text: `${volume.leads} leads i ${volume.bookings} reserves en el període seleccionat.` });
  if (quality) rows.push({ tone: "success", title: `${quality.label} converteix millor`, text: `${formatPercent(quality.conversion)} de conversió sobre una mostra de ${quality.leads} leads.` });
  if (demand) rows.push({ tone: demand.conversion < 10 && demand.leads >= 3 ? "warning" : "brand", title: `${demand.name} genera més interès`, text: `${demand.leads} interessades, ${demand.bookings} reserves i ${formatPercent(demand.conversion)} de conversió.` });
  if (stalled) rows.push({ tone: "warning", title: `${stalled} leads poden quedar enrere`, text: "Continuen nous o amb informació enviada després de més de tres dies." });
  else if (reasons[0]) rows.push({ tone: "danger", title: `${LOST_LABELS[reasons[0].key] || "Altres"} és el principal fre`, text: `${reasons[0].count} dels ${lost.length} leads perduts indiquen aquest motiu.` });
  return rows.slice(0, 4);
}

function renderInsights(items) {
  return `<section class="analytics-premium-insights"><header><div><span class="section-kicker">Lectura automàtica</span><h2>Què ens diuen les dades?</h2></div><span>Orientació basada en el període seleccionat</span></header><div>${items.map((item) => `<article class="is-${item.tone}"><i></i><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div></article>`).join("")}</div></section>`;
}

function renderRanking(title, eyebrow, rows, valueKey, secondaryKey, emptyText) {
  const max = Math.max(...rows.map((row) => row[valueKey]), 1);
  return `<article class="analytics-card analytics-ranking">
    <header><div><span class="section-kicker">${eyebrow}</span><h2>${title}</h2></div></header>
    <div class="analytics-ranking-list">${rows.length ? rows.slice(0, 8).map((row, index) => `
      <div class="analytics-ranking-row">
        <span class="analytics-rank">${index + 1}</span>
        <div><strong>${escapeHtml(row.label || row.name)}</strong><div class="analytics-bar"><span style="width:${Math.max((row[valueKey] / max) * 100, 4)}%"></span></div></div>
        <div class="analytics-ranking-value"><strong>${row[valueKey]}</strong><small>${secondaryKey ? row[secondaryKey] : ""}</small></div>
      </div>`).join("") : `<p class="analytics-empty">${emptyText}</p>`}</div>
  </article>`;
}

function renderStatusDistribution(leads) {
  const rows = Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label, count: leads.filter((lead) => selectedStatus(lead) === key).length }));
  const max = Math.max(...rows.map((row) => row.count), 1);
  return `<article class="analytics-card"><header><div><span class="section-kicker">Situació actual</span><h2>Estat dels leads</h2></div></header><div class="analytics-status-grid">${rows.map((row) => `<div><span>${row.label}</span><strong>${row.count}</strong><div class="analytics-mini-bar"><span style="width:${(row.count / max) * 100}%"></span></div></div>`).join("")}</div></article>`;
}

function renderLostReasons(leads) {
  const lost = leads.filter((lead) => selectedStatus(lead) === "LOST");
  const rows = Object.entries(LOST_LABELS).map(([key, label]) => {
    const count = lost.filter((lead) => selectedLostReason(lead) === key).length;
    return { key, label, count, percentage: percentage(count, lost.length) };
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  return `<article class="analytics-card"><header><div><span class="section-kicker">Aprenentatges</span><h2>Motius de pèrdua</h2></div><span>${lost.length} perduts</span></header><div class="analytics-reasons">${rows.length ? rows.map((row) => `<div><div><strong>${row.label}</strong><small>${formatPercent(row.percentage)}</small></div><span>${row.count}</span></div>`).join("") : '<p class="analytics-empty">No hi ha leads perduts en aquest període.</p>'}</div></article>`;
}

function renderConversionSnapshot(leads) {
  const bookings = leads.filter(isBookingForSelection).length;
  const lost = leads.filter((lead) => selectedStatus(lead) === "LOST").length;
  const active = Math.max(leads.length - bookings - lost, 0);
  const closed = bookings + lost;
  const closedConversion = percentage(bookings, closed);
  const overallConversion = percentage(bookings, leads.length);
  return `<article class="analytics-card analytics-conversion-snapshot"><header><div><span class="section-kicker">Qualitat de la conversió</span><h2>Resultat de les decisions tancades</h2></div><span>${closed} casos resolts</span></header><div class="analytics-conversion-snapshot__main"><div><strong>${formatPercent(closedConversion)}</strong><span>acaben en reserva quan ja hi ha una decisió</span></div><div class="analytics-conversion-snapshot__bar"><i style="width:${closedConversion}%"></i></div></div><div class="analytics-conversion-snapshot__breakdown"><div><span>Reserves</span><strong>${bookings}</strong></div><div><span>Perduts</span><strong>${lost}</strong></div><div><span>Encara actius</span><strong>${active}</strong></div><div><span>Conversió global</span><strong>${formatPercent(overallConversion)}</strong></div></div><p>La conversió global inclou tots els leads oberts. La conversió tancada només compara reserves amb leads ja perduts i mostra millor l’efectivitat comercial real.</p></article>`;
}

function renderFunnel(leads) {
  const stages = FUNNEL_STAGES.map((stage) => ({ ...stage, count: leads.filter((lead) => leadReachedStage(lead, stage.key)).length }));
  const total = stages[0]?.count || 0;
  const bookings = stages.at(-1)?.count || 0;
  const transitions = stages.slice(0, -1).map((stage, index) => ({
    label: `${stage.label} → ${stages[index + 1].label}`,
    drop: Math.max(stage.count - stages[index + 1].count, 0)
  }));
  const mainDrop = [...transitions].sort((a, b) => b.drop - a.drop)[0];
  if (!total) return `<article class="analytics-card analytics-funnel-card"><header><div><span class="section-kicker">Procés comercial</span><h2>Embut comercial</h2></div></header><div class="analytics-funnel-empty"><strong>No hi ha leads en aquest període</strong><p>Amplia el període o restableix els filtres per veure com avancen les futures viatgeres.</p><button type="button" data-analytics-range="all">Veure tot l’històric</button></div></article>`;
  return `<article class="analytics-card analytics-funnel-card"><header><div><span class="section-kicker">Progressió estimada segons l’estat actual</span><h2>Embut comercial</h2></div><div class="analytics-funnel-summary"><strong>${formatPercent(percentage(bookings, total))}</strong><span>conversió final</span></div></header><div class="analytics-funnel">${stages.map((stage, index) => { const previous = stages[index - 1]; const progress = percentage(stage.count, total); const continuation = previous ? percentage(stage.count, previous.count) : 100; return `<div class="analytics-funnel-stage"><div><span>${index + 1}. ${stage.label}</span><strong>${stage.count}</strong></div><div class="analytics-funnel-track"><i style="width:${progress}%"></i></div><small>${index ? `${formatPercent(continuation)} passen des de l’etapa anterior` : `${total} leads rebuts en el període`}</small></div>`; }).join("")}</div>${mainDrop?.drop ? `<footer>Principal punt de pèrdua: <strong>${escapeHtml(mainDrop.label)}</strong> · ${mainDrop.drop} leads</footer>` : ""}</article>`;
}

function periodKey(date, mode) {
  if (mode === "day") return localIso(date);
  if (mode === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const first = new Date(date);
  const day = first.getDay() || 7;
  first.setDate(first.getDate() - day + 1);
  return localIso(first);
}

function periodStart(date, mode) {
  const value = startOfDay(date);
  if (mode === "month") return new Date(value.getFullYear(), value.getMonth(), 1);
  if (mode === "week") {
    const day = value.getDay() || 7;
    value.setDate(value.getDate() - day + 1);
  }
  return value;
}

function addPeriod(date, mode, amount = 1) {
  const value = new Date(date);
  if (mode === "month") value.setMonth(value.getMonth() + amount);
  else value.setDate(value.getDate() + amount * (mode === "week" ? 7 : 1));
  return value;
}

function periodLabel(date, mode) {
  if (mode === "month") return new Intl.DateTimeFormat("ca-ES", { month: "short", year: "2-digit" }).format(date);
  if (mode === "week") return `Set. ${new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "short" }).format(date)}`;
  return new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "short" }).format(date);
}

function renderEvolution() {
  const { start, end } = getDateBounds();
  const duration = Math.max(1, Math.round((end - start) / 86400000));
  const mode = duration <= 31 ? "day" : duration <= 180 ? "week" : "month";
  const grouped = new Map();
  const inRange = (date) => date && date >= start && date <= end;
  const rowFor = (date) => {
    const key = periodKey(date, mode);
    if (!grouped.has(key)) grouped.set(key, { key, leads: 0, bookings: 0 });
    return grouped.get(key);
  };
  const lastPeriod = periodStart(end, mode);
  const firstVisiblePeriod = addPeriod(lastPeriod, mode, -13);
  const firstPeriod = periodStart(start, mode) > firstVisiblePeriod ? periodStart(start, mode) : firstVisiblePeriod;
  for (let date = firstPeriod; date <= lastPeriod; date = addPeriod(date, mode)) {
    grouped.set(periodKey(date, mode), { key: periodKey(date, mode), date: new Date(date), leads: 0, bookings: 0 });
  }
  analyticsState.leads.forEach((lead) => {
    if (!matchesDimensionFilters(lead)) return;
    const createdAt = toDate(lead.createdAt);
    if (inRange(createdAt) && grouped.has(periodKey(createdAt, mode))) rowFor(createdAt).leads += 1;
    if (!isBookingForSelection(lead) || !matchesDimensionFilters(lead, { bookingTripOnly: true })) return;
    const bookedAt = bookingDateForSelection(lead) || createdAt;
    if (inRange(bookedAt) && grouped.has(periodKey(bookedAt, mode))) rowFor(bookedAt).bookings += 1;
  });
  const rows = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
  const max = Math.max(...rows.flatMap((row) => [row.leads, row.bookings]), 1);
  const totalLeads = rows.reduce((sum, row) => sum + row.leads, 0);
  const totalBookings = rows.reduce((sum, row) => sum + row.bookings, 0);
  const peak = [...rows].sort((a, b) => (b.leads + b.bookings) - (a.leads + a.bookings))[0];
  const hasActivity = totalLeads + totalBookings > 0;
  return `<article class="analytics-card analytics-evolution"><header><div><span class="section-kicker">Tendència · últims ${rows.length} períodes</span><h2>Evolució de leads i reserves</h2></div><div class="analytics-evolution-totals"><span><i class="is-leads"></i><strong>${totalLeads}</strong> leads</span><span><i class="is-bookings"></i><strong>${totalBookings}</strong> reserves</span></div></header>${hasActivity ? `<div class="analytics-evolution-chart">${rows.map((row) => `<div class="analytics-evolution-column" title="${periodLabel(row.date, mode)} · ${row.leads} leads · ${row.bookings} reserves"><div class="analytics-evolution-bars"><span class="is-leads ${row.leads ? "" : "is-zero"}" style="height:${row.leads ? Math.max((row.leads / max) * 100, 7) : 2}%"><b>${row.leads || ""}</b></span><span class="is-bookings ${row.bookings ? "" : "is-zero"}" style="height:${row.bookings ? Math.max((row.bookings / max) * 100, 7) : 2}%"><b>${row.bookings || ""}</b></span></div><small>${periodLabel(row.date, mode)}</small></div>`).join("")}</div><footer class="analytics-evolution-footer"><span>Pic d’activitat: <strong>${periodLabel(peak.date, mode)}</strong></span><span>Conversió del gràfic: <strong>${formatPercent(percentage(totalBookings, totalLeads))}</strong></span></footer>` : `<div class="analytics-evolution-empty"><strong>Sense activitat en aquests períodes</strong><span>Prova d’ampliar el rang o de restablir els filtres.</span></div>`}</article>`;
}

function renderRadar(rows) {
  const sorted = [...rows].sort((a, b) => b.leads - a.leads);
  return `<article class="analytics-card analytics-radar"><header><div><span class="section-kicker">Decisió comercial</span><h2>Radar comercial</h2></div><span>Selecciona un viatge per filtrar · ${sorted.length} amb activitat</span></header><div class="analytics-table-wrap"><table><thead><tr><th>Viatge</th><th>Leads</th><th>Reserves</th><th>Conversió</th><th>Perduts</th><th>Principal motiu</th></tr></thead><tbody>${sorted.length ? sorted.map((row) => `<tr data-analytics-trip-filter="${row.id}" tabindex="0"><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.leads}</td><td>${row.bookings}</td><td><span class="analytics-conversion ${row.conversion >= 20 ? "is-good" : row.conversion < 8 ? "is-low" : ""}">${formatPercent(row.conversion)}</span></td><td>${row.lost}</td><td>${escapeHtml(row.mainLostReason)}</td></tr>`).join("") : '<tr><td colspan="6" class="analytics-empty">No hi ha viatges amb activitat en aquest període.</td></tr>'}</tbody></table></div></article>`;
}

function renderAnalytics() {
  const bounds = getDateBounds();
  const leads = filteredLeads(bounds);
  const priorBounds = previousBounds(bounds);
  const previousLeads = priorBounds ? filteredLeads(priorBounds) : [];
  const bookings = leads.filter(isBookingForSelection).length;
  const followUps = leads.filter((lead) => ["FOLLOW_UP", "REPLIED", "PENDING_DECISION", "CONTACT_LATER"].includes(selectedStatus(lead))).length;
  const lost = leads.filter((lead) => selectedStatus(lead) === "LOST").length;
  const conversion = percentage(bookings, leads.length);
  const previousBookings = previousLeads.filter(isBookingForSelection).length;
  const previousFollowUps = previousLeads.filter((lead) => ["FOLLOW_UP", "REPLIED", "PENDING_DECISION", "CONTACT_LATER"].includes(selectedStatus(lead))).length;
  const previousLost = previousLeads.filter((lead) => selectedStatus(lead) === "LOST").length;
  const previousConversion = percentage(previousBookings, previousLeads.length);
  const sources = aggregateSources(leads);
  const trips = aggregateTrips(leads);
  const topInterest = [...trips].sort((a, b) => b.leads - a.leads);
  const topConversion = [...trips].filter((row) => row.leads >= 2).sort((a, b) => b.conversion - a.conversion || b.leads - a.leads);
  const freshness = analyticsDirty ? "Hi ha canvis pendents d’actualitzar" : analyticsUpdatedAt ? `Actualitzat a les ${analyticsUpdatedAt.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })}` : "Dades preparades";

  return `<section class="analytics-page">
    <header class="analytics-premium-hero"><div><span class="section-kicker">Control comercial</span><h1>Analítica Comercial</h1><p>Una lectura clara de què atrau futures viatgeres, què converteix i on convé actuar avui.</p></div><aside><span>Taxa de conversió</span><strong>${formatPercent(conversion)}</strong><small>${bookings} reserves de ${leads.length} leads</small><button type="button" data-refresh-analytics ${analyticsRefreshing ? "disabled" : ""}>${analyticsRefreshing ? "Actualitzant…" : "Actualitzar dades"}</button><em data-analytics-freshness>${freshness}</em></aside></header>
    ${renderFilters()}
    <section class="analytics-premium-metrics">
      ${renderMetric("Leads rebuts", leads.length, "Entrades en el període", metricTrend(leads.length, priorBounds ? previousLeads.length : null), "brand")}
      ${renderMetric("Reserves confirmades", bookings, "Conversió comercial", metricTrend(bookings, priorBounds ? previousBookings : null), "success")}
      ${renderMetric("Oportunitats actives", followUps, "En seguiment o decisió", metricTrend(followUps, priorBounds ? previousFollowUps : null))}
      ${renderMetric("Leads perduts", lost, "Amb motiu registrat", metricTrend(lost, priorBounds ? previousLost : null, { inverse: true }), lost ? "warning" : "")}
      ${renderMetric("Conversió", formatPercent(conversion), `${bookings} de ${leads.length} leads`, metricTrend(conversion, priorBounds ? previousConversion : null, { points: true }), "dark")}
    </section>
    ${renderInsights(buildInsights(leads, sources, trips))}
    ${renderConversionSnapshot(leads)}
    ${renderSourcePerformance(sources)}
    <section class="analytics-two-column">
      ${renderRanking("Viatges que generen més interès", "Demanda", topInterest, "leads", "", "No hi ha viatges amb consultes.")}
      ${renderRanking("Viatges amb millor conversió", "Rendiment", topConversion, "conversion", "", "Encara no hi ha prou dades.")}
    </section>
    <section class="analytics-two-column">
      ${renderStatusDistribution(leads)}
      ${renderLostReasons(leads)}
    </section>
    ${renderFunnel(leads)}
    ${renderEvolution()}
    ${renderRadar(trips)}
  </section>`;
}

function setAnalyticsActive() {
  document.querySelectorAll(".sidebar-nav__item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.navKey === "analytics");
  });
}

export async function showAnalyticsView({ force = false } = {}) {
  const container = root();
  if (!container) return;
  setAnalyticsActive();
  container.innerHTML = '<section class="analytics-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la lectura comercial...</p></div></section>';
  try {
    if (force) invalidateLeadsCache();
    const [leads, trips] = await Promise.all([getLeads(), getTrips()]);
    analyticsState.leads = leads;
    analyticsState.trips = trips;
    analyticsDirty = false;
    analyticsUpdatedAt = new Date();
    analyticsRefreshing = false;
    container.innerHTML = renderAnalytics();
  } catch (error) {
    console.error("No s'ha pogut carregar l'analítica comercial:", error);
    container.innerHTML = '<div class="leads-error">No s’ha pogut carregar l’Analítica Comercial.</div>';
  } finally {
    analyticsRefreshing = false;
  }
}

function rerenderAnalytics() {
  const container = root();
  if (container?.querySelector(".analytics-page")) container.innerHTML = renderAnalytics();
}

function selectRadarTrip(row) {
  if (!row) return;
  analyticsState.tripId = row.dataset.analyticsTripFilter;
  rerenderAnalytics();
  root()?.scrollTo?.({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-nav-key="analytics"]')) showAnalyticsView();
  if (event.target.closest("[data-refresh-analytics]")) {
    analyticsRefreshing = true;
    showAnalyticsView({ force: true });
  }
  if (event.target.closest("[data-analytics-reset]")) {
    analyticsState = { ...analyticsState, range: "month", startDate: "", endDate: "", tripId: "", source: "", status: "" };
    rerenderAnalytics();
  }
  selectRadarTrip(event.target.closest("[data-analytics-trip-filter]"));
  const rangeButton = event.target.closest("[data-analytics-range]");
  if (rangeButton) {
    analyticsState.range = rangeButton.dataset.analyticsRange;
    if (analyticsState.range === "custom" && (!analyticsState.startDate || !analyticsState.endDate)) {
      const defaults = getPresetDates("month");
      analyticsState.startDate = localIso(defaults.start);
      analyticsState.endDate = localIso(defaults.end);
    }
    rerenderAnalytics();
  }
});

document.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key)) selectRadarTrip(event.target.closest("[data-analytics-trip-filter]"));
});

document.addEventListener("change", (event) => {
  const field = event.target.dataset.analyticsFilter;
  if (!field) return;
  analyticsState[field] = event.target.value;
  rerenderAnalytics();
});

["travelflow:tasks-updated", "travelflow:lead-created", "travelflow:lead-deleted"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    analyticsDirty = true;
    const label = document.querySelector("[data-analytics-freshness]");
    if (label) label.textContent = "Hi ha canvis pendents d’actualitzar";
  });
});
