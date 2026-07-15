import { getOpenTasks } from "../services/workflow.service.js";
import { getTrips } from "../services/trip.service.js";
import { getLeads } from "../services/lead.service.js";
import { showLeadDetail } from "./leads.controller.js";
import { showLeadsForTrip } from "./trip-leads.controller.js";

let dashboardLoading = false;
let dashboardLoaded = false;

function root() { return document.querySelector(".app-content"); }
function startOfDay(date = new Date()) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function endOfDay(date = new Date()) { const value = new Date(date); value.setHours(23, 59, 59, 999); return value; }
function toDate(value) { return value?.toDate?.() ?? (value ? new Date(value) : null); }
function formatDate(value) { const date = toDate(value); return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "Sense data"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function safeImageUrl(value = "", seed = "travel") {
  const clean = String(value || "").trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/1000/700`;
}

function renderTask(task, todayStart, todayEnd) {
  const due = toDate(task.dueAt);
  const overdue = due && due < todayStart;
  const today = due && due >= todayStart && due <= todayEnd;
  return `<button class="daily-task ${overdue ? "is-overdue" : today ? "is-today" : ""}" type="button" data-dashboard-lead="${task.leadId}"><span class="daily-task__status">${overdue ? "Vençuda" : today ? "Avui" : formatDate(task.dueAt)}</span><span class="daily-task__body"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.leadName || "Futura viatgera")}${task.tripName ? ` · ${escapeHtml(task.tripName)}` : ""}</small></span><span class="daily-task__arrow">→</span></button>`;
}

function renderTripCards(trips, leads) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = trips.filter((trip) => trip.startDate && new Date(`${trip.startDate}T12:00:00`) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 4);
  if (!upcoming.length) return `<section class="dashboard-trips"><header class="dashboard-trips__header"><div><span class="section-kicker">Control comercial</span><h2>Pròxims viatges</h2></div></header><div class="daily-empty"><strong>No hi ha viatges amb data futura</strong><span>Afegeix o revisa les dates des del menú Viatges.</span></div></section>`;
  return `<section class="dashboard-trips"><header class="dashboard-trips__header"><div><span class="section-kicker">Control comercial</span><h2>Pròxims viatges</h2></div><p>Clica una targeta per veure només els leads d’aquell viatge.</p></header><div class="dashboard-trip-grid">${upcoming.map((trip) => {
    const linkedLeads = leads.filter((lead) => Array.isArray(lead.tripIds) && lead.tripIds.includes(trip.id));
    const activeCount = linkedLeads.filter((lead) => !["LOST", "BOOKING_CONFIRMED"].includes(lead.status)).length;
    const bookedCount = linkedLeads.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
    const imageUrl = safeImageUrl(trip.imageUrl, trip.id || trip.name);
    const closingText = trip.closingDate ? `Tancament ${formatDate(`${trip.closingDate}T12:00:00`)}` : "Tancament pendent";
    return `<button class="dashboard-trip-card" type="button" data-dashboard-trip="${trip.id}" style="--trip-image:url('${escapeHtml(imageUrl)}')"><span class="dashboard-trip-card__overlay"></span><span class="dashboard-trip-card__top"><span class="dashboard-trip-card__date">${formatDate(`${trip.startDate}T12:00:00`)}</span><span class="dashboard-trip-card__closing ${trip.closingDate ? "" : "is-pending"}">${closingText}</span></span><span class="dashboard-trip-card__content"><strong>${escapeHtml(trip.name.replace(/^\d{4}\s*-\s*/, ""))}</strong><span>${activeCount} leads actius${bookedCount ? ` · ${bookedCount} reserves` : ""}</span></span><span class="dashboard-trip-card__arrow">Veure leads →</span></button>`;
  }).join("")}</div></section>`;
}

function renderDashboard(tasks, trips, leads) {
  const todayStart = startOfDay(); const todayEnd = endOfDay();
  const todayTasks = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due <= todayEnd; });
  const upcoming = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due > todayEnd; }).slice(0, 8);
  const overdueCount = todayTasks.filter((task) => toDate(task.dueAt) < todayStart).length;
  const taskList = (items, title, text) => items.length ? items.map((task) => renderTask(task, todayStart, todayEnd)).join("") : `<div class="daily-empty"><strong>${title}</strong><span>${text}</span></div>`;
  return `<section class="dashboard-view daily-dashboard"><header class="page-heading"><div><span class="section-kicker">La teva jornada comercial</span><h1>Tasques d'avui</h1><p>Tot el que necessita una acció, ordenat per prioritat i data.</p></div><div class="page-heading__actions"><button class="secondary-button" type="button" data-refresh-dashboard>Actualitzar</button><button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button></div></header><section class="metrics-grid"><article class="metric-card"><span class="metric-card__label">Pendents avui</span><strong>${todayTasks.length}</strong><small>Accions per completar</small></article><article class="metric-card metric-card--warning"><span class="metric-card__label">Vençudes</span><strong>${overdueCount}</strong><small>Necessiten atenció</small></article><article class="metric-card"><span class="metric-card__label">Properes</span><strong>${Math.max(tasks.length - todayTasks.length, 0)}</strong><small>Planificades</small></article><article class="metric-card"><span class="metric-card__label">Total obertes</span><strong>${tasks.length}</strong><small>Seguiments actius</small></article></section>${renderTripCards(trips, leads)}<section class="daily-dashboard-grid"><article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Prioritat</span><h2>Avui i vençudes</h2></div></header><div class="daily-task-list">${taskList(todayTasks, "No tens tasques pendents per avui", "La teva llista està al dia.")}</div></article><article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Planificació</span><h2>Pròximes accions</h2></div></header><div class="daily-task-list">${taskList(upcoming, "No hi ha accions futures", "Programa el següent contacte des de la fitxa del lead.")}</div></article></section></section>`;
}

export async function showDailyDashboard({ force = false } = {}) {
  if (!root() || dashboardLoading) return;
  if (!force && dashboardLoaded && document.querySelector(".daily-dashboard")) return;
  dashboardLoading = true;
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Dashboard" } }));
  root().innerHTML = `<section class="dashboard-view"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la teva llista de feina...</p></div></section>`;
  try {
    const [leads, trips] = await Promise.all([getLeads(), getTrips()]);
    const tasks = await getOpenTasks({ leads, trips, runMaintenance: false });
    root().innerHTML = renderDashboard(tasks, trips, leads);
    dashboardLoaded = true;
  } catch (error) {
    console.error("No s'ha pogut preparar el Dashboard:", error);
    root().innerHTML = `<div class="leads-error">No s'ha pogut carregar el Dashboard. Si avui s'ha superat la quota de Firebase, tornarà a funcionar quan es renovi.</div>`;
  } finally {
    dashboardLoading = false;
  }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest(".sidebar-nav__item");
  if (nav?.textContent.trim().startsWith("Dashboard")) { showDailyDashboard({ force: true }); return; }
  if (event.target.closest("[data-back-dashboard], [data-refresh-dashboard]")) { showDailyDashboard({ force: true }); return; }
  const task = event.target.closest("[data-dashboard-lead]");
  if (task) { showLeadDetail(task.dataset.dashboardLead); return; }
  const trip = event.target.closest("[data-dashboard-trip]");
  if (trip) showLeadsForTrip(trip.dataset.dashboardTrip);
});

const shellObserver = new MutationObserver(() => {
  if (document.querySelector(".app-shell") && !dashboardLoaded) {
    shellObserver.disconnect();
    showDailyDashboard();
  }
});
shellObserver.observe(document.body, { childList: true, subtree: true });