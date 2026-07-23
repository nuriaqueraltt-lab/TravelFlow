import {
  getTreasuryMovements, importTreasuryStatement, invalidateTreasuryMovementsCache
} from "../services/treasury.service.js";
import {
  getTreasuryImportErrorMessage, parseTreasuryStatement
} from "../services/treasury-import.service.js";

const CATEGORY_LABELS = {
  INTERNAL_TRANSFER: "Moviment intern",
  BANK_EXPENSE: "Despesa bancària",
  PAYMENT_GATEWAY: "Passarel·la web",
  PAYMENT_GATEWAY_REFUND: "Devolució passarel·la",
  DEPOSIT_CARD_PURCHASE: "Compra targeta dipòsits",
  POSSIBLE_CLIENT_PAYMENT: "Possible cobrament clienta",
  POSSIBLE_SUPPLIER_PAYMENT: "Possible pagament proveïdor"
};

let movements = [];

function root() { return document.querySelector(".app-content"); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function formatCurrency(value) { return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0); }
function formatDate(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ca-ES").format(date);
}

function summary(items) {
  const latest = items[0];
  return {
    balance: latest?.balance ?? 0,
    income: items.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
    expenses: Math.abs(items.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0)),
    pending: items.filter((item) => (item.reconciliationStatus || "PENDING") === "PENDING").length
  };
}

function renderSummary(items) {
  const totals = summary(items);
  return `<section class="treasury-summary">
    <article class="treasury-balance-card">
      <div><span>Compte de dipòsits ···· 0692</span><small>Saldo de l’últim moviment importat</small></div>
      <strong>${formatCurrency(totals.balance)}</strong>
    </article>
    <article class="treasury-metric"><span>Entrades importades</span><strong>${formatCurrency(totals.income)}</strong></article>
    <article class="treasury-metric"><span>Sortides importades</span><strong>${formatCurrency(totals.expenses)}</strong></article>
    <article class="treasury-metric is-pending"><span>Pendents de conciliar</span><strong>${totals.pending}</strong></article>
  </section>`;
}

function renderRows(items) {
  if (!items.length) return `<tr><td colspan="7"><div class="treasury-empty"><strong>Encara no hi ha moviments importats</strong><span>Puja el primer extracte del compte de dipòsits per començar.</span></div></td></tr>`;
  return items.map((movement) => `<tr data-treasury-row data-direction="${movement.direction || (movement.amount < 0 ? "EXIT" : "ENTRY")}" data-category="${escapeHtml(movement.category || "")}" data-search="${escapeHtml(`${movement.bankMovement || ""} ${movement.moreData || ""}`.toLowerCase())}">
    <td>${formatDate(movement.movementDate)}</td>
    <td><strong>${escapeHtml(movement.bankMovement || "Sense concepte")}</strong>${movement.moreData ? `<small>${escapeHtml(movement.moreData)}</small>` : ""}</td>
    <td><span class="treasury-category">${escapeHtml(CATEGORY_LABELS[movement.category] || "Pendent de classificar")}</span></td>
    <td>${formatDate(movement.valueDate)}</td>
    <td class="treasury-amount ${movement.amount < 0 ? "is-expense" : ""}">${formatCurrency(movement.amount)}</td>
    <td>${formatCurrency(movement.balance)}</td>
    <td><span class="treasury-status is-pending">Pendent</span></td>
  </tr>`).join("");
}

function renderImportResult(result) {
  return `<section class="treasury-import-result" role="status">
    <div><span>Importació completada</span><strong>${result.created} moviments nous</strong></div>
    <dl>
      <div><dt>Files llegides</dt><dd>${result.read}</dd></div>
      <div><dt>Ja existents</dt><dd>${result.duplicates}</dd></div>
      <div><dt>Període</dt><dd>${formatDate(result.firstDate)} – ${formatDate(result.lastDate)}</dd></div>
      <div><dt>Saldo final</dt><dd>${formatCurrency(result.finalBalance)}</dd></div>
    </dl>
  </section>`;
}

function renderTreasury(items, importResult = null) {
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  return `<section class="treasury-page">
    <header class="page-heading treasury-heading">
      <div><span class="section-kicker">Control bancari</span><h1>Tresoreria</h1><p>Moviments reals del compte de dipòsits i estat de conciliació.</p></div>
      <div class="treasury-heading-actions">
        <input type="file" data-treasury-file accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <button class="primary-button primary-button--compact" type="button" data-import-treasury>Importar extracte</button>
        <button class="secondary-button" type="button" data-refresh-treasury>Actualitzar</button>
      </div>
    </header>
    ${importResult ? renderImportResult(importResult) : ""}
    <p class="treasury-import-message" data-treasury-message role="status"></p>
    ${renderSummary(items)}
    <section class="treasury-table-card">
      <header><div><span class="section-kicker">Compte ···· 0692</span><h2>Moviments bancaris</h2></div><span data-treasury-count>${items.length} moviments</span></header>
      <div class="treasury-filters">
        <label><span>Buscar</span><input type="search" data-treasury-search placeholder="Moviment o més dades..."></label>
        <label><span>Tipus</span><select data-treasury-direction><option value="">Tots</option><option value="ENTRY">Entrades</option><option value="EXIT">Sortides</option></select></label>
        <label><span>Categoria</span><select data-treasury-category><option value="">Totes</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(CATEGORY_LABELS[category] || category)}</option>`).join("")}</select></label>
      </div>
      <div class="treasury-table-scroll"><table><thead><tr><th>Data</th><th>Moviment</th><th>Categoria inicial</th><th>Data valor</th><th>Import</th><th>Saldo</th><th>Conciliació</th></tr></thead><tbody>${renderRows(items)}</tbody></table></div>
    </section>
  </section>`;
}

function applyFilters() {
  const search = document.querySelector("[data-treasury-search]")?.value.trim().toLowerCase() || "";
  const direction = document.querySelector("[data-treasury-direction]")?.value || "";
  const category = document.querySelector("[data-treasury-category]")?.value || "";
  let visible = 0;
  document.querySelectorAll("[data-treasury-row]").forEach((row) => {
    const show = (!search || row.dataset.search.includes(search))
      && (!direction || row.dataset.direction === direction)
      && (!category || row.dataset.category === category);
    row.hidden = !show;
    if (show) visible += 1;
  });
  const count = document.querySelector("[data-treasury-count]");
  if (count) count.textContent = `${visible} moviments`;
}

export async function showTreasuryView({ force = false, importResult = null } = {}) {
  const container = root();
  if (!container) return;
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Tresoreria" } }));
  container.innerHTML = '<section class="treasury-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant la tresoreria...</p></div></section>';
  try {
    if (force) invalidateTreasuryMovementsCache();
    movements = await getTreasuryMovements();
    container.innerHTML = renderTreasury(movements, importResult);
  } catch (error) {
    console.error("No s'ha pogut carregar la tresoreria:", error);
    container.innerHTML = '<section class="treasury-page"><div class="leads-error">No s’ha pogut carregar la Tresoreria.</div></section>';
  }
}

async function handleImport(file) {
  const message = document.querySelector("[data-treasury-message]");
  const button = document.querySelector("[data-import-treasury]");
  if (!message || !button) return;
  button.disabled = true;
  message.className = "treasury-import-message";
  message.textContent = "Llegint i validant l’extracte...";
  try {
    const statement = await parseTreasuryStatement(file);
    message.textContent = `Important ${statement.movements.length} moviments...`;
    const result = await importTreasuryStatement(statement);
    await showTreasuryView({ force: true, importResult: result });
  } catch (error) {
    console.error("No s'ha pogut importar l'extracte:", error);
    message.textContent = getTreasuryImportErrorMessage(error);
    message.classList.add("is-error");
    button.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-treasury]")) showTreasuryView({ force: true });
  if (event.target.closest("[data-import-treasury]")) document.querySelector("[data-treasury-file]")?.click();
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-treasury-file]") && event.target.files?.[0]) handleImport(event.target.files[0]);
  if (event.target.matches("[data-treasury-direction], [data-treasury-category]")) applyFilters();
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-treasury-search]")) applyFilters();
});
window.addEventListener("travelflow:open-treasury", () => showTreasuryView());
