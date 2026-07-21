const SECTION_KEYS = Object.freeze({
  Dashboard: "dashboard",
  Leads: "leads",
  Clientes: "clients",
  Viatges: "trips",
  Analítica: "analytics",
  Configuració: "settings"
});

let currentSection = "Dashboard";

function navButtons() {
  return [...document.querySelectorAll(".sidebar-nav__item")];
}

function labelForButton(button) {
  return button.querySelector("span")?.textContent?.trim() || button.textContent.trim();
}

function normalizeNavigationButtons() {
  navButtons().forEach((button) => {
    const label = labelForButton(button);
    const key = SECTION_KEYS[label];
    if (key) button.dataset.navKey = key;
  });
}

export function setActiveNavigation(label) {
  const key = SECTION_KEYS[label];
  if (!key) return;

  currentSection = label;
  normalizeNavigationButtons();
  document.body.dataset.activeNav = key;

  navButtons().forEach((button) => {
    const isActive = button.dataset.navKey === key;
    button.classList.remove("is-active");
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function sectionFromClick(target) {
  const navButton = target.closest(".sidebar-nav__item");
  if (navButton && !navButton.disabled) {
    const label = labelForButton(navButton);
    if (SECTION_KEYS[label]) return label;
  }

  if (target.closest("[data-back-dashboard]")) return "Dashboard";
  if (target.closest("[data-back-trips]")) return "Viatges";
  if (target.closest("[data-dashboard-lead], [data-dashboard-trip], [data-lead-id], [data-back-to-leads]")) return "Leads";

  return null;
}

document.addEventListener("click", (event) => {
  const section = sectionFromClick(event.target);
  if (section) {
    setActiveNavigation(section);
    if (section === "Clientes") window.dispatchEvent(new CustomEvent("travelflow:open-clients"));
  }
}, true);

window.addEventListener("travelflow:navigation", (event) => {
  if (event.detail?.label) setActiveNavigation(event.detail.label);
});

window.addEventListener("travelflow:lead-created", () => setActiveNavigation("Leads"));

const shellObserver = new MutationObserver(() => {
  if (!document.querySelector(".sidebar-nav")) return;
  setActiveNavigation(currentSection);
});

shellObserver.observe(document.body, { childList: true, subtree: true });
