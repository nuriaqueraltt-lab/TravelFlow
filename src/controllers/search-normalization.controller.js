function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filterLeadRows() {
  const searchInput = document.querySelector("#leadsSearch");
  const channelSelect = document.querySelector("#leadsChannelFilter");
  const rowsContainer = document.querySelector("#leadsRows");
  if (!searchInput || !rowsContainer) return;

  const query = normalizeText(searchInput.value);
  const channel = channelSelect?.value || "";
  const rows = [...rowsContainer.querySelectorAll(".lead-row")];
  let visible = 0;

  rows.forEach((row) => {
    const textMatches = !query || normalizeText(row.textContent).includes(query);
    const channelMatches = !channel || row.querySelector(`.lead-channel--${channel.toLowerCase()}`);
    const show = Boolean(textMatches && channelMatches);
    row.hidden = !show;
    if (show) visible += 1;
  });

  const count = document.querySelector("#leadsCount");
  if (count) count.textContent = String(visible);

  let empty = rowsContainer.querySelector("[data-normalized-search-empty]");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "leads-empty";
    empty.dataset.normalizedSearchEmpty = "";
    empty.innerHTML = "<h2>No hi ha resultats</h2><p>Prova una altra cerca.</p>";
    rowsContainer.appendChild(empty);
  }
  empty.hidden = visible > 0 || rows.length === 0;
}

function enhanceTripsSearch(page) {
  if (!page || page.dataset.searchEnhanced === "true") return;
  const summary = page.querySelector(".trips-management-summary");
  const card = page.querySelector(".trips-management-card");
  if (!summary || !card) return;

  page.dataset.searchEnhanced = "true";
  const toolbar = document.createElement("section");
  toolbar.className = "trips-search-toolbar";
  toolbar.innerHTML = `
    <label class="trips-search-field">
      <span class="trips-search-field__label">Buscar viatge</span>
      <input type="search" placeholder="Nom del viatge o any..." autocomplete="off" data-trips-search />
    </label>
    <span class="trips-search-count"><strong data-trips-visible-count></strong> viatges</span>
  `;
  summary.insertAdjacentElement("afterend", toolbar);
  filterTripRows(toolbar.querySelector("[data-trips-search]"));
}

function filterTripRows(searchInput) {
  const page = searchInput?.closest(".trips-management-page");
  if (!page) return;
  const query = normalizeText(searchInput.value);
  const rows = [...page.querySelectorAll(".trip-management-row")];
  let visible = 0;

  rows.forEach((row) => {
    const show = !query || normalizeText(row.textContent).includes(query);
    row.hidden = !show;
    if (show) visible += 1;
  });

  const count = page.querySelector("[data-trips-visible-count]");
  if (count) count.textContent = String(visible);

  const card = page.querySelector(".trips-management-card");
  let empty = card?.querySelector("[data-trips-search-empty]");
  if (card && !empty) {
    empty = document.createElement("div");
    empty.className = "leads-empty";
    empty.dataset.tripsSearchEmpty = "";
    empty.innerHTML = "<h2>No hi ha cap viatge</h2><p>Prova una altra cerca.</p>";
    card.appendChild(empty);
  }
  if (empty) empty.hidden = visible > 0 || rows.length === 0;
}

document.addEventListener("input", (event) => {
  if (event.target.id === "leadsSearch") {
    event.stopImmediatePropagation();
    filterLeadRows();
    return;
  }
  if (event.target.matches("[data-trips-search]")) filterTripRows(event.target);
}, true);

document.addEventListener("change", (event) => {
  if (event.target.id === "leadsChannelFilter") {
    event.stopImmediatePropagation();
    filterLeadRows();
  }
}, true);

const observer = new MutationObserver(() => {
  document.querySelectorAll(".trips-management-page").forEach(enhanceTripsSearch);
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll(".trips-management-page").forEach(enhanceTripsSearch);
