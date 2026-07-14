function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filterTripTags(searchInput) {
  const fieldset = searchInput.closest(".lead-edit-trips");
  if (!fieldset) return;

  const query = normalizeText(searchInput.value);
  const options = [...fieldset.querySelectorAll(".lead-edit-trip")];
  let visibleCount = 0;

  options.forEach((option) => {
    const label = normalizeText(option.textContent);
    const visible = !query || label.includes(query);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  const emptyMessage = fieldset.querySelector("[data-trip-tag-search-empty]");
  if (emptyMessage) emptyMessage.hidden = visibleCount > 0;
}

function enhanceTripTagFieldset(fieldset) {
  if (fieldset.dataset.tripTagSearchReady === "true") return;

  const optionsContainer = fieldset.querySelector(":scope > div");
  if (!optionsContainer || !fieldset.querySelector(".lead-edit-trip")) return;

  fieldset.dataset.tripTagSearchReady = "true";
  optionsContainer.classList.add("trip-tag-options-list");

  const search = document.createElement("label");
  search.className = "trip-tag-search";
  search.innerHTML = `
    <span class="trip-tag-search__label">Buscar etiqueta</span>
    <span class="trip-tag-search__control">
      <span aria-hidden="true">⌕</span>
      <input type="search" placeholder="Escriu el nom del viatge..." autocomplete="off" data-trip-tag-search />
    </span>
  `;

  const emptyMessage = document.createElement("p");
  emptyMessage.className = "trip-tag-search__empty";
  emptyMessage.dataset.tripTagSearchEmpty = "";
  emptyMessage.textContent = "No hi ha cap etiqueta que coincideixi amb la cerca.";
  emptyMessage.hidden = true;

  fieldset.insertBefore(search, optionsContainer);
  fieldset.insertBefore(emptyMessage, optionsContainer);
}

function enhanceVisibleTripTagSelectors(root = document) {
  root.querySelectorAll?.(".lead-edit-trips").forEach(enhanceTripTagFieldset);
}

document.addEventListener("input", (event) => {
  const searchInput = event.target.closest("[data-trip-tag-search]");
  if (searchInput) filterTripTags(searchInput);
});

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(".lead-edit-trips")) enhanceTripTagFieldset(node);
      enhanceVisibleTripTagSelectors(node);
    });
  });
});

observer.observe(document.body, { childList: true, subtree: true });
enhanceVisibleTripTagSelectors();
