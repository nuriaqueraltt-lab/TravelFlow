const root = () => document.querySelector(".app-content");

const NAVIGATION_TARGETS = [
  ".sidebar-nav__item:not([disabled])",
  "[data-dashboard-lead]",
  "[data-dashboard-trip]",
  "[data-lead-id]",
  "[data-open-client-id]",
  ".client-card[data-client-id]",
  "[data-client-reservation]",
  "[data-open-trip]",
  "[data-open-trip-tags]",
  "[data-open-trips-hub]"
].join(",");

const LEGACY_BACK_TARGETS = [
  "[data-back-dashboard]",
  "[data-back-to-leads]",
  "[data-back-clients]",
  "[data-back-client-detail]",
  "[data-back-trips]"
].join(",");

const historyStack = [];
let restoring = false;

function syncFormState(source, clone) {
  const sourceFields = source.querySelectorAll("input, select, textarea");
  const clonedFields = clone.querySelectorAll("input, select, textarea");

  sourceFields.forEach((field, index) => {
    const copy = clonedFields[index];
    if (!copy) return;

    if (field.matches('input[type="checkbox"], input[type="radio"]')) {
      copy.toggleAttribute("checked", field.checked);
      return;
    }

    if (field.tagName === "SELECT") {
      [...copy.options].forEach((option, optionIndex) => {
        option.toggleAttribute("selected", field.options[optionIndex]?.selected === true);
      });
      return;
    }

    if (field.tagName === "TEXTAREA") copy.textContent = field.value;
    else copy.setAttribute("value", field.value);
  });
}

function captureCurrentView() {
  const content = root();
  if (!content?.firstElementChild) return null;

  const clone = content.cloneNode(true);
  syncFormState(content, clone);

  return {
    html: clone.innerHTML,
    activeNav: document.body.dataset.activeNav || "",
    currentLeadId: document.body.dataset.currentLeadId || "",
    scrollY: window.scrollY
  };
}

function isSameMainSection(target) {
  const nav = target.closest(".sidebar-nav__item");
  return Boolean(nav?.dataset.navKey && nav.dataset.navKey === document.body.dataset.activeNav);
}

function pushCurrentView(target) {
  if (restoring || isSameMainSection(target)) return;
  const snapshot = captureCurrentView();
  if (!snapshot) return;

  historyStack.push(snapshot);
  if (historyStack.length > 30) historyStack.shift();
}

function restorePreviousView() {
  const snapshot = historyStack.pop();
  if (!snapshot || !root()) return;

  restoring = true;
  root().innerHTML = snapshot.html;
  document.body.dataset.activeNav = snapshot.activeNav;
  if (snapshot.currentLeadId) document.body.dataset.currentLeadId = snapshot.currentLeadId;
  else delete document.body.dataset.currentLeadId;

  const labels = { dashboard: "Dashboard", leads: "Leads", clients: "Clientes", trips: "Viatges", analytics: "Analítica", settings: "Configuració" };
  if (labels[snapshot.activeNav]) {
    window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: labels[snapshot.activeNav] } }));
  }
  window.dispatchEvent(new CustomEvent("travelflow:restore-navigation", {
    detail: { activeNav: snapshot.activeNav, currentLeadId: snapshot.currentLeadId }
  }));

  requestAnimationFrame(() => {
    window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
    restoring = false;
    ensureBackButton();
  });
}

function ensureBackButton() {
  const content = root();
  const page = content?.firstElementChild;
  if (!page || page.classList.contains("leads-loading")) return;

  let button = page.querySelector(LEGACY_BACK_TARGETS);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "global-back-button";
    page.prepend(button);
  } else {
    button.classList.add("global-back-button");
  }

  button.dataset.globalBack = "";
  if (button.textContent !== "← Tornar") button.textContent = "← Tornar";
  button.disabled = historyStack.length === 0;
  button.setAttribute("aria-label", historyStack.length ? "Tornar a la pantalla anterior" : "No hi ha cap pantalla anterior");
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-global-back]")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    restorePreviousView();
    return;
  }

  const legacyBack = event.target.closest(LEGACY_BACK_TARGETS);
  if (legacyBack) {
    event.preventDefault();
    event.stopImmediatePropagation();
    restorePreviousView();
    return;
  }

  const destination = event.target.closest(NAVIGATION_TARGETS);
  if (destination) pushCurrentView(destination);
}, true);

const observer = new MutationObserver(() => ensureBackButton());
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener("travelflow:lead-created", () => { historyStack.length = 0; });
