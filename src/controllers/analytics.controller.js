import { getLeads } from "../services/lead.service.js";
import { getTrips } from "../services/trip.service.js";

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

function formatPercent(value) {
  return `${new Intl.NumberFormat("ca-ES", { maximumFractionDigits: 1 }).format(value)}%`;
}

function filteredLeads() {
  const { start, end } = getDateBounds();
  return analyticsState.leads.filter((lead) => {
    const createdAt = toDate(lead.createdAt);
    if (!createdAt || createdAt < start || createdAt > end) return false;
    if (analyticsState.tripId && !(lead.tripIds || []).includes(analyticsState.tripId)) return false;
    if (analyticsState.source && sourceKey(lead) !== analyticsState.source) return false;
    if (analyticsState.status && lead.status !== analyticsState.status) return false;
    return true;
  });
}

function leadReachedStage(lead, stage) {
  const status = lead.status;
  if (stage === "created") return true;
  if (stage === "info") return !["NEW"].includes(status);
  if (stage === "follow") return ["FOLLOW_UP", "REPLIED", "PENDING_DECISION", "CONTACT_LATER", "BOOKING_CONFIRMED", "LOST"].includes(status);
  if (stage === "decision") return ["REPLIED", "PENDING_DECISION", "CONTACT_LATER", "BOOKING_CONFIRMED", "LOST"].includes(status);
  if (stage === "booking") return status === "BOOKING_CONFIRMED";
  return false;
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
    const bookings = rows.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
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
    const bookings = tripLeads.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
    const lost = tripLeads.filter((lead) => lead.status === "LOST");
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

function renderMetric(label, value, hint = "") {
  return `<article class="analytics-metric"><span>${label}</span><strong>${value}</strong>${hint ? `<small>${hint}</small>` : ""}</article>`;
}

function renderFilters() {
  const tripOptions = analyticsState.trips.map((trip) => `<option value="${trip.id}" ${analyticsState.tripId === trip.id ? "selected" : ""}>${escapeHtml(trip.name)}</option>`).join("");
  const sourceOptions = Object.entries(SOURCE_LABELS).map(([key, label]) => `<option value="${key}" ${analyticsState.source === key ? "selected" : ""}>${label}</option>`).join("");
  const statusOptions = Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${analyticsState.status === key ? "selected" : ""}>${label}</option>`).join("");

  return `<section class="analytics-filters">
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
  const rows = Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label, count: leads.filter((lead) => lead.status === key).length }));
  const max = Math.max(...rows.map((row) => row.count), 1);
  return `<article class="analytics-card"><header><div><span class="section-kicker">Situació actual</span><h2>Estat dels leads</h2></div></header><div class="analytics-status-grid">${rows.map((row) => `<div><span>${row.label}</span><strong>${row.count}</strong><div class="analytics-mini-bar"><span style="width:${(row.count / max) * 100}%"></span></div></div>`).join("")}</div></article>`;
}

function renderLostReasons(leads) {
  const lost = leads.filter((lead) => lead.status === "LOST");
  const rows = Object.entries(LOST_LABELS).map(([key, label]) => {
    const count = lost.filter((lead) => (lead.lostReason || "OTHER") === key).length;
    return { key, label, count, percentage: percentage(count, lost.length) };
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  return `<article class="analytics-card"><header><div><span class="section-kicker">Aprenentatges</span><h2>Motius de pèrdua</h2></div><span>${lost.length} perduts</span></header><div class="analytics-reasons">${rows.length ? rows.map((row) => `<div><div><strong>${row.label}</strong><small>${formatPercent(row.percentage)}</small></div><span>${row.count}</span></div>`).join("") : '<p class="analytics-empty">No hi ha leads perduts en aquest període.</p>'}</div></article>`;
}

function renderFunnel(leads) {
  const stages = FUNNEL_STAGES.map((stage) => ({ ...stage, count: leads.filter((lead) => leadReachedStage(lead, stage.key)).length }));
  const max = stages[0]?.count || 1;
  const drops = stages.slice(0, -1).map((stage, index) => ({
    label: `${stage.label} → ${stages[index + 1].label}`,
    drop: stage.count - stages[index + 1].count
  })).sort((a, b) => b.drop - a.drop);
  return `<article class="analytics-card analytics-funnel-card"><header><div><span class="section-kicker">Procés comercial</span><h2>Embut comercial</h2></div>${drops[0] ? `<span>Major caiguda: ${escapeHtml(drops[0].label)}</span>` : ""}</header><div class="analytics-funnel">${stages.map((stage, index) => `<div class="analytics-funnel-stage" style="width:${Math.max((stage.count / max) * 100, 18)}%"><span>${stage.label}</span><strong>${stage.count}</strong>${index < stages.length - 1 ? `<small>${stages[index].count ? formatPercent(percentage(stages[index + 1].count, stages[index].count)) : "0%"} continuen</small>` : ""}</div>`).join("")}</div></article>`;
}

function periodKey(date, mode) {
  if (mode === "day") return localIso(date);
  if (mode === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const first = new Date(date);
  const day = first.getDay() || 7;
  first.setDate(first.getDate() - day + 1);
  return localIso(first);
}

function renderEvolution(leads) {
  const { start, end } = getDateBounds();
  const duration = Math.max(1, Math.round((end - start) / 86400000));
  const mode = duration <= 31 ? "day" : duration <= 180 ? "week" : "month";
  const grouped = new Map();
  leads.forEach((lead) => {
    const date = toDate(lead.createdAt);
    if (!date) return;
    const key = periodKey(date, mode);
    if (!grouped.has(key)) grouped.set(key, { key, leads: 0, bookings: 0 });
    const row = grouped.get(key);
    row.leads += 1;
    if (lead.status === "BOOKING_CONFIRMED") row.bookings += 1;
  });
  const rows = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-14);
  const max = Math.max(...rows.map((row) => row.leads), 1);
  return `<article class="analytics-card analytics-evolution"><header><div><span class="section-kicker">Tendència</span><h2>Evolució de leads i reserves</h2></div><span>Per ${mode === "day" ? "dia" : mode === "week" ? "setmana" : "mes"}</span></header><div class="analytics-evolution-chart">${rows.length ? rows.map((row) => `<div class="analytics-evolution-column"><div class="analytics-evolution-bars"><span class="is-leads" style="height:${Math.max((row.leads / max) * 100, 5)}%" title="${row.leads} leads"></span><span class="is-bookings" style="height:${Math.max((row.bookings / max) * 100, row.bookings ? 5 : 0)}%" title="${row.bookings} reserves"></span></div><small>${row.key}</small></div>`).join("") : '<p class="analytics-empty">No hi ha activitat en aquest període.</p>'}</div><div class="analytics-legend"><span><i class="is-leads"></i>Leads</span><span><i class="is-bookings"></i>Reserves</span></div></article>`;
}

function renderRadar(rows) {
  const sorted = [...rows].sort((a, b) => b.leads - a.leads);
  return `<article class="analytics-card analytics-radar"><header><div><span class="section-kicker">Decisió comercial</span><h2>Radar comercial</h2></div><span>${sorted.length} viatges amb activitat</span></header><div class="analytics-table-wrap"><table><thead><tr><th>Viatge</th><th>Leads</th><th>Reserves</th><th>Conversió</th><th>Perduts</th><th>Principal motiu</th></tr></thead><tbody>${sorted.length ? sorted.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.leads}</td><td>${row.bookings}</td><td><span class="analytics-conversion ${row.conversion >= 20 ? "is-good" : row.conversion < 8 ? "is-low" : ""}">${formatPercent(row.conversion)}</span></td><td>${row.lost}</td><td>${escapeHtml(row.mainLostReason)}</td></tr>`).join("") : '<tr><td colspan="6" class="analytics-empty">No hi ha viatges amb activitat en aquest període.</td></tr>'}</tbody></table></div></article>`;
}

function renderAnalytics() {
  const leads = filteredLeads();
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
  const followUps = leads.filter((lead) => ["FOLLOW_UP", "REPLIED", "PENDING_DECISION", "CONTACT_LATER"].includes(lead.status)).length;
  const lost = leads.filter((lead) => lead.status === "LOST").length;
  const conversion = percentage(bookings, leads.length);
  const sources = aggregateSources(leads);
  const trips = aggregateTrips(leads);
  const topInterest = [...trips].sort((a, b) => b.leads - a.leads);
  const topConversion = [...trips].filter((row) => row.leads >= 2).sort((a, b) => b.conversion - a.conversion || b.leads - a.leads);

  return `<section class="analytics-page">
    <header class="page-heading"><div><span class="section-kicker">Control comercial</span><h1>Analítica Comercial</h1><p>Entén en menys d’un minut què funciona, què converteix i on cal actuar.</p></div></header>
    ${renderFilters()}
    <section class="analytics-metrics">
      ${renderMetric("Leads nous", leads.length, "Entrades en el període")}
      ${renderMetric("Reserves confirmades", bookings, "Conversió comercial")}
      ${renderMetric("En seguiment", followUps, "Necessiten continuïtat")}
      ${renderMetric("Leads perduts", lost, "Amb motiu registrat")}
      ${renderMetric("Taxa de conversió", formatPercent(conversion), `${bookings} de ${leads.length}`)}
    </section>
    <section class="analytics-two-column">
      ${renderRanking("Origen dels leads", "Canals", sources, "leads", "", "No hi ha dades d’origen.")}
      ${renderRanking("Canals que converteixen millor", "Conversió", [...sources].sort((a, b) => b.conversion - a.conversion), "conversion", "", "No hi ha dades de conversió.")}
    </section>
    <section class="analytics-two-column">
      ${renderRanking("Viatges que generen més interès", "Demanda", topInterest, "leads", "", "No hi ha viatges amb consultes.")}
      ${renderRanking("Viatges amb millor conversió", "Rendiment", topConversion, "conversion", "", "Encara no hi ha prou dades.")}
    </section>
    <section class="analytics-two-column">
      ${renderStatusDistribution(leads)}
      ${renderLostReasons(leads)}
    </section>
    ${renderFunnel(leads)}
    ${renderEvolution(leads)}
    ${renderRadar(trips)}
  </section>`;
}

function setAnalyticsActive() {
  document.querySelectorAll(".sidebar-nav__item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.analyticsNav === "true");
  });
}

export async function showAnalyticsView() {
  const container = root();
  if (!container) return;
  setAnalyticsActive();
  container.innerHTML = '<section class="analytics-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la lectura comercial...</p></div></section>';
  try {
    const [leads, trips] = await Promise.all([getLeads(), getTrips()]);
    analyticsState.leads = leads;
    analyticsState.trips = trips;
    container.innerHTML = renderAnalytics();
  } catch (error) {
    console.error("No s'ha pogut carregar l'analítica comercial:", error);
    container.innerHTML = '<div class="leads-error">No s’ha pogut carregar l’Analítica Comercial.</div>';
  }
}

function ensureAnalyticsNav() {
  const nav = document.querySelector(".sidebar-nav");
  if (!nav || nav.querySelector('[data-analytics-nav="true"]')) return;
  const tripsButton = [...nav.querySelectorAll(".sidebar-nav__item")].find((button) => button.textContent.trim().startsWith("Viatges"));
  const button = document.createElement("button");
  button.className = "sidebar-nav__item";
  button.type = "button";
  button.dataset.analyticsNav = "true";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /></svg><span>Analítica</span>';
  if (tripsButton) tripsButton.insertAdjacentElement("afterend", button);
  else nav.appendChild(button);
}

const observer = new MutationObserver(ensureAnalyticsNav);
observer.observe(document.body, { childList: true, subtree: true });
ensureAnalyticsNav();

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-analytics-nav="true"]')) showAnalyticsView();
  const rangeButton = event.target.closest("[data-analytics-range]");
  if (rangeButton) {
    analyticsState.range = rangeButton.dataset.analyticsRange;
    if (analyticsState.range === "custom" && (!analyticsState.startDate || !analyticsState.endDate)) {
      const defaults = getPresetDates("month");
      analyticsState.startDate = localIso(defaults.start);
      analyticsState.endDate = localIso(defaults.end);
    }
    root().innerHTML = renderAnalytics();
  }
});

document.addEventListener("change", (event) => {
  const field = event.target.dataset.analyticsFilter;
  if (!field) return;
  analyticsState[field] = event.target.value;
  root().innerHTML = renderAnalytics();
});
