import { getTreasuryMovements, invalidateTreasuryMovementsCache } from "../services/treasury.service.js";

const ACCOUNT_LABELS = { SL: "Compte SL", DEPOSIT: "Compte Dipòsit" };
const TYPE_LABELS = { ENTRY: "Entrada", EXIT: "Sortida", TRANSFER: "Traspàs" };
const STATUS_LABELS = { PENDING: "Pendent", RECONCILED: "Conciliat", PARTIAL: "Parcial", IGNORED: "Ignorat" };

function root() { return document.querySelector(".app-content"); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function formatCurrency(value) { return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("ca-ES").format(value) : "—"; }

function accountSummary(movements, account) {
  const rows = movements.filter((movement) => movement.account === account);
  return {
    balance: rows.reduce((sum, movement) => sum + movement.amount, 0),
    income: rows.filter((movement) => movement.amount > 0).reduce((sum, movement) => sum + movement.amount, 0),
    expenses: Math.abs(rows.filter((movement) => movement.amount < 0).reduce((sum, movement) => sum + movement.amount, 0)),
    pending: rows.filter((movement) => movement.reconciliationStatus === "PENDING").length
  };
}

function renderAccountCard(label, summary) {
  return `<article class="treasury-account-card"><header><span>${label}</span><small>Saldo registrat</small></header><strong>${formatCurrency(summary.balance)}</strong><dl><div><dt>Entrades</dt><dd>${formatCurrency(summary.income)}</dd></div><div><dt>Sortides</dt><dd>${formatCurrency(summary.expenses)}</dd></div><div><dt>Pendents</dt><dd>${summary.pending}</dd></div></dl></article>`;
}

function renderRows(movements) {
  if (!movements.length) return `<tr><td colspan="7"><div class="treasury-empty"><strong>Encara no hi ha moviments</strong><span>La taula està preparada per registrar els moviments dels comptes SL i Dipòsit.</span></div></td></tr>`;
  return movements.map((movement) => {
    const status = movement.reconciliationStatus || "PENDING";
    const amountClass = movement.amount < 0 ? "is-expense" : "is-income";
    return `<tr><td>${formatDate(movement.movementDate)}</td><td><span class="treasury-account">${ACCOUNT_LABELS[movement.account] || escapeHtml(movement.account || "—")}</span></td><td>${TYPE_LABELS[movement.type] || escapeHtml(movement.type || "—")}</td><td><strong>${escapeHtml(movement.concept || "Sense concepte")}</strong>${movement.reference ? `<small>${escapeHtml(movement.reference)}</small>` : ""}</td><td>${escapeHtml(movement.relatedName || "—")}</td><td><span class="treasury-status is-${status.toLowerCase()}">${STATUS_LABELS[status] || escapeHtml(status)}</span></td><td class="treasury-amount ${amountClass}">${formatCurrency(movement.amount)}</td></tr>`;
  }).join("");
}

function renderTreasury(movements) {
  const sl = accountSummary(movements, "SL");
  const deposit = accountSummary(movements, "DEPOSIT");
  return `<section class="treasury-page"><header class="page-heading treasury-heading"><div><span class="section-kicker">Control financer</span><h1>Tresoreria</h1><p>Moviments i saldos dels comptes de la SL i de Dipòsit.</p></div><button class="secondary-button" type="button" data-refresh-treasury>Actualitzar</button></header><section class="treasury-accounts">${renderAccountCard("Compte SL", sl)}${renderAccountCard("Compte Dipòsit", deposit)}</section><section class="treasury-table-card"><header><div><span class="section-kicker">Historial bancari</span><h2>Moviments</h2></div><span>${movements.length} moviments</span></header><div class="treasury-table-scroll"><table><thead><tr><th>Data</th><th>Compte</th><th>Tipus</th><th>Concepte</th><th>Relacionat amb</th><th>Estat</th><th>Import</th></tr></thead><tbody>${renderRows(movements)}</tbody></table></div></section></section>`;
}

export async function showTreasuryView({ force = false } = {}) {
  const container = root();
  if (!container) return;
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Tresoreria" } }));
  container.innerHTML = '<section class="treasury-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la tresoreria...</p></div></section>';
  try {
    if (force) invalidateTreasuryMovementsCache();
    container.innerHTML = renderTreasury(await getTreasuryMovements());
  } catch (error) {
    console.error("No s'ha pogut carregar la tresoreria:", error);
    container.innerHTML = '<section class="treasury-page"><div class="leads-error">No s’ha pogut carregar la Tresoreria.</div></section>';
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-treasury]")) showTreasuryView({ force: true });
});
window.addEventListener("travelflow:open-treasury", () => showTreasuryView());
