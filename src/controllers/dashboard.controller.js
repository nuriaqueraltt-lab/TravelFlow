import { getOpenTasks } from "../services/workflow.service.js";
import { getTrips } from "../services/trip.service.js";
import { getLeads } from "../services/lead.service.js";
import { showLeadDetail, showLeadsForTrip } from "./leads.controller.js";

function root() { return document.querySelector(".app-content"); }
function startOfDay(date = new Date()) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function endOfDay(date = new Date()) { const value = new Date(date); value.setHours(23, 59, 59, 999); return value; }
function toDate(value) { return value?.toDate?.() ?? (value ? new Date(value) : null); }
function formatDate(value) { const date = toDate(value); return date ? new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "Sense data"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

function renderTask(task, todayStart, todayEnd) {
  const due = toDate(task.dueAt); const overdue = due && due < todayStart; const today = due && due >= todayStart && due <= todayEnd;
  return `<button class="daily-task ${overdue ? "is-overdue" : today ? "is-today" : ""}" type="button" data-dashboard-lead="${task.leadId}"><span class="daily-task__status">${overdue ? "Vençuda" : today ? "Avui" : formatDate(task.dueAt)}</span><span class="daily-task__body"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.leadName || "Futura viatgera")}${task.tripName ? ` · ${escapeHtml(task.tripName)}` : ""}</small></span><span class="daily-task__arrow">→</span></button>`;
}

function renderTripCards(trips, leads) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = trips.filter((trip) => trip.startDate && new Date(`${trip.startDate}T12:00:00`) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 4);
  if (!upcoming.length) return "";
  return `<section class="dashboard-trips"><header class="content-card__header"><div><span class="section-kicker">Control comercial</span><h2>Pròxims viatges</h2></div><span>Obre un viatge per veure només els seus leads</span></header><div class="dashboard-trip-grid">${upcoming.map((trip) => {
    const count = leads.filter((lead) => Array.isArray(lead.tripIds) && lead.tripIds.includes(trip.id) && lead.status !== "LOST").length;
    return `<button class="dashboard-trip-card" type="button" data-dashboard-trip="${trip.id}" style="background-image:linear-gradient(180deg,rgba(20,35,29,.08),rgba(20,35,29,.86)),url('${escapeHtml(trip.imageUrl || "")}')"><span class="dashboard-trip-card__date">${formatDate(`${trip.startDate}T12:00:00`)}</span><span class="dashboard-trip-card__content"><strong>${escapeHtml(trip.name.replace(/^\d{4}\s*-\s*/, ""))}</strong><small>${count} leads actius${trip.closingDate ? ` · tancament ${formatDate(`${trip.closingDate}T12:00:00`)}` : ""}</small></span></button>`;
  }).join("")}</div></section>`;
}

function renderDashboard(tasks, trips, leads) {
  const todayStart = startOfDay(); const todayEnd = endOfDay();
  const todayTasks = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due <= todayEnd; });
  const upcoming = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due > todayEnd; }).slice(0, 8);
  const overdueCount = todayTasks.filter((task) => toDate(task.dueAt) < todayStart).length;
  const taskList = (items, title, text) => items.length ? items.map((task) => renderTask(task, todayStart, todayEnd)).join("") : `<div class="daily-empty"><strong>${title}</strong><span>${text}</span></div>`;
  return `<section class="dashboard-view daily-dashboard"><header class="page-heading"><div><span class="section-kicker">La teva jornada comercial</span><h1>Tasques d'avui</h1><p>Tot el que necessita una acció, ordenat per prioritat i data.</p></div><button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button></header><section class="metrics-grid"><article class="metric-card"><span class="metric-card__label">Pendents avui</span><strong>${todayTasks.length}</strong><small>Accions per completar</small></article><article class="metric-card metric-card--warning"><span class="metric-card__label">Vençudes</span><strong>${overdueCount}</strong><small>Necessiten atenció</small></article><article class="metric-card"><span class="metric-card__label">Properes</span><strong>${Math.max(tasks.length - todayTasks.length, 0)}</strong><small>Planificades</small></article><article class="metric-card"><span class="metric-card__label">Total obertes</span><strong>${tasks.length}</strong><small>Seguiments actius</small></article></section>${renderTripCards(trips, leads)}<section class="daily-dashboard-grid"><article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Prioritat</span><h2>Avui i vençudes</h2></div></header><div class="daily-task-list">${taskList(todayTasks, "No tens tasques pendents per avui", "La teva llista està al dia.")}</div></article><article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Planificació</span><h2>Pròximes accions</h2></div></header><div class="daily-task-list">${taskList(upcoming, "No hi ha accions futures", "Programa el següent contacte des de la fitxa del lead.")}</div></article></section></section>`;
}

export async function showDailyDashboard() {
  if (!root()) return;
  root().innerHTML = `<section class="dashboard-view"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la teva llista de feina...</p></div></section>`;
  try { const [tasks, trips, leads] = await Promise.all([getOpenTasks(), getTrips(), getLeads()]); root().innerHTML = renderDashboard(tasks, trips, leads); }
  catch { root().innerHTML = `<div class="leads-error">No s'ha pogut carregar el Dashboard.</div>`; }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest(".sidebar-nav__item"); if (nav?.textContent.trim().startsWith("Dashboard")) { showDailyDashboard(); return; }
  const task = event.target.closest("[data-dashboard-lead]"); if (task) { showLeadDetail(task.dataset.dashboardLead); return; }
  const trip = event.target.closest("[data-dashboard-trip]"); if (trip) showLeadsForTrip(trip.dataset.dashboardTrip);
});
window.addEventListener("travelflow:tasks-updated", showDailyDashboard);
const shellObserver = new MutationObserver(() => { if (document.querySelector(".app-shell") && !document.querySelector(".daily-dashboard")) { shellObserver.disconnect(); showDailyDashboard(); } });
shellObserver.observe(document.body, { childList: true, subtree: true });