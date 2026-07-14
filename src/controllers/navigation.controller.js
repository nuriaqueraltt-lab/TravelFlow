const PAGE_NAV = [
  { classes: ["analytics-page"], label: "Analítica" },
  { classes: ["trips-management-page"], label: "Viatges" },
  { classes: ["leads-page", "lead-detail-page", "trip-leads-page"], label: "Leads" },
  { classes: ["daily-dashboard", "dashboard-view"], label: "Dashboard" }
];

const VALID_LABELS = new Set(["Dashboard", "Leads", "Viatges", "Analítica"]);
let currentLabel = "Dashboard";
let explicitNavigationUntil = 0;

function navButtons() {
  return [...document.querySelectorAll(".sidebar-nav__item")];
}

function labelForButton(button) {
  return button.querySelector(":scope > span")?.textContent?.trim() || button.textContent.trim();
}

function prepareNavigationButtons() {
  navButtons().forEach((button) => {
    const label = labelForButton(button);
    if (VALID_LABELS.has(label)) button.dataset.navLabel = label;
  });
}

export function setActiveNavigation(label, { explicit = false } = {}) {
  if (!VALID_LABELS.has(label)) return;
  currentLabel = label;
  if (explicit) explicitNavigationUntil = Date.now() + 1200;

  prepareNavigationButtons();
  navButtons().forEach((button) => {
    button.classList.toggle("is-active", button.dataset.navLabel === label);
  });
}

function visiblePageElement() {
  return document.querySelector(".app-content")?.firstElementChild || null;
}

function labelFromVisiblePage() {
  const page = visiblePageElement();
  if (!page) return "";

  const match = PAGE_NAV.find((item) =>
    item.classes.some((className) => page.classList.contains(className))
  );
  return match?.label || "";
}

function syncFromVisiblePage() {
  prepareNavigationButtons();
  const visibleLabel = labelFromVisiblePage();

  if (visibleLabel && Date.now() >= explicitNavigationUntil) {
    currentLabel = visibleLabel;
  }
  setActiveNavigation(currentLabel);
}

function scheduleSync() {
  requestAnimationFrame(() => requestAnimationFrame(syncFromVisiblePage));
}

function labelFromAction(target) {
  const navButton = target.closest?.(".sidebar-nav__item");
  if (navButton && !navButton.disabled) {
    const label = labelForButton(navButton);
    if (VALID_LABELS.has(label)) return label;
  }

  if (target.closest?.("[data-dashboard-lead], [data-dashboard-trip], [data-lead-id], [data-back-to-leads]")) return "Leads";
  if (target.closest?.("[data-back-dashboard]")) return "Dashboard";
  return "";
}

document.addEventListener("click", (event) => {
  const label = labelFromAction(event.target);
  if (!label) return;
  setActiveNavigation(label, { explicit: true });
  scheduleSync();
}, true);

const observer = new MutationObserver((mutations) => {
  const contentChanged = mutations.some((mutation) =>
    mutation.target.matches?.(".app-content") || mutation.target.closest?.(".app-content")
  );
  const sidebarChanged = mutations.some((mutation) =>
    mutation.target.matches?.(".sidebar-nav") || mutation.target.closest?.(".sidebar-nav")
  );
  if (contentChanged || sidebarChanged) scheduleSync();
});

observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener("travelflow:navigation", (event) => {
  if (event.detail?.label) setActiveNavigation(event.detail.label, { explicit: true });
  scheduleSync();
});

prepareNavigationButtons();
scheduleSync();
