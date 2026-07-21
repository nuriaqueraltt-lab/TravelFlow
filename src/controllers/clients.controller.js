import { getClient, getClients, updateClient } from "../services/client.service.js";

const appContent = () => document.querySelector(".app-content");
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const initials = (name) => String(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const money = (value) => Number(value || 0).toLocaleString("ca-ES", { style: "currency", currency: "EUR" });
const date = (value) => value ? new Intl.DateTimeFormat("ca-ES").format(new Date(value)) : "—";

function activate() {
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Clientes" } }));
}

function renderList(clients) {
  return `<section class="clients-page">
    <header class="page-heading clients-heading"><div><span class="section-kicker">Viatgeres confirmades</span><h1>Clientes</h1><p>Dades personals i viatges reservats en un únic lloc.</p></div><div class="clients-count"><strong>${clients.length}</strong><span>clientes</span></div></header>
    <section class="clients-toolbar"><label><span>Buscar clienta</span><input id="clientsSearch" type="search" placeholder="Nom, telèfon, correu o DNI..." autocomplete="off"></label><label class="clients-check"><input id="superTravelerFilter" type="checkbox"><span>Només superviatgeres</span></label></section>
    <div class="clients-grid" id="clientsGrid">${clients.map(renderCard).join("") || '<div class="clients-empty"><h2>Encara no hi ha clientes</h2><p>Quan confirmis una reserva, la fitxa es crearà automàticament.</p></div>'}</div>
  </section>`;
}

function renderCard(client) {
  const reservations = Object.values(client.reservations || {});
  return `<button class="client-card" type="button" data-client-id="${client.id}" data-search="${esc([client.fullName, client.phone, client.email, client.dni].join(" ").toLowerCase())}" data-super="${Boolean(client.superTraveler)}">
    <span class="client-card__avatar">${initials(client.fullName)}</span><span class="client-card__body"><span class="client-card__title"><strong>${esc(client.fullName || "Sense nom")}</strong>${client.superTraveler ? '<em>★ Superviatgera</em>' : ""}</span><small>${esc(client.email || client.phone || "Dades de contacte pendents")}</small><span>${reservations.length} ${reservations.length === 1 ? "viatge reservat" : "viatges reservats"}</span></span><span class="client-card__arrow">→</span>
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
  return reservations.map((item) => `<article class="client-trip"><div><strong>${esc(item.tripName || "Viatge")}</strong><span>Reserva confirmada · ${date(item.bookedAt?.toDate?.() || item.bookedAt)}</span></div><div><span>${(item.priceConcepts || []).length} conceptes</span><strong>${money(item.total)}</strong></div></article>`).join("") || '<p class="clients-muted">No hi ha viatges vinculats.</p>';
}

function field(label, name, value = "", type = "text") { return `<label><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}"></label>`; }

function renderDetail(client) {
  return `<section class="client-detail-page"><button class="lead-detail-back" type="button" data-back-clients>← Tornar a clientes</button>
    <header class="client-detail-hero"><span class="client-detail-hero__avatar">${initials(client.fullName)}</span><div><span class="section-kicker">Fitxa de clienta</span><h1>${esc(client.fullName)}</h1><p>${esc(client.email || client.phone || "Completa les seves dades personals")}</p></div>${client.superTraveler ? '<span class="super-traveler-badge">★ Superviatgera</span>' : ""}</header>
    <div class="client-detail-grid"><form class="content-card client-form" id="clientForm" data-client-id="${client.id}"><header><div><span class="section-kicker">Informació personal</span><h2>Dades de la clienta</h2></div><button class="primary-button primary-button--compact" type="submit">Guardar canvis</button></header><div class="client-form-grid">
      ${field("Nom i cognoms", "fullName", client.fullName)}${field("Telèfon", "phone", client.phone, "tel")}${field("Correu electrònic", "email", client.email, "email")}${field("Data de naixement", "birthDate", client.birthDate, "date")}
      <label class="client-form-wide"><span>Adreça</span><input name="address" value="${esc(client.address)}"></label>${field("Codi postal", "postalCode", client.postalCode)}${field("Població", "city", client.city)}${field("Província", "province", client.province)}
      ${field("DNI", "dni", client.dni)}${field("Caducitat DNI", "dniExpiry", client.dniExpiry, "date")}${field("Passaport", "passport", client.passport)}${field("Caducitat passaport", "passportExpiry", client.passportExpiry, "date")}
      <label class="client-super-toggle"><input name="superTraveler" type="checkbox" ${client.superTraveler ? "checked" : ""}><span><strong>Superviatgera</strong><small>Clienta fidel o amb tracte especial</small></span></label>
    </div><p class="client-form-message" role="status"></p></form>
    <section class="content-card client-trips"><header><span class="section-kicker">Historial de reserves</span><h2>Viatges</h2></header>${reservationRows(client)}</section></div></section>`;
}

async function showDetail(clientId) {
  activate();
  const client = await getClient(clientId);
  if (!client) return showClientsView();
  appContent().innerHTML = renderDetail(client);
}

document.addEventListener("input", (event) => {
  if (!event.target.matches("#clientsSearch, #superTravelerFilter")) return;
  const query = document.querySelector("#clientsSearch")?.value.trim().toLowerCase() || "";
  const superOnly = document.querySelector("#superTravelerFilter")?.checked;
  document.querySelectorAll(".client-card").forEach((card) => { card.hidden = !card.dataset.search.includes(query) || (superOnly && card.dataset.super !== "true"); });
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-clients]")) { showClientsView(); return; }
  const card = event.target.closest("[data-client-id]");
  if (card) { showDetail(card.dataset.clientId); return; }
  if (event.target.closest("[data-back-clients]")) showClientsView();
});

window.addEventListener("travelflow:open-clients", () => showClientsView());

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("#clientForm")) return;
  event.preventDefault();
  const form = event.target; const message = form.querySelector(".client-form-message");
  const values = Object.fromEntries(new FormData(form)); values.superTraveler = form.elements.superTraveler.checked;
  const id = form.dataset.clientId;
  try { message.textContent = "Guardant..."; await updateClient(id, values); message.textContent = "Dades guardades correctament."; await showDetail(id); }
  catch (error) { message.textContent = error.message === "CLIENT_DUPLICATE" ? "Ja existeix una altra clienta amb aquest DNI, correu o telèfon." : "No s’han pogut guardar les dades."; }
});
