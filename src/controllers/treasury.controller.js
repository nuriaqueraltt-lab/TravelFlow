import {
  getTreasuryMovements, importTreasuryStatement, invalidateTreasuryMovementsCache,
  setTreasuryMovementChecked,
  updateTreasuryMovementCategory
} from "../services/treasury.service.js";
import {
  getTreasuryImportErrorMessage, parseTreasuryStatement
} from "../services/treasury-import.service.js";

const ACCOUNTS = {
  DEPOSIT: { label: "Compte de dipòsits", last4: "0692", description: "Viatges, viatgeres i proveïdors." },
  SL: { label: "Compte SL", last4: "8899", description: "Lloguers rurals i despeses d’empresa." }
};
const COMMON_CATEGORY_LABELS = {
  UNCLASSIFIED: "Pendent de classificar",
  INTERNAL_TRANSFER: "Moviment intern",
  BANK_EXPENSE: "Despesa bancària",
  REFUND: "Devolució",
  OTHER: "Altres"
};
const DEPOSIT_CATEGORY_LABELS = {
  ...COMMON_CATEGORY_LABELS,
  POSSIBLE_CLIENT_PAYMENT: "Cobrament de clienta",
  POSSIBLE_SUPPLIER_PAYMENT: "Pagament a proveïdor",
  PAYMENT_GATEWAY: "Passarel·la web",
  PAYMENT_GATEWAY_REFUND: "Devolució passarel·la",
  DEPOSIT_CARD_PURCHASE: "Compra targeta dipòsits"
};
const SL_CATEGORY_LABELS = {
  ...COMMON_CATEGORY_LABELS,
  SL_RENTAL_INCOME: "Ingrés de lloguer rural",
  SL_AIRBNB_INCOME: "Ingrés d’Airbnb",
  SL_BOOKING_INCOME: "Ingrés de Booking",
  SL_OWNER_PAYMENT: "Pagament de casa o propietari",
  SL_COMPANY_EXPENSE: "Despesa general d’empresa",
  SL_TRAVEL_EXPENSE: "Despesa de viatge",
  SL_TAX: "Impostos",
  SL_PAYROLL: "Nòmines",
  SL_CARD_PURCHASE: "Compra amb targeta SL",
  SL_SUBSCRIPTION_SERVICE: "Subscripcions i serveis"
};

let movements = [];
let selectedAccount = "DEPOSIT";

function categoryOptions(account = selectedAccount) {
  return Object.entries(account === "SL" ? SL_CATEGORY_LABELS : DEPOSIT_CATEGORY_LABELS);
}

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

function renderSummary(items, account) {
  const totals = summary(items);
  const config = ACCOUNTS[account];
  return `<section class="treasury-summary">
    <article class="treasury-balance-card">
      <div><span>${config.label} ···· ${config.last4}</span><small>Saldo de l’últim moviment importat</small></div>
      <strong>${formatCurrency(totals.balance)}</strong>
    </article>
    <article class="treasury-metric"><span>Entrades importades</span><strong>${formatCurrency(totals.income)}</strong></article>
    <article class="treasury-metric"><span>Sortides importades</span><strong>${formatCurrency(totals.expenses)}</strong></article>
    <article class="treasury-metric is-pending"><span>Pendents de conciliar</span><strong>${totals.pending}</strong></article>
  </section>`;
}

function renderRows(items, account) {
  const options = categoryOptions(account);
  if (!items.length) return `<tr><td colspan="7"><div class="treasury-empty"><strong>Encara no hi ha moviments importats</strong><span>Puja el primer extracte del ${ACCOUNTS[account].label.toLowerCase()} per començar.</span></div></td></tr>`;
  return items.map((movement) => `<tr data-treasury-row data-direction="${movement.direction || (movement.amount < 0 ? "EXIT" : "ENTRY")}" data-category="${escapeHtml(movement.category || "")}" data-search="${escapeHtml(`${movement.bankMovement || ""} ${movement.moreData || ""}`.toLowerCase())}">
    <td>${formatDate(movement.movementDate)}</td>
    <td><strong>${escapeHtml(movement.bankMovement || "Sense concepte")}</strong>${movement.moreData ? `<small>${escapeHtml(movement.moreData)}</small>` : ""}</td>
    <td><select class="treasury-category-select" data-treasury-category-select data-movement-id="${escapeHtml(movement.id)}" aria-label="Classificació del moviment">
      ${options.map(([value, label]) => `<option value="${value}" ${value === (movement.category || "UNCLASSIFIED") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select></td>
    <td>${formatDate(movement.valueDate)}</td>
    <td class="treasury-amount ${movement.amount < 0 ? "is-expense" : ""}">${formatCurrency(movement.amount)}</td>
    <td>${formatCurrency(movement.balance)}</td>
    <td>${renderCheckedControl(movement)}</td>
  </tr>`).join("");
}

function renderCheckedControl(movement) {
  const checked = (movement.reconciliationStatus || "PENDING") !== "PENDING";
  return `<label class="treasury-checked-control">
    <input type="checkbox" data-treasury-checked="${escapeHtml(movement.id)}" ${checked ? "checked" : ""}>
    <span>Comprovat</span>
  </label>`;
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
  const account = ACCOUNTS[selectedAccount];
  const options = categoryOptions(selectedAccount);
  return `<section class="treasury-page">
    <header class="page-heading treasury-heading">
      <div><span class="section-kicker">Control bancari</span><h1>Tresoreria</h1><p>Dos comptes separats, amb els seus propis saldos, moviments i classificacions.</p></div>
      <div class="treasury-heading-actions">
        <input type="file" data-treasury-file accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <button class="primary-button primary-button--compact" type="button" data-import-treasury>Importar extracte</button>
        <button class="secondary-button" type="button" data-refresh-treasury>Actualitzar</button>
      </div>
    </header>
    <nav class="treasury-account-selector" aria-label="Selecciona el compte">
      ${Object.entries(ACCOUNTS).map(([value, config]) => `<button type="button" class="${value === selectedAccount ? "is-active" : ""}" data-treasury-account="${value}">
        <span>${config.label}</span><strong>···· ${config.last4}</strong><small>${config.description}</small>
      </button>`).join("")}
    </nav>
    ${importResult ? renderImportResult(importResult) : ""}
    <p class="treasury-import-message" data-treasury-message role="status"></p>
    ${renderSummary(items, selectedAccount)}
    <section class="treasury-table-card">
      <header><div><span class="section-kicker">${account.label} ···· ${account.last4}</span><h2>Moviments bancaris</h2></div><span data-treasury-count>${items.length} moviments</span></header>
      <div class="treasury-filters">
        <label><span>Buscar</span><input type="search" data-treasury-search placeholder="Moviment o més dades..."></label>
        <label><span>Tipus</span><select data-treasury-direction><option value="">Tots</option><option value="ENTRY">Entrades</option><option value="EXIT">Sortides</option></select></label>
        <label><span>Categoria</span><select data-treasury-category><option value="">Totes</option>${options.map(([category, label]) => `<option value="${escapeHtml(category)}">${escapeHtml(label)}</option>`).join("")}</select></label>
      </div>
      <div class="treasury-table-scroll"><table><thead><tr><th>Data</th><th>Moviment</th><th>Classificació</th><th>Data valor</th><th>Import</th><th>Saldo</th><th>Comprovat</th></tr></thead><tbody>${renderRows(items, selectedAccount)}</tbody></table></div>
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
    movements = await getTreasuryMovements({ account: selectedAccount });
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
    if (statement.account !== selectedAccount) throw new Error("TREASURY_ACCOUNT_MISMATCH");
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

async function handleCategoryChange(select) {
  const movementId = select.dataset.movementId;
  const row = select.closest("[data-treasury-row]");
  const previousCategory = row?.dataset.category || "UNCLASSIFIED";
  if (!movementId || select.value === previousCategory) return;
  select.disabled = true;
  try {
    await updateTreasuryMovementCategory(movementId, select.value);
    if (row) row.dataset.category = select.value;
    applyFilters();
  } catch (error) {
    console.error("No s'ha pogut actualitzar la classificació:", error);
    select.value = previousCategory;
    window.alert("No s’ha pogut guardar la classificació del moviment.");
  } finally {
    select.disabled = false;
  }
}

async function handleCheckedChange(checkbox) {
  checkbox.disabled = true;
  try {
    await setTreasuryMovementChecked(checkbox.dataset.treasuryChecked, checkbox.checked);
    await showTreasuryView({ force: true });
  } catch (error) {
    console.error("No s'ha pogut actualitzar l'estat comprovat:", error);
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    window.alert("No s’ha pogut guardar l’estat del moviment.");
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-refresh-treasury]")) showTreasuryView({ force: true });
  if (event.target.closest("[data-import-treasury]")) document.querySelector("[data-treasury-file]")?.click();
  const accountButton = event.target.closest("[data-treasury-account]");
  if (accountButton && accountButton.dataset.treasuryAccount !== selectedAccount) {
    selectedAccount = accountButton.dataset.treasuryAccount;
    showTreasuryView();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-treasury-file]") && event.target.files?.[0]) handleImport(event.target.files[0]);
  if (event.target.matches("[data-treasury-direction], [data-treasury-category]")) applyFilters();
  if (event.target.matches("[data-treasury-category-select]")) handleCategoryChange(event.target);
  if (event.target.matches("[data-treasury-checked]")) handleCheckedChange(event.target);
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-treasury-search]")) applyFilters();
});
window.addEventListener("travelflow:open-treasury", () => showTreasuryView());
