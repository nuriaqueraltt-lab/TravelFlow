import { createClientReservation, getClient, getClients, updateClient, updateClientReservation } from "../services/client.service.js";
import { DEFAULT_TRIP_PRICE_CONCEPTS, getTripById, getTrips } from "../services/trip.service.js";
import { LEGACY_PAYMENT_METHODS, PAYMENT_METHODS } from "../config/app.constants.js";

const appContent = () => document.querySelector(".app-content");
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const initials = (name) => String(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const money = (value) => Number(value || 0).toLocaleString("ca-ES", { style: "currency", currency: "EUR" });
const date = (value) => value ? new Intl.DateTimeFormat("ca-ES").format(new Date(value)) : "—";
const CLIENT_DISCOVERY_CHANNELS = {
  FACEBOOK: "Facebook", INSTAGRAM: "Instagram", WEB: "Web", GOOGLE: "Google",
  FRIENDS: "Amigues o conegudes", OTHER: "Altres"
};

function whatsappUrl(phone = "") {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits ? `https://wa.me/${digits}` : "";
}

function contactAction({ href, label, className }) {
  return href
    ? `<a class="client-contact-action ${className}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : `<span class="client-contact-action ${className} is-disabled" aria-disabled="true">${label}</span>`;
}

function activate() {
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Clientes" } }));
}

function renderList(clients) {
  return `<section class="clients-page">
    <header class="page-heading clients-heading"><div><span class="section-kicker">Viatgeres confirmades</span><h1>Clientes</h1><p>Dades personals i viatges reservats en un únic lloc.</p></div><div class="clients-count"><strong>${clients.length}</strong><span>clientes</span></div></header>
    <section class="clients-toolbar"><label><span>Buscar clienta</span><input id="clientsSearch" type="search" placeholder="Nom, telèfon, correu o DNI..." autocomplete="off"></label><label class="clients-check"><input id="superTravelerFilter" type="checkbox"><span>Només superviatgeres</span></label></section>
    <section class="clients-table-card"><div class="clients-table-head"><span>Clienta</span><span>Contacte</span><span>Viatges</span><span>Pagaments</span><span></span></div><div id="clientsRows">${clients.map(renderRow).join("") || '<div class="clients-empty"><h2>Encara no hi ha clientes</h2><p>Quan confirmis una reserva, la fitxa es crearà automàticament.</p></div>'}</div></section>
  </section>`;
}

function renderRow(client) {
  const reservations = Object.values(client.reservations || {});
  const pending = reservations.reduce((sum, reservation) => {
    const paid = Number(reservation.totalPaid) || (reservation.payments || []).reduce((paymentSum, payment) => paymentSum + (Number(payment.amount) || 0), 0);
    return sum + Math.max(0, (Number(reservation.total) || 0) - paid);
  }, 0);
  const contact = client.email || client.phone || "Dades pendents";
  return `<button class="client-row" type="button" data-client-id="${client.id}" data-search="${esc([client.fullName, client.phone, client.email, client.dni].join(" ").toLowerCase())}" data-super="${Boolean(client.superTraveler)}" data-pending="${pending > 0}">
    <span class="client-row__person"><span class="client-row__avatar">${initials(client.fullName)}</span><span><strong>${esc(client.fullName || "Sense nom")}</strong>${client.superTraveler ? '<em>★ Superviatgera</em>' : ""}</span></span><span class="client-row__contact">${esc(contact)}</span><span class="client-row__trips"><strong>${reservations.length}</strong><small>${reservations.length === 1 ? "viatge" : "viatges"}</small></span><span class="client-payment-status ${pending > 0 ? "has-pending" : "is-clear"}">${pending > 0 ? `${money(pending)} pendent` : "Al dia"}</span><span class="client-row__arrow">→</span>
  </button>`;
}

export async function showClientsView() {
  activate();
  const root = appContent();
  if (!root) return;
  root.innerHTML = '<div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant clientes...</p></div>';
  try { root.innerHTML = renderList(await getClients()); }
  catch (error) {
    console.error("No s’han pogut carregar les clientes", error);
    const permissionDenied = error?.code === "permission-denied";
    root.innerHTML = `<div class="clients-empty"><h2>No s’han pogut carregar les clientes</h2><p>${permissionDenied ? "Cal publicar les noves regles de Firestore per accedir a aquesta secció." : "Revisa la connexió i torna-ho a provar."}</p><button class="secondary-button" type="button" data-retry-clients>Tornar-ho a provar</button></div>`;
  }
}

function reservationRows(client) {
  const reservations = Object.values(client.reservations || {});
  return reservations.map((item) => { const paid = Number(item.totalPaid) || (item.payments || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0); const pending = Math.max(0, (Number(item.total) || 0) - paid); return `<button class="client-trip" type="button" data-client-reservation="${esc(item.tripId)}"><div><strong>${esc(item.tripName || "Viatge")}</strong><span>Reserva confirmada · ${date(item.bookedAt?.toDate?.() || item.bookedAt)}</span><small>${item.dui ? "DUI" : "Habitació compartida"}</small></div><div><span>Pagat ${money(paid)}</span><strong>${money(pending)} pendent</strong><small>Veure i editar →</small></div></button>`; }).join("") || '<p class="clients-muted">No hi ha viatges vinculats.</p>';
}

function field(label, name, value = "", type = "text", required = false) { return `<label><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""}></label>`; }

function discoveryChannelOptions(selected = "") {
  return `<option value="">Selecciona un canal</option>${Object.entries(CLIENT_DISCOVERY_CHANNELS).map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("")}`;
}

function renderDetail(client, trips = []) {
  const whatsapp = whatsappUrl(client.phone);
  const email = String(client.email || "").trim();
  const reservedTripIds = new Set(Object.keys(client.reservations || {}));
  const availableTrips = trips.filter((trip) => !reservedTripIds.has(trip.id));
  return `<section class="client-detail-page"><button class="lead-detail-back" type="button" data-back-clients>← Tornar a clientes</button>
    <header class="client-detail-hero"><span class="client-detail-hero__avatar">${initials(client.fullName)}</span><div><span class="section-kicker">Fitxa de clienta</span><h1>${esc(client.fullName)}</h1><p>${esc(client.email || client.phone || "Completa les seves dades personals")}</p></div><div class="client-detail-hero__actions">${client.superTraveler ? '<span class="super-traveler-badge">★ Superviatgera</span>' : ""}<div class="client-contact-actions">${contactAction({ href: whatsapp, label: "WhatsApp", className: "is-whatsapp" })}${contactAction({ href: email ? `mailto:${email}` : "", label: "Correu", className: "is-email" })}</div></div></header>
    <div class="client-detail-grid"><form class="content-card client-form" id="clientForm" data-client-id="${client.id}"><header><div><span class="section-kicker">Informació personal</span><h2>Dades de la clienta</h2></div><button class="primary-button primary-button--compact" type="submit">Guardar canvis</button></header><div class="client-form-grid">
      ${field("Nom i cognoms", "fullName", client.fullName, "text", true)}${field("Telèfon", "phone", client.phone, "tel")}${field("Correu electrònic", "email", client.email, "email")}${field("Data de naixement", "birthDate", client.birthDate, "date")}
      <label class="client-form-wide"><span>Adreça</span><input name="address" value="${esc(client.address)}"></label>${field("Codi postal", "postalCode", client.postalCode)}${field("Població", "city", client.city)}${field("Província", "province", client.province)}
      ${field("DNI", "dni", client.dni)}${field("Caducitat DNI", "dniExpiry", client.dniExpiry, "date")}${field("Passaport", "passport", client.passport)}${field("Caducitat passaport", "passportExpiry", client.passportExpiry, "date")}
      <label><span>Com ens ha conegut?</span><select name="discoveryChannel">${discoveryChannelOptions(client.discoveryChannel)}</select></label>
      <label data-discovery-other ${client.discoveryChannel === "OTHER" ? "" : "hidden"}><span>Especifica el canal</span><input name="discoveryChannelOther" value="${esc(client.discoveryChannelOther)}" maxlength="120" placeholder="Escriu com ens ha conegut"></label>
      <label class="client-super-toggle"><input name="superTraveler" type="checkbox" ${client.superTraveler ? "checked" : ""}><span><strong>Superviatgera</strong><small>Clienta fidel o amb tracte especial</small></span></label>
    </div><p class="client-form-message" role="status"></p></form>
    <section class="content-card client-trips"><header><div><span class="section-kicker">Historial de reserves</span><h2>Viatges</h2></div><button class="primary-button primary-button--compact" type="button" data-show-client-booking ${availableTrips.length ? "" : "disabled"}>+ Crear reserva</button></header>
      <form class="client-new-booking" data-client-booking-form data-client-id="${client.id}" hidden><label><span>Viatge</span><select name="tripId" required><option value="">Selecciona un viatge...</option>${availableTrips.map((trip) => `<option value="${esc(trip.id)}">${esc(trip.name)}</option>`).join("")}</select></label><p role="status" data-client-booking-message></p><div><button class="secondary-button" type="button" data-cancel-client-booking>Cancel·lar</button><button class="primary-button primary-button--compact" type="submit">Crear reserva</button></div></form>
      ${availableTrips.length ? "" : '<p class="client-booking-hint">Aquesta clienta ja té reserva a tots els viatges disponibles.</p>'}${reservationRows(client)}</section></div></section>`;
}

async function showDetail(clientId) {
  activate();
  const [client, trips] = await Promise.all([getClient(clientId), getTrips()]);
  if (!client) return showClientsView();
  appContent().innerHTML = renderDetail(client, trips);
}

function reservationConcepts(reservation, trip) {
  const saved = Array.isArray(reservation.priceConcepts) ? reservation.priceConcepts : [];
  const selected = new Map(saved.map((item) => [item.id, item]));
  const catalogue = Array.isArray(trip?.priceConcepts) ? [...trip.priceConcepts] : [...DEFAULT_TRIP_PRICE_CONCEPTS];
  const loyaltyDiscount = DEFAULT_TRIP_PRICE_CONCEPTS.find((concept) => concept.id === "loyalty-discount");
  if (loyaltyDiscount && !catalogue.some((concept) => concept.id === loyaltyDiscount.id)) catalogue.push({ ...loyaltyDiscount });
  const linked = reservation.pricingMode === "TRIP";
  const rows = catalogue.map((item) => ({ ...(linked ? (selected.get(item.id) || {}) : item), ...(linked ? item : (selected.get(item.id) || {})), tripAmount: item.amount, selected: item.application === "REQUIRED" || selected.has(item.id) }));
  saved.filter((item) => !rows.some((row) => row.id === item.id)).forEach((item) => rows.push({ ...item, selected: true }));
  return rows;
}

function paymentMethodOptions(selectedMethod = "") {
  const legacyOption = LEGACY_PAYMENT_METHODS[selectedMethod]
    ? `<option value="${selectedMethod}" selected>${LEGACY_PAYMENT_METHODS[selectedMethod]} (anterior)</option>`
    : "";
  return legacyOption + Object.entries(PAYMENT_METHODS).map(([key, label]) => `<option value="${key}" ${selectedMethod === key ? "selected" : ""}>${label}</option>`).join("");
}
function paymentRow(payment = {}) { const id = payment.id || `payment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; return `<div class="client-payment-row" data-payment-row><input type="hidden" name="paymentId" value="${esc(id)}"><label><span>Data</span><input name="paymentDate" type="date" required value="${esc(payment.paidAt || "")}"></label><label><span>Import</span><span class="client-payment-amount"><input name="paymentAmount" type="number" min="0.01" step="0.01" required value="${payment.amount || ""}"><i>€</i></span></label><label><span>Forma de pagament</span><select name="paymentMethod">${paymentMethodOptions(payment.method)}</select></label><label><span>Referència / nota</span><input name="paymentReference" maxlength="160" value="${esc(payment.reference || "")}" placeholder="Ex. Reserva 150 €"></label><button type="button" data-remove-payment aria-label="Eliminar pagament">Eliminar</button></div>`; }

function renderReservation(client, reservation, trip) {
  const concepts = reservationConcepts(reservation, trip);
  const linkedPricing = reservation.pricingMode === "TRIP";
  const paid = Number(reservation.totalPaid) || (reservation.payments || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const pending = Math.max(0, (Number(reservation.total) || 0) - paid);
  return `<section class="client-reservation-page"><div class="lead-detail-actions"><button class="lead-detail-back" type="button" data-back-client-detail>← Tornar a la fitxa de ${esc(client.fullName)}</button><button class="secondary-button" type="button" data-open-trip="${esc(reservation.tripId)}">Anar al viatge →</button></div><header class="client-reservation-hero"><div><span class="section-kicker">Reserva de ${esc(client.fullName)}</span><h1>${esc(reservation.tripName || trip?.name || "Viatge")}</h1><p>Edita serveis, habitació i pagaments des d’una única fitxa.</p></div><div><span>Pendent actual</span><strong data-reservation-pending>${money(pending)}</strong></div></header><form id="clientReservationForm" data-client-id="${client.id}" data-trip-id="${esc(reservation.tripId)}"><section class="content-card client-reservation-settings"><header><div><span class="section-kicker">Dades de la reserva</span><h2>Habitació i operativa</h2></div></header><div class="client-reservation-fields"><label class="client-dui-toggle"><input name="dui" type="checkbox" ${reservation.dui ? "checked" : ""}><span><strong>DUI</strong><small>Habitació doble d’ús individual</small></span></label>${field("Companya d’habitació", "roommate", reservation.roommate)}${field("Ciutat o aeroport de sortida", "departureCity", reservation.departureCity)}<label class="client-reservation-wide"><span>Observacions de la reserva</span><textarea name="notes" rows="3">${esc(reservation.notes || "")}</textarea></label></div></section><section class="content-card client-reservation-concepts"><header><div><span class="section-kicker">Preu contractat</span><h2>Conceptes de la reserva</h2></div><strong data-reservation-total>${money(reservation.total)}</strong></header><label class="client-pricing-mode"><input type="checkbox" name="linkedPricing" ${linkedPricing ? "checked" : ""}><span><strong>Actualitzar sempre amb els preus del viatge</strong><small>Si canvies els preus generals, aquesta reserva es recalcularà automàticament. Desactiva-ho per aplicar imports personalitzats a aquesta clienta.</small></span></label><div>${concepts.map((concept) => `<div class="client-reservation-concept ${concept.selected ? "is-selected" : ""}"><input type="checkbox" name="reservationConcept" value="${esc(concept.id)}" data-name="${esc(concept.name)}" data-application="${esc(concept.application)}" data-price-status="${esc(concept.priceStatus)}" ${concept.selected ? "checked" : ""} ${concept.application === "REQUIRED" ? "disabled" : ""}><span><strong>${esc(concept.name)}</strong><small>${concept.application === "REQUIRED" ? "Inclòs per a tothom" : concept.application === "INFORMATIONAL" ? "Informatiu · no suma" : "Opcional"}</small></span><label class="client-concept-amount"><input type="number" name="reservationConceptAmount" min="0" max="1000000" step="0.01" value="${Number(concept.amount) || 0}" data-trip-amount="${Number(concept.tripAmount ?? concept.amount) || 0}" ${linkedPricing ? "readonly" : ""}><i>€</i></label></div>`).join("")}</div></section><section class="content-card client-reservation-payments"><header><div><span class="section-kicker">Control de cobraments</span><h2>Pagaments</h2></div><button class="secondary-button" type="button" data-add-payment>+ Afegir pagament</button></header><div data-payments-list>${(reservation.payments || []).map(paymentRow).join("") || '<p class="clients-muted" data-no-payments>Encara no hi ha cap pagament registrat.</p>'}</div><footer><span>Pagat <strong data-reservation-paid>${money(paid)}</strong></span><span>Pendent <strong data-reservation-footer-pending>${money(pending)}</strong></span></footer></section><div class="client-reservation-actions"><p role="status" data-reservation-message></p><button class="primary-button" type="submit">Guardar reserva</button></div></form></section>`;
}

async function showReservation(clientId, tripId) {
  const client = await getClient(clientId); const reservation = client?.reservations?.[tripId];
  if (!client || !reservation) return showClientsView();
  let trip = null; try { trip = await getTripById(tripId); } catch { /* La instantània permet editar encara que el viatge ja no sigui actiu. */ }
  appContent().innerHTML = renderReservation(client, reservation, trip);
  const loyaltyDiscountAmount = appContent().querySelector('input[name="reservationConcept"][value="loyalty-discount"]')?.closest(".client-reservation-concept")?.querySelector('[name="reservationConceptAmount"]');
  if (loyaltyDiscountAmount) loyaltyDiscountAmount.min = "-1000000";
}

document.addEventListener("input", (event) => {
  if (!event.target.matches("#clientsSearch, #superTravelerFilter")) return;
  const query = document.querySelector("#clientsSearch")?.value.trim().toLowerCase() || "";
  const superOnly = document.querySelector("#superTravelerFilter")?.checked;
  document.querySelectorAll(".client-row").forEach((row) => { row.hidden = !row.dataset.search.includes(query) || (superOnly && row.dataset.super !== "true"); });
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-clients]")) { showClientsView(); return; }
  const directClient = event.target.closest("[data-open-client-id]");
  if (directClient) { window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Clientes" } })); showDetail(directClient.dataset.openClientId); return; }
  const row = event.target.closest(".client-row[data-client-id]");
  if (row) { showDetail(row.dataset.clientId); return; }
  const reservation = event.target.closest("[data-client-reservation]");
  if (reservation) { const form = reservation.closest(".client-detail-page")?.querySelector("#clientForm"); showReservation(form?.dataset.clientId, reservation.dataset.clientReservation); return; }
  if (event.target.closest("[data-back-clients]")) showClientsView();
  if (event.target.closest("[data-back-client-detail]")) { showDetail(event.target.closest(".client-reservation-page")?.querySelector("#clientReservationForm")?.dataset.clientId); return; }
  if (event.target.closest("[data-show-client-booking]")) { document.querySelector("[data-client-booking-form]")?.removeAttribute("hidden"); return; }
  if (event.target.closest("[data-cancel-client-booking]")) { document.querySelector("[data-client-booking-form]")?.setAttribute("hidden", ""); return; }
  if (event.target.closest("[data-add-payment]")) { const list = document.querySelector("[data-payments-list]"); list?.querySelector("[data-no-payments]")?.remove(); list?.insertAdjacentHTML("beforeend", paymentRow({ paidAt: new Date().toISOString().slice(0, 10), method: "TRANSFER_DEPOSIT" })); return; }
  const removePayment = event.target.closest("[data-remove-payment]");
  if (removePayment) { removePayment.closest("[data-payment-row]")?.remove(); refreshReservationTotals(); }
});

window.addEventListener("travelflow:open-clients", () => showClientsView());

document.addEventListener("submit", async (event) => {
  if (event.target.matches("[data-client-booking-form]")) {
    event.preventDefault();
    const form = event.target; const message = form.querySelector("[data-client-booking-message]"); const button = form.querySelector('button[type="submit"]');
    try {
      button.disabled = true; message.textContent = "Creant reserva...";
      const trip = await getTripById(form.elements.tripId.value);
      await createClientReservation(form.dataset.clientId, { ...trip, priceConcepts: Array.isArray(trip.priceConcepts) ? trip.priceConcepts : DEFAULT_TRIP_PRICE_CONCEPTS });
      await showReservation(form.dataset.clientId, trip.id);
    } catch (error) {
      button.disabled = false;
      message.textContent = error.message === "RESERVATION_ALREADY_EXISTS" ? "Aquesta clienta ja té una reserva en aquest viatge." : "No s’ha pogut crear la reserva. Torna-ho a provar.";
    }
    return;
  }
  if (event.target.matches("#clientReservationForm")) {
    event.preventDefault(); const form = event.target; const message = form.querySelector("[data-reservation-message]");
    const priceConcepts = [...form.querySelectorAll('input[name="reservationConcept"]')].filter((input) => input.checked || input.disabled).map((input) => ({ id: input.value, name: input.dataset.name, amount: input.closest(".client-reservation-concept").querySelector('[name="reservationConceptAmount"]').value, application: input.dataset.application, priceStatus: input.dataset.priceStatus }));
    const payments = [...form.querySelectorAll("[data-payment-row]")].map((row) => ({ id: row.querySelector('[name="paymentId"]').value, paidAt: row.querySelector('[name="paymentDate"]').value, amount: row.querySelector('[name="paymentAmount"]').value, method: row.querySelector('[name="paymentMethod"]').value, reference: row.querySelector('[name="paymentReference"]').value }));
    try { message.textContent = "Guardant..."; await updateClientReservation(form.dataset.clientId, form.dataset.tripId, { dui: form.elements.dui.checked, roommate: form.elements.roommate.value, departureCity: form.elements.departureCity.value, notes: form.elements.notes.value, pricingMode: form.elements.linkedPricing.checked ? "TRIP" : "CUSTOM", priceConcepts, payments }); message.textContent = "Reserva guardada correctament."; await showReservation(form.dataset.clientId, form.dataset.tripId); }
    catch (error) { message.textContent = error.message === "PAYMENTS_OVER_TOTAL" ? "El total pagat no pot superar el total de la reserva." : "No s’ha pogut guardar la reserva. Revisa imports i dades."; }
    return;
  }
  if (!event.target.matches("#clientForm")) return;
  event.preventDefault();
  const form = event.target; const message = form.querySelector(".client-form-message");
  const submitButton = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form)); values.superTraveler = form.elements.superTraveler.checked;
  const id = form.dataset.clientId;
  try {
    submitButton.disabled = true; submitButton.textContent = "Guardant..."; message.textContent = "Guardant...";
    const saved = await updateClient(id, values);
    await showDetail(saved.id);
    const savedMessage = document.querySelector(".client-form-message");
    if (savedMessage) savedMessage.textContent = "Dades guardades correctament.";
  }
  catch (error) {
    submitButton.disabled = false; submitButton.textContent = "Guardar canvis";
    message.textContent = error.message === "CLIENT_DUPLICATE" ? "Ja existeix una altra clienta amb aquest DNI, correu o telèfon." : error.message === "CLIENT_NAME_REQUIRED" ? "El nom i els cognoms són obligatoris." : "No s’han pogut guardar les dades. Torna-ho a provar.";
  }
});

function refreshReservationTotals() {
  const form = document.querySelector("#clientReservationForm"); if (!form) return;
  const total = [...form.querySelectorAll('input[name="reservationConcept"]')].filter((input) => input.checked || input.disabled).reduce((sum, input) => input.dataset.application === "INFORMATIONAL" ? sum : sum + (Number(input.closest(".client-reservation-concept").querySelector('[name="reservationConceptAmount"]').value) || 0), 0);
  const paid = [...form.querySelectorAll('[name="paymentAmount"]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0); const pending = Math.max(0, total - paid);
  form.querySelector("[data-reservation-total]").textContent = money(total); form.querySelector("[data-reservation-paid]").textContent = money(paid); document.querySelector("[data-reservation-pending]").textContent = money(pending); form.querySelector("[data-reservation-footer-pending]").textContent = money(pending);
  form.querySelectorAll(".client-reservation-concept").forEach((row) => row.classList.toggle("is-selected", row.querySelector("input").checked));
}
document.addEventListener("input", (event) => { if (event.target.matches('#clientReservationForm [name="paymentAmount"]')) refreshReservationTotals(); });
document.addEventListener("input", (event) => { if (event.target.matches('#clientReservationForm [name="reservationConceptAmount"]')) refreshReservationTotals(); });
document.addEventListener("change", (event) => {
  if (event.target.matches('#clientForm [name="discoveryChannel"]')) {
    const otherField = event.target.form?.querySelector("[data-discovery-other]");
    if (!otherField) return;
    otherField.hidden = event.target.value !== "OTHER";
    if (otherField.hidden) otherField.querySelector("input").value = "";
  }
  if (event.target.matches('#clientReservationForm [name="linkedPricing"]')) {
    const linked = event.target.checked;
    event.target.form.querySelectorAll('[name="reservationConceptAmount"]').forEach((input) => { input.readOnly = linked; if (linked) input.value = input.dataset.tripAmount; });
    refreshReservationTotals();
  }
  if (event.target.matches('#clientReservationForm [name="reservationConcept"]')) refreshReservationTotals();
});
