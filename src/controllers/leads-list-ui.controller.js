const STATUS_OPTIONS = [
  ["", "Tots els estats"],
  ["Nou", "Nou"],
  ["Informació enviada", "Informació enviada"],
  ["En seguiment", "En seguiment"],
  ["Ha contestat", "Ha contestat"],
  ["Pendent de decisió", "Pendent de decisió"],
  ["Reserva confirmada", "Reserva confirmada"],
  ["Contactar més endavant", "Contactar més endavant"],
  ["Perdut", "Perdut"]
];

const FOLLOW_UP_OPTIONS = [
  ["", "Tots els seguiments"],
  ["overdue", "Vençuts"],
  ["today", "Per avui"],
  ["upcoming", "Pròxims"],
  ["none", "Sense acció"]
];

let applying = false;

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function dateKeyFromDisplay(value = "") {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function classifyFollowUp(row) {
  const dateCell = row.querySelector(".lead-row__date");
  const key = dateKeyFromDisplay(dateCell?.textContent.trim());
  row.classList.remove("is-overdue", "is-today", "is-upcoming", "is-no-action");
  if (!key) {
    row.classList.add("is-no-action");
    return "none";
  }
  const today = localDateKey();
  if (key < today) {
    row.classList.add("is-overdue");
    return "overdue";
  }
  if (key === today) {
    row.classList.add("is-today");
    return "today";
  }
  row.classList.add("is-upcoming");
  return "upcoming";
}

function decorateTrips(row) {
  const cell = row.querySelector(".lead-row__interest");
  if (!cell || cell.dataset.enhanced === "true") return;
  const labels = cell.textContent.split(",").map((item) => item.trim()).filter(Boolean);
  if (!labels.length) return;
  const visible = labels.slice(0, 2);
  cell.innerHTML = visible.map((label) => `<span class="lead-trip-chip" title="${label.replace(/"/g, "&quot;")}">${label}</span>`).join("");
  if (labels.length > visible.length) cell.insertAdjacentHTML("beforeend", `<span class="lead-trip-chip lead-trip-chip--more">+${labels.length - visible.length} més</span>`);
  cell.dataset.enhanced = "true";
}

function decorateRow(row) {
  if (!(row instanceof HTMLElement)) return;
  classifyFollowUp(row);
  decorateTrips(row);
  const last = row.lastElementChild;
  if (last && !last.classList.contains("lead-row__open")) last.classList.add("lead-row__open");
}

function optionMarkup(options) {
  return options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function enhanceToolbar() {
  const toolbar = document.querySelector(".leads-page .leads-toolbar");
  if (!toolbar || toolbar.dataset.enhanced === "true") return;
  const search = toolbar.querySelector(".leads-search");
  const channel = toolbar.querySelector("#leadsChannelFilter");
  const count = toolbar.querySelector(".leads-count");
  if (!search || !channel || !count) return;

  search.classList.add("leads-toolbar__field");
  search.insertAdjacentHTML("afterbegin", "<span>Cerca</span>");
  channel.insertAdjacentHTML("beforebegin", '<label class="leads-toolbar__field" data-channel-field><span>Canal</span></label>');
  toolbar.querySelector("[data-channel-field]")?.append(channel);

  const statusField = document.createElement("label");
  statusField.className = "leads-toolbar__field";
  statusField.innerHTML = `<span>Estat</span><select id="leadsStatusFilter" class="leads-filter">${optionMarkup(STATUS_OPTIONS)}</select>`;

  const followField = document.createElement("label");
  followField.className = "leads-toolbar__field";
  followField.innerHTML = `<span>Seguiment</span><select id="leadsFollowUpFilter" class="leads-filter">${optionMarkup(FOLLOW_UP_OPTIONS)}</select>`;

  const actions = document.createElement("div");
  actions.className = "leads-toolbar__actions";
  actions.innerHTML = '<button class="secondary-button leads-clear-filters" type="button" data-clear-lead-filters>Netejar filtres</button>';
  actions.prepend(count);
  toolbar.append(statusField, followField, actions);
  toolbar.dataset.enhanced = "true";
}

function applySupplementalFilters() {
  if (applying) return;
  const rows = [...document.querySelectorAll("#leadsRows .lead-row")];
  if (!rows.length) return;
  applying = true;
  const status = document.querySelector("#leadsStatusFilter")?.value || "";
  const followUp = document.querySelector("#leadsFollowUpFilter")?.value || "";
  let visible = 0;
  rows.forEach((row) => {
    decorateRow(row);
    const rowStatus = row.querySelector(".lead-status")?.textContent.trim() || "";
    const rowFollowUp = classifyFollowUp(row);
    const matches = (!status || rowStatus === status) && (!followUp || rowFollowUp === followUp);
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  const count = document.querySelector("#leadsCount");
  if (count) count.textContent = visible;
  document.querySelectorAll("#leadsStatusFilter, #leadsFollowUpFilter, #leadsChannelFilter").forEach((select) => {
    select.classList.toggle("leads-filter-active", Boolean(select.value));
  });
  applying = false;
}

function enhanceLeadsList() {
  if (!document.querySelector(".leads-page")) return;
  enhanceToolbar();
  document.querySelectorAll("#leadsRows .lead-row").forEach(decorateRow);
  applySupplementalFilters();
}

const observer = new MutationObserver(() => enhanceLeadsList());
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("change", (event) => {
  if (event.target.matches("#leadsStatusFilter, #leadsFollowUpFilter, #leadsChannelFilter")) queueMicrotask(applySupplementalFilters);
});

document.addEventListener("input", (event) => {
  if (event.target.id === "leadsSearch") queueMicrotask(applySupplementalFilters);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-clear-lead-filters]")) return;
  const search = document.querySelector("#leadsSearch");
  const channel = document.querySelector("#leadsChannelFilter");
  const status = document.querySelector("#leadsStatusFilter");
  const followUp = document.querySelector("#leadsFollowUpFilter");
  if (search) {
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (channel) channel.value = "";
  if (status) status.value = "";
  if (followUp) followUp.value = "";
  channel?.dispatchEvent(new Event("change", { bubbles: true }));
  queueMicrotask(applySupplementalFilters);
});

enhanceLeadsList();
