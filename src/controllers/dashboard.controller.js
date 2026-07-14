import { getOpenTasks } from "../services/workflow.service.js";
import { showLeadDetail } from "./leads.controller.js";

function root() { return document.querySelector(".app-content"); }
function startOfDay(date = new Date()) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function endOfDay(date = new Date()) { const value = new Date(date); value.setHours(23, 59, 59, 999); return value; }
function toDate(value) { return value?.toDate?.() ?? (value ? new Date(value) : null); }
function formatDate(value) {
  const date = toDate(value);
  if (!date) return "Sense data";
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

function renderTask(task, todayStart, todayEnd) {
  const due = toDate(task.dueAt);
  const overdue = due && due < todayStart;
  const today = due && due >= todayStart && due <= todayEnd;
  return `<button class="daily-task ${overdue ? "is-overdue" : today ? "is-today" : ""}" type="button" data-dashboard-lead="${task.leadId}">
    <span class="daily-task__status">${overdue ? "Vençuda" : today ? "Avui" : formatDate(task.dueAt)}</span>
    <span class="daily-task__body"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.leadName || "Futura viatgera")}${task.tripName ? ` · ${escapeHtml(task.tripName)}` : ""}</small></span>
    <span class="daily-task__arrow">→</span>
  </button>`;
}

function renderDashboard(tasks) {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const todayTasks = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due <= todayEnd; });
  const upcoming = tasks.filter((task) => { const due = toDate(task.dueAt); return due && due > todayEnd; }).slice(0, 8);
  const overdueCount = todayTasks.filter((task) => toDate(task.dueAt) < todayStart).length;

  return `<section class="dashboard-view daily-dashboard"><header class="page-heading"><div><span class="section-kicker">La teva jornada comercial</span><h1>Tasques d'avui</h1><p>Tot el que necessita una acció, ordenat per prioritat i data.</p></div><button class="primary-button primary-button--compact" type="button" data-open-new-lead>+ Nova futura viatgera</button></header>
  <section class="metrics-grid"><article class="metric-card"><span class="metric-card__label">Pendents avui</span><strong>${todayTasks.length}</strong><small>Accions per completar</small></article><article class="metric-card metric-card--warning"><span class="metric-card__label">Vençudes</span><strong>${overdueCount}</strong><small>Necessiten atenció</small></article><article class="metric-card"><span class="metric-card__label">Properes</span><strong>${Math.max(tasks.length - todayTasks.length, 0)}</strong><small>Planificades</small></article><article class="metric-card"><span class="metric-card__label">Total obertes</span><strong>${tasks.length}</strong><small>Seguiments actius</small></article></section>
  <section class="daily-dashboard-grid"><article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Prioritat</span><h2>Avui i vençudes</h2></div></header><div class="daily-task-list">${todayTasks.length ? todayTasks.map((task) => renderTask(task, todayStart, todayEnd)).join("") : `<div class="daily-empty"><strong>No tens tasques pendents per avui</strong><span>La teva llista està al dia.</span></div>`}</div></article>
  <article class="content-card"><header class="content-card__header"><div><span class="section-kicker">Planificació</span><h2>Pròximes accions</h2></div></header><div class="daily-task-list">${upcoming.length ? upcoming.map((task) => renderTask(task, todayStart, todayEnd)).join("") : `<div class="daily-empty"><strong>No hi ha accions futures</strong><span>Programa el següent contacte des de la fitxa del lead.</span></div>`}</div></article></section></section>`;
}

export async function showDailyDashboard() {
  if (!root()) return;
  root().innerHTML = `<section class="dashboard-view"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la teva llista de feina...</p></div></section>`;
  try { root().innerHTML = renderDashboard(await getOpenTasks()); }
  catch (error) { root().innerHTML = `<div class="leads-error">No s'han pogut carregar les tasques.</div>`; }
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest(".sidebar-nav__item");
  if (nav?.textContent.trim().startsWith("Dashboard")) { showDailyDashboard(); return; }
  const task = event.target.closest("[data-dashboard-lead]");
  if (task) showLeadDetail(task.dataset.dashboardLead);
});
window.addEventListener("travelflow:tasks-updated", showDailyDashboard);
window.addEventListener("travelflow:auth-ready", showDailyDashboard);