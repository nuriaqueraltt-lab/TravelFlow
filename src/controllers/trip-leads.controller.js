import { getLeadsByTrip } from "../services/lead.service.js";
import { DEFAULT_TRIP_PRICE_CONCEPTS, getTripById, getTripErrorMessage, TRIP_PROCESS_STEPS, updateTripOperations, updateTripPricing, updateTripSupplierPayments } from "../services/trip.service.js";
import { getTripInterestStatus } from "../services/trip-interest.model.js";
import { getClients } from "../services/client.service.js";

let currentTrip = null;
let currentTripLeads = [];
let currentTripClients = [];
let currentTripTab = "summary";

const CHANNEL_LABELS = {
  WEB: "Web",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  EMAIL: "Email",
  PHONE: "Telèfon",
  OTHER: "Altres"
};

const STATUS_LABELS = {
  NEW: "Nou",
  INFO_SENT: "Informació enviada",
  FOLLOW_UP: "En seguiment",
  REPLIED: "Ha contestat",
  PENDING_DECISION: "Pendent de decisió",
  BOOKING_CONFIRMED: "Reserva confirmada",
  CONTACT_LATER: "Contactar més endavant",
  LOST: "Perdut"
};

const TAB_LABELS = {
  summary: "Resum",
  leads: "Leads",
  bookings: "Reserves",
  suppliers: "Proveïdors",
  pricing: "Preus",
  operations: "Operativa",
  analytics: "Analítica"
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

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "FV";
}

function clientForLead(lead) {
  return currentTripClients.find((client) => client.id === lead.clientId || client.leadIds?.includes(lead.id));
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function getSortedLeads(trip, leads) {
  return leads.map((lead) => ({ ...lead, status: getTripInterestStatus(lead, trip.id) })).sort((a, b) => {
    if (a.status === "LOST" && b.status !== "LOST") return 1;
    if (a.status !== "LOST" && b.status === "LOST") return -1;
    const aDate = a.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const bDate = b.nextActionAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

function renderRows(leads, { bookingsOnly = false } = {}) {
  if (!leads.length) {
    return `<div class="leads-empty"><h2>${bookingsOnly ? "Encara no hi ha reserves" : "No hi ha leads vinculats"}</h2><p>${bookingsOnly ? "Quan una interessada confirmi la reserva apareixerà aquí." : "Aquest viatge encara no té futures viatgeres associades."}</p></div>`;
  }

  return leads.map((lead) => `
    <button class="lead-row" type="button" data-lead-id="${lead.id}">
      <span class="lead-row__person">
        <span class="lead-row__avatar">${initials(lead.fullName)}</span>
        <span>
          <strong>${escapeHtml(lead.fullName)}</strong>
          <small>${escapeHtml(lead.email || lead.phone || lead.instagramHandle || "Sense contacte")}</small>
        </span>
      </span>
      <span class="lead-row__interest">${escapeHtml(lead.tripLabels?.join(", ") || "Sense viatge")}</span>
      <span class="lead-channel lead-channel--${String(lead.channel || "OTHER").toLowerCase()}">${CHANNEL_LABELS[lead.channel] || "Altres"}</span>
      <span class="lead-status">${STATUS_LABELS[lead.status] || lead.status}</span>
      <span class="lead-row__date">${formatDate(lead.nextActionAt)}</span>
      <span>→</span>
    </button>
  `).join("");
}

function renderProcessChecklist(trip) {
  const checklist = trip.processChecklist || {};
  return TRIP_PROCESS_STEPS.map(([key, label]) => `<label class="trip-process-step ${checklist[key] === true ? "is-complete" : ""}"><input type="checkbox" name="${key}" ${checklist[key] === true ? "checked" : ""}><span><i aria-hidden="true">✓</i>${label}</span></label>`).join("");
}

function renderTabs(activeTab) {
  return `<nav class="trip-detail-tabs" aria-label="Apartats de la fitxa del viatge">${Object.entries(TAB_LABELS).map(([key, label]) => `<button type="button" data-trip-tab="${key}" class="${activeTab === key ? "is-active" : ""}">${label}</button>`).join("")}</nav>`;
}

function renderSummary(trip, leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED");
  const active = leads.filter((lead) => !["BOOKING_CONFIRMED", "LOST"].includes(lead.status));
  const completed = TRIP_PROCESS_STEPS.filter(([key]) => trip.processChecklist?.[key] === true).length;
  const nextStep = TRIP_PROCESS_STEPS.find(([key]) => trip.processChecklist?.[key] !== true)?.[1] || "Checklist complet";
  const conversion = leads.length ? Math.round((bookings.length / leads.length) * 100) : 0;
  const coordinatorAssigned = Boolean(trip.tourLeaderName?.trim());
  const bookingDetails = bookings.map((lead) => {
    const client = clientForLead(lead);
    const booking = lead.tripInterests?.[trip.id] || {};
    const total = Number(booking.bookingTotal) || 0;
    const payments = Array.isArray(booking.payments) ? booking.payments : [];
    const paymentsTotal = payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
    const paid = Math.max(0, Math.min(total, Number(booking.totalPaid ?? booking.paidTotal ?? paymentsTotal) || 0));
    return { lead, client, booking, total, paid, pending: Math.max(0, total - paid) };
  });
  const totalPaid = bookingDetails.reduce((sum, item) => sum + item.paid, 0);
  const totalPending = bookingDetails.reduce((sum, item) => sum + item.pending, 0);
  const supplierPayments = getSupplierPayments(trip);
  const totalSupplierPaid = supplierPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const currentProfit = totalPaid - totalSupplierPaid;
  const travelerDuis = bookingDetails.filter((item) => item.booking.dui === true).length;
  const totalDuis = travelerDuis + (coordinatorAssigned && trip.tourLeaderDui ? 1 : 0);
  const lastStep = [...TRIP_PROCESS_STEPS].reverse().find(([key]) => trip.processChecklist?.[key] === true)?.[1] || "Encara cap";
  const reservationRows = bookingDetails.length ? bookingDetails.map(({ lead, client, booking, total, paid, pending }) => `<tr><td><button type="button" ${client ? `data-open-client-id="${client.id}"` : `data-lead-id="${lead.id}"`}>${escapeHtml(client?.fullName || lead.fullName)}</button></td><td><span class="trip-summary-dui ${booking.dui ? "is-dui" : ""}">${booking.dui ? "Sí" : "No"}</span></td><td>${formatCurrency(total)}</td><td>${formatCurrency(paid)}</td><td><strong>${formatCurrency(pending)}</strong></td></tr>`).join("") : `<tr><td colspan="5" class="trip-summary-reservations__empty">Encara no hi ha reserves confirmades.</td></tr>`;
  const supplierRows = supplierPayments.length ? supplierPayments.map((payment) => `<tr><td><strong>${escapeHtml(payment.supplierName)}</strong></td><td>${escapeHtml(payment.concept)}</td><td>${formatDate(`${payment.paymentDate}T12:00:00`)}</td><td>${escapeHtml(paymentMethodLabel(payment.paymentMethod))}</td><td><strong>${formatCurrency(payment.amount)}</strong></td></tr>`).join("") : `<tr><td colspan="5" class="trip-summary-reservations__empty">Encara no hi ha pagaments a proveïdors registrats.</td></tr>`;

  return `<section class="trip-summary-view">
    <section class="trip-summary-grid">
      <article><span>Viatgeres + TL</span><strong>${bookings.length}${coordinatorAssigned ? " + 1" : " + 0"}</strong><small>${coordinatorAssigned ? escapeHtml(trip.tourLeaderName) : "Coordinadora pendent"}</small></article>
      <article><span>Total DUIs</span><strong>${totalDuis}</strong><small>${travelerDuis} viatgeres${coordinatorAssigned && trip.tourLeaderDui ? " + coordinadora" : ""}</small></article>
      <article><span>Total pagat</span><strong>${formatCurrency(totalPaid)}</strong><small>${conversion}% de conversió</small></article>
      <article><span>Total pendent</span><strong>${formatCurrency(totalPending)}</strong><small>${bookings.length} reserves confirmades</small></article>
    </section>
    <section class="trip-overview-card">
      <div class="trip-overview-card__main">
        <span class="section-kicker">Situació actual</span>
        <h2>${escapeHtml(trip.tourLeaderName || "Coordinadora pendent d’assignar")}</h2>
        <span class="trip-overview-card__dui">DUI coordinadora: <strong>${coordinatorAssigned ? (trip.tourLeaderDui ? "Sí" : "No") : "Pendent"}</strong></span>
        <p>${escapeHtml({ AVAILABLE: "El viatge encara té places disponibles.", CONFIRMED: "El grup està confirmat.", FULL: "El grup està complet." }[trip.groupStatus || "AVAILABLE"])}</p>
      </div>
      <dl>
        <div><dt>Inici</dt><dd>${formatDate(trip.startDate)}</dd></div>
        <div><dt>Final</dt><dd>${formatDate(trip.endDate)}</dd></div>
        <div><dt>Tancament comercial</dt><dd>${formatDate(trip.closingDate)}</dd></div>
        <div><dt>Última acció</dt><dd>${escapeHtml(lastStep)}</dd></div>
        <div><dt>Pròxima acció</dt><dd>${escapeHtml(nextStep)}</dd></div>
      </dl>
    </section>
    <section class="trip-summary-reservations">
      <header><div><span class="section-kicker">Control de reserves</span><h2>Viatgeres confirmades</h2></div><span>${bookings.length} reserves · ${totalDuis} DUIs</span></header>
      <div class="trip-summary-reservations__scroll"><table><thead><tr><th>Nom i cognoms</th><th>DUI</th><th>Total reserva</th><th>Pagat</th><th>Pendent</th></tr></thead><tbody>${reservationRows}</tbody><tfoot><tr><td colspan="2">Totals del viatge</td><td>${formatCurrency(totalPaid + totalPending)}</td><td>${formatCurrency(totalPaid)}</td><td>${formatCurrency(totalPending)}</td></tr></tfoot></table></div>
    </section>
    <section class="trip-summary-reservations trip-summary-suppliers">
      <header><div><span class="section-kicker">Control de despeses</span><h2>Pagaments a proveïdors</h2></div><button class="secondary-button" type="button" data-trip-tab="suppliers">Gestionar pagaments</button></header>
      <div class="trip-summary-reservations__scroll"><table><thead><tr><th>Proveïdor</th><th>Concepte</th><th>Data</th><th>Forma de pagament</th><th>Import pagat</th></tr></thead><tbody>${supplierRows}</tbody><tfoot><tr><td colspan="4">Total pagat a proveïdors</td><td>${formatCurrency(totalSupplierPaid)}</td></tr></tfoot></table></div>
    </section>
    <section class="trip-profit-summary">
      <article><span>Cobrat a viatgeres</span><strong>${formatCurrency(totalPaid)}</strong></article>
      <span class="trip-profit-summary__operator">−</span>
      <article><span>Pagat a proveïdors</span><strong>${formatCurrency(totalSupplierPaid)}</strong></article>
      <span class="trip-profit-summary__operator">=</span>
      <article class="trip-profit-summary__result ${currentProfit < 0 ? "is-negative" : ""}"><span>Benefici actual</span><strong>${formatCurrency(currentProfit)}</strong><small>Segons cobraments i pagaments registrats</small></article>
    </section>
    <section class="trip-quick-access">
      <button type="button" data-trip-tab="leads"><strong>Gestionar leads</strong><span>${active.length} interessades actives →</span></button>
      <button type="button" data-trip-tab="bookings"><strong>Veure reserves</strong><span>${bookings.length} viatgeres confirmades →</span></button>
      <button type="button" data-trip-tab="operations"><strong>Continuar operativa</strong><span>${completed} passos completats →</span></button>
    </section>
  </section>`;
}

function renderLeadsView(leads) {
  return `<section class="trip-travelers-section"><header><div><span class="section-kicker">Seguiment comercial</span><h2>Leads del viatge</h2></div><span>${leads.length} persones vinculades</span></header><section class="leads-table-card"><div class="leads-table-head"><span>Futura viatgera</span><span>Viatges</span><span>Canal</span><span>Estat</span><span>Pròxima acció</span><span></span></div><div>${renderRows(leads)}</div></section></section>`;
}

function renderBookingsView(leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED");
  const configured = bookings.filter((lead) => Array.isArray(lead.tripInterests?.[currentTrip?.id]?.bookingPriceConcepts));
  const total = configured.reduce((sum, lead) => sum + (Number(lead.tripInterests?.[currentTrip?.id]?.bookingTotal) || 0), 0);
  const rows = bookings.map((lead) => { const client = clientForLead(lead); const name = client?.fullName || lead.fullName; const contact = client?.email || client?.phone || lead.email || lead.phone || "Sense contacte"; const booking = lead.tripInterests?.[currentTrip?.id] || {}; const concepts = Array.isArray(booking.bookingPriceConcepts) ? booking.bookingPriceConcepts : null; return `<button class="lead-row" type="button" ${client ? `data-open-client-id="${client.id}"` : `data-lead-id="${lead.id}"`}><span class="lead-row__person"><span class="lead-row__avatar">${initials(name)}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(contact)}</small></span></span><span>${booking.dui ? "DUI" : "Doble compartida / pendent"}</span><span>${concepts ? `${concepts.length} conceptes` : "Preu pendent"}</span><strong>${concepts ? formatCurrency(booking.bookingTotal) : "—"}</strong><span class="lead-status">Reserva confirmada</span><span>→</span></button>`; }).join("") || `<div class="leads-empty"><h2>Encara no hi ha reserves</h2><p>Quan una interessada confirmi la reserva apareixerà aquí.</p></div>`;
  return `<section class="trip-travelers-section"><header><div><span class="section-kicker">Viatgeres confirmades</span><h2>Reserves</h2></div><span>${bookings.length} reserves confirmades</span></header><section class="trip-booking-financial-summary"><article><span>Reserves amb preu configurat</span><strong>${configured.length} de ${bookings.length}</strong></article><article><span>Import contractat total</span><strong>${formatCurrency(total)}</strong></article></section><section class="leads-table-card trip-booking-table"><div class="leads-table-head"><span>Viatgera</span><span>Habitació</span><span>Conceptes</span><span>Total</span><span>Estat</span><span></span></div><div>${rows}</div></section></section>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function getSupplierPayments(trip) {
  return (Array.isArray(trip.supplierPayments) ? trip.supplierPayments : [])
    .map((payment) => ({ ...payment, amount: Number(payment.amount) || 0 }))
    .sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function paymentMethodLabel(method) {
  return { TRANSFER: "Transferència", CARD: "Targeta", CASH: "Efectiu", DIRECT_DEBIT: "Domiciliació", OTHER: "Altres" }[method] || "Altres";
}

function renderSuppliersView(trip, message = "", editingId = "") {
  const payments = getSupplierPayments(trip);
  const editing = payments.find((payment) => payment.id === editingId);
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const rows = payments.length ? payments.map((payment) => `<tr><td><strong>${escapeHtml(payment.supplierName)}</strong></td><td>${escapeHtml(payment.concept)}</td><td>${formatDate(`${payment.paymentDate}T12:00:00`)}</td><td>${escapeHtml(paymentMethodLabel(payment.paymentMethod))}</td><td>${escapeHtml(payment.reference || "—")}</td><td><strong>${formatCurrency(payment.amount)}</strong></td><td><div class="trip-supplier-actions"><button type="button" data-edit-supplier-payment="${payment.id}">Editar</button><button class="is-danger" type="button" data-delete-supplier-payment="${payment.id}">Eliminar</button></div></td></tr>`).join("") : `<tr><td colspan="7" class="trip-summary-reservations__empty">Encara no hi ha pagaments registrats.</td></tr>`;
  return `<section class="trip-suppliers-view">
    <section class="trip-supplier-form-card">
      <header><div><span class="section-kicker">Tresoreria del viatge</span><h2>${editing ? "Editar pagament" : "Nou pagament a proveïdor"}</h2><p>Registra només imports que ja s'han pagat efectivament.</p></div><aside><span>Total pagat</span><strong>${formatCurrency(total)}</strong></aside></header>
      <form id="tripSupplierPaymentForm" data-trip-id="${trip.id}" data-payment-id="${editing?.id || ""}">
        <div class="trip-supplier-form-grid">
          <label class="form-field"><span>Proveïdor</span><input name="supplierName" maxlength="160" required value="${escapeHtml(editing?.supplierName || "")}" placeholder="Nom del proveïdor"></label>
          <label class="form-field"><span>Concepte</span><input name="concept" maxlength="180" required value="${escapeHtml(editing?.concept || "")}" placeholder="Hotel, vols, assegurança..."></label>
          <label class="form-field"><span>Data de pagament</span><input name="paymentDate" type="date" required value="${editing?.paymentDate || new Date().toISOString().slice(0, 10)}"></label>
          <label class="form-field"><span>Import pagat</span><input name="amount" type="number" min="0.01" max="1000000" step="0.01" required value="${editing?.amount || ""}" placeholder="0,00"></label>
          <label class="form-field"><span>Forma de pagament</span><select name="paymentMethod"><option value="TRANSFER" ${editing?.paymentMethod === "TRANSFER" ? "selected" : ""}>Transferència</option><option value="CARD" ${editing?.paymentMethod === "CARD" ? "selected" : ""}>Targeta</option><option value="DIRECT_DEBIT" ${editing?.paymentMethod === "DIRECT_DEBIT" ? "selected" : ""}>Domiciliació</option><option value="CASH" ${editing?.paymentMethod === "CASH" ? "selected" : ""}>Efectiu</option><option value="OTHER" ${editing?.paymentMethod === "OTHER" ? "selected" : ""}>Altres</option></select></label>
          <label class="form-field"><span>Referència o factura</span><input name="reference" maxlength="180" value="${escapeHtml(editing?.reference || "")}" placeholder="Opcional"></label>
        </div>
        <div class="trip-supplier-form-actions">${editing ? '<button class="secondary-button" type="button" data-cancel-supplier-edit>Cancel·lar</button>' : ""}<p class="quick-lead-form__message ${message ? "is-success" : ""}" id="tripSupplierPaymentMessage">${escapeHtml(message)}</p><button class="primary-button primary-button--compact" type="submit">${editing ? "Guardar canvis" : "Registrar pagament"}</button></div>
      </form>
    </section>
    <section class="trip-summary-reservations trip-supplier-payments-table"><header><div><span class="section-kicker">Historial</span><h2>Pagaments registrats</h2></div><span>${payments.length} moviments</span></header><div class="trip-summary-reservations__scroll"><table><thead><tr><th>Proveïdor</th><th>Concepte</th><th>Data</th><th>Forma</th><th>Referència</th><th>Import</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Total pagat a proveïdors</td><td>${formatCurrency(total)}</td><td></td></tr></tfoot></table></div></section>
  </section>`;
}

function getPriceConcepts(trip) {
  const concepts = Array.isArray(trip.priceConcepts) ? trip.priceConcepts : DEFAULT_TRIP_PRICE_CONCEPTS;
  return concepts.map((concept, index) => ({ ...concept, order: index }));
}

function renderPriceRow(concept, index, total) {
  return `<article class="trip-price-row" data-price-row data-price-id="${escapeHtml(concept.id)}">
    <div class="trip-price-row__rail">
      <span class="trip-price-row__number">${String(index + 1).padStart(2, "0")}</span>
      <div class="trip-price-row__order"><button type="button" data-price-move="up" aria-label="Pujar concepte" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-price-move="down" aria-label="Baixar concepte" ${index === total - 1 ? "disabled" : ""}>↓</button></div>
    </div>
    <div class="trip-price-row__main">
      <label class="trip-price-row__name"><span>Concepte</span><input name="conceptName" maxlength="120" required value="${escapeHtml(concept.name)}" placeholder="Nom del concepte"></label>
      <label class="trip-price-row__amount"><span>Import</span><span class="trip-price-amount"><input name="conceptAmount" type="number" min="0" max="1000000" step="0.01" required value="${Number(concept.amount) || 0}"><i>€</i></span></label>
    </div>
    <div class="trip-price-row__settings">
      <label><span>Qui el contracta?</span><select name="conceptApplication"><option value="REQUIRED" ${concept.application === "REQUIRED" ? "selected" : ""}>Inclòs per a tothom</option><option value="OPTIONAL" ${concept.application === "OPTIONAL" ? "selected" : ""}>Selecció opcional</option><option value="INFORMATIONAL" ${concept.application === "INFORMATIONAL" ? "selected" : ""}>Només informatiu</option></select></label>
      <label><span>Estat de l’import</span><select name="conceptPriceStatus"><option value="FINAL" ${concept.priceStatus === "FINAL" ? "selected" : ""}>Preu definitiu</option><option value="ESTIMATED" ${concept.priceStatus === "ESTIMATED" ? "selected" : ""}>Preu estimat</option></select></label>
    </div>
    <div class="trip-price-row__footer"><span>Concepte ${index + 1} de ${total}</span><button class="trip-price-row__delete" type="button" data-price-delete aria-label="Eliminar ${escapeHtml(concept.name)}">Eliminar concepte</button></div>
  </article>`;
}

function renderPricingView(trip, message = "") {
  const concepts = getPriceConcepts(trip);
  const requiredTotal = concepts.filter((concept) => concept.application === "REQUIRED").reduce((total, concept) => total + (Number(concept.amount) || 0), 0);
  return `<section class="trip-pricing-card">
    <header><div><span class="section-kicker">Configuració econòmica</span><h2>Conceptes i preus</h2><p>Defineix les línies que després es podran assignar a cada reserva.</p></div><aside><span>Base obligatòria actual</span><strong data-price-required-total>${formatCurrency(requiredTotal)}</strong></aside></header>
    <form id="tripPricingForm" data-trip-id="${trip.id}">
      <div class="trip-pricing-head"><span>Ordre</span><span>Concepte</span><span>Import</span><span>Aplicació</span><span>Preu</span><span></span></div>
      <div class="trip-price-list" data-price-list>${concepts.map((concept, index) => renderPriceRow(concept, index, concepts.length)).join("")}</div>
      <div class="trip-pricing-actions"><button class="secondary-button" type="button" data-price-add>+ Afegir concepte</button><p class="quick-lead-form__message ${message ? "is-success" : ""}" id="tripPricingMessage">${escapeHtml(message)}</p><button class="primary-button primary-button--compact" type="submit">Guardar preus</button></div>
    </form>
  </section>`;
}

function renderOperationsView(trip, message = "") {
  const completed = TRIP_PROCESS_STEPS.filter(([key]) => trip.processChecklist?.[key] === true).length;
  return `<section class="trip-operations-card">
    <header><div><span class="section-kicker">Organització</span><h2>Seguiment operatiu</h2></div><strong>${completed} de ${TRIP_PROCESS_STEPS.length} completats</strong></header>
    <div class="trip-progress"><span style="width:${Math.round((completed / TRIP_PROCESS_STEPS.length) * 100)}%"></span></div>
    <form id="tripOperationsForm" data-trip-id="${trip.id}">
      <div class="trip-operations-fields"><label class="form-field trip-tour-leader"><span>Tour Leader · Coordinadora del viatge</span><input name="tourLeaderName" type="text" value="${escapeHtml(trip.tourLeaderName || "")}" placeholder="Nom de la coordinadora"></label><label class="form-field trip-group-status"><span>Estat del grup</span><select name="groupStatus"><option value="AVAILABLE" ${(trip.groupStatus || "AVAILABLE") === "AVAILABLE" ? "selected" : ""}>Places disponibles</option><option value="CONFIRMED" ${trip.groupStatus === "CONFIRMED" ? "selected" : ""}>Grup confirmat</option><option value="FULL" ${trip.groupStatus === "FULL" ? "selected" : ""}>Grup complet</option></select></label><label class="trip-tour-leader-dui"><input name="tourLeaderDui" type="checkbox" ${trip.tourLeaderDui ? "checked" : ""}><span>La coordinadora porta DUI</span></label></div>
      <fieldset class="trip-process-list"><legend>Checklist del viatge</legend>${renderProcessChecklist(trip)}</fieldset>
      <div class="trip-operations-actions"><p class="quick-lead-form__message ${message ? "is-success" : ""}" id="tripOperationsMessage">${escapeHtml(message)}</p><button class="primary-button primary-button--compact" type="submit">Guardar canvis</button></div>
    </form>
  </section>`;
}

function renderAnalyticsView(leads) {
  const bookings = leads.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
  const channelCounts = Object.entries(leads.reduce((acc, lead) => {
    const channel = lead.channel || "OTHER";
    acc[channel] = (acc[channel] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const maxChannel = Math.max(...channelCounts.map(([, count]) => count), 1);
  const statusCounts = Object.entries(leads.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  return `<section class="trip-analytics-view">
    <section class="trip-analytics-highlight"><span class="section-kicker">Conversió del viatge</span><strong>${leads.length ? Math.round((bookings / leads.length) * 100) : 0}%</strong><p>${bookings} reserves de ${leads.length} leads vinculats.</p></section>
    <section class="trip-analytics-grid">
      <article><header><h2>Leads per canal</h2><span>${channelCounts.length} canals</span></header><div class="trip-bars">${channelCounts.length ? channelCounts.map(([channel, count]) => `<div><span>${CHANNEL_LABELS[channel] || "Altres"}</span><i><b style="width:${Math.round((count / maxChannel) * 100)}%"></b></i><strong>${count}</strong></div>`).join("") : "<p>Encara no hi ha dades.</p>"}</div></article>
      <article><header><h2>Estats comercials</h2><span>${leads.length} leads</span></header><ul class="trip-status-list">${statusCounts.length ? statusCounts.map(([status, count]) => `<li><span>${STATUS_LABELS[status] || status}</span><strong>${count}</strong></li>`).join("") : "<li>Encara no hi ha dades.</li>"}</ul></article>
    </section>
  </section>`;
}

function renderActiveTab(trip, leads, message = "") {
  if (currentTripTab === "leads") return renderLeadsView(leads);
  if (currentTripTab === "bookings") return renderBookingsView(leads);
  if (currentTripTab === "suppliers") return renderSuppliersView(trip, message);
  if (currentTripTab === "pricing") return renderPricingView(trip, message);
  if (currentTripTab === "operations") return renderOperationsView(trip, message);
  if (currentTripTab === "analytics") return renderAnalyticsView(leads);
  return renderSummary(trip, leads);
}

function renderTripDetail(trip, leads, message = "") {
  const matching = getSortedLeads(trip, leads);
  const bookings = matching.filter((lead) => lead.status === "BOOKING_CONFIRMED").length;
  return `<section class="trip-detail-page">
    <button class="trip-detail-back" type="button" data-back-trips>← Tornar a Viatges</button>
    <header class="page-heading"><div><span class="section-kicker">Fitxa central del viatge</span><h1>${escapeHtml(trip.name?.replace(/^\d{4}\s*-\s*/, "") || "Viatge")}</h1><p>${formatDate(trip.startDate)} – ${formatDate(trip.endDate)} · ${matching.length} leads · ${bookings} reserves.</p></div></header>
    ${renderTabs(currentTripTab)}
    <div class="trip-detail-content">${renderActiveTab(trip, matching, message)}</div>
  </section>`;
}

export async function showLeadsForTrip(tripId) {
  const container = root();
  if (!container || !tripId) return;

  currentTripTab = "summary";
  container.innerHTML = `<section class="leads-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant la fitxa del viatge...</p></div></section>`;

  try {
    const [leads, trip, clients] = await Promise.all([getLeadsByTrip(tripId), getTripById(tripId), getClients()]);
    currentTrip = trip;
    currentTripLeads = leads;
    currentTripClients = clients;
    container.innerHTML = renderTripDetail(currentTrip, currentTripLeads);
  } catch (error) {
    console.error("No s'ha pogut carregar la fitxa del viatge:", error);
    container.innerHTML = `<div class="leads-error">No s'ha pogut carregar la fitxa d'aquest viatge.</div>`;
  }
}

document.addEventListener("click", (event) => {
  const editSupplierPayment = event.target.closest?.("[data-edit-supplier-payment]");
  if (editSupplierPayment && currentTrip) {
    root().querySelector(".trip-detail-content").innerHTML = renderSuppliersView(currentTrip, "", editSupplierPayment.dataset.editSupplierPayment);
    return;
  }
  const cancelSupplierEdit = event.target.closest?.("[data-cancel-supplier-edit]");
  if (cancelSupplierEdit && currentTrip) {
    root().querySelector(".trip-detail-content").innerHTML = renderSuppliersView(currentTrip);
    return;
  }
  const deleteSupplierPayment = event.target.closest?.("[data-delete-supplier-payment]");
  if (deleteSupplierPayment && currentTrip) {
    if (!window.confirm("Vols eliminar aquest pagament a proveïdor?")) return;
    const button = deleteSupplierPayment;
    button.disabled = true;
    updateTripSupplierPayments(currentTrip.id, getSupplierPayments(currentTrip).filter((payment) => payment.id !== button.dataset.deleteSupplierPayment))
      .then((updated) => { currentTrip = { ...currentTrip, ...updated }; root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, "Pagament eliminat correctament."); })
      .catch((error) => { button.disabled = false; window.alert(getTripErrorMessage(error)); });
    return;
  }
  const addButton = event.target.closest?.("[data-price-add]");
  if (addButton && currentTrip) {
    const list = addButton.closest("form")?.querySelector("[data-price-list]");
    if (!list) return;
    const id = `concept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    list.insertAdjacentHTML("beforeend", renderPriceRow({ id, name: "", amount: 0, application: "OPTIONAL", priceStatus: "FINAL" }, list.children.length, list.children.length + 1));
    refreshPriceRows(list);
    list.lastElementChild?.querySelector('input[name="conceptName"]')?.focus();
    return;
  }
  const deleteButton = event.target.closest?.("[data-price-delete]");
  if (deleteButton) {
    const list = deleteButton.closest("[data-price-list]");
    deleteButton.closest("[data-price-row]")?.remove();
    refreshPriceRows(list);
    return;
  }
  const moveButton = event.target.closest?.("[data-price-move]");
  if (moveButton) {
    const row = moveButton.closest("[data-price-row]");
    const list = row?.parentElement;
    if (moveButton.dataset.priceMove === "up" && row?.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (moveButton.dataset.priceMove === "down" && row?.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    refreshPriceRows(list);
    return;
  }
  const tabButton = event.target.closest?.("[data-trip-tab]");
  if (!tabButton || !currentTrip) return;
  currentTripTab = tabButton.dataset.tripTab;
  root().innerHTML = renderTripDetail(currentTrip, currentTripLeads);
});

function refreshPriceRows(list) {
  if (!list) return;
  const rows = [...list.querySelectorAll("[data-price-row]")];
  rows.forEach((row, index) => {
    row.querySelector('[data-price-move="up"]').disabled = index === 0;
    row.querySelector('[data-price-move="down"]').disabled = index === rows.length - 1;
  });
  const total = rows.reduce((sum, row) => row.querySelector('[name="conceptApplication"]')?.value === "REQUIRED" ? sum + (Number(row.querySelector('[name="conceptAmount"]')?.value) || 0) : sum, 0);
  const output = list.closest("form")?.previousElementSibling?.querySelector("[data-price-required-total]");
  if (output) output.textContent = formatCurrency(total);
}

document.addEventListener("input", (event) => {
  if (event.target.closest?.("#tripPricingForm")) refreshPriceRows(event.target.closest("form").querySelector("[data-price-list]"));
});

document.addEventListener("change", (event) => {
  if (event.target.closest?.("#tripPricingForm")) refreshPriceRows(event.target.closest("form").querySelector("[data-price-list]"));
});

document.addEventListener("change", (event) => {
  const step = event.target.closest?.("#tripOperationsForm .trip-process-step input");
  if (step) step.closest(".trip-process-step").classList.toggle("is-complete", step.checked);
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.id === "tripSupplierPaymentForm") {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector("#tripSupplierPaymentMessage");
    const data = new FormData(form);
    const existing = getSupplierPayments(currentTrip);
    const current = existing.find((payment) => payment.id === form.dataset.paymentId);
    const payment = { id: current?.id || `supplier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, supplierName: data.get("supplierName"), concept: data.get("concept"), paymentDate: data.get("paymentDate"), amount: data.get("amount"), paymentMethod: data.get("paymentMethod"), reference: data.get("reference"), createdAt: current?.createdAt };
    const payments = current ? existing.map((item) => item.id === current.id ? payment : item) : [...existing, payment];
    submit.disabled = true;
    message.className = "quick-lead-form__message";
    message.textContent = "Guardant...";
    try {
      const updated = await updateTripSupplierPayments(form.dataset.tripId, payments);
      currentTrip = { ...currentTrip, ...updated };
      root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, current ? "Pagament actualitzat correctament." : "Pagament registrat correctament.");
    } catch (error) {
      submit.disabled = false;
      message.classList.add("is-error");
      message.textContent = getTripErrorMessage(error);
    }
    return;
  }
  if (form.id === "tripPricingForm") {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector("#tripPricingMessage");
    const priceConcepts = [...form.querySelectorAll("[data-price-row]")].map((row) => ({
      id: row.dataset.priceId,
      name: row.querySelector('[name="conceptName"]').value,
      amount: row.querySelector('[name="conceptAmount"]').value,
      application: row.querySelector('[name="conceptApplication"]').value,
      priceStatus: row.querySelector('[name="conceptPriceStatus"]').value
    }));
    submit.disabled = true;
    message.className = "quick-lead-form__message";
    message.textContent = "Guardant...";
    try {
      const updated = await updateTripPricing(form.dataset.tripId, priceConcepts);
      currentTrip = { ...currentTrip, ...updated };
      root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, "Preus guardats correctament.");
    } catch (error) {
      submit.disabled = false;
      message.classList.add("is-error");
      message.textContent = getTripErrorMessage(error);
    }
    return;
  }
  if (form.id !== "tripOperationsForm") return;
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const message = form.querySelector("#tripOperationsMessage");
  const data = new FormData(form);
  submit.disabled = true;
  message.className = "quick-lead-form__message";
  message.textContent = "Guardant...";
  try {
    const updated = await updateTripOperations(form.dataset.tripId, {
      tourLeaderName: data.get("tourLeaderName") || "",
      tourLeaderDui: data.has("tourLeaderDui"),
      groupStatus: data.get("groupStatus") || "AVAILABLE",
      processChecklist: Object.fromEntries(TRIP_PROCESS_STEPS.map(([key]) => [key, data.has(key)]))
    });
    currentTrip = { ...currentTrip, ...updated };
    root().innerHTML = renderTripDetail(currentTrip, currentTripLeads, "Canvis guardats correctament.");
  } catch (error) {
    submit.disabled = false;
    message.classList.add("is-error");
    message.textContent = getTripErrorMessage(error);
  }
});
