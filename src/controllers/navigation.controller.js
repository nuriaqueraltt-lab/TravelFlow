const PAGE_NAV = [
  { classes: ["analytics-page"], label: "Analítica" },
  { classes: ["trips-management-page"], label: "Viatges" },
  { classes: ["leads-page", "lead-detail-page", "trip-leads-page"], label: "Leads" },
  { classes: ["daily-dashboard", "dashboard-view"], label: "Dashboard" }
];

function navButtons() {
  return [...document.querySelectorAll(".sidebar-nav__item")];
}

function labelForButton(button) {
  return button.querySelector("span")?.textContent?.trim() || button.textContent.trim();
}

export function setActiveNavigation(label) {
  navButtons().forEach((button) => {
    button.classList.toggle("is-active", labelForButton(button) === label);
  });
}

function visiblePageElement() {
  const content = document.querySelector(".app-content");
  if (!content) return null;
  return content.firstElementChild;
}

function syncFromVisiblePage() {
  const page = visiblePageElement();
  if (!page) return;

  const match = PAGE_NAV.find((item) =>
    item.classes.some((className) => page.classList.contains(className))
  );

  if (match) setActiveNavigation(match.label);
}

function scheduleSync() {
  requestAnimationFrame(() => requestAnimationFrame(syncFromVisiblePage));
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".sidebar-nav__item");
  if (!button || button.disabled) return;

  const label = labelForButton(button);
  if (["Dashboard", "Leads", "Viatges", "Analítica"].includes(label)) {
    setActiveNavigation(label);
    scheduleSync();
  }
}, true);

const observer = new MutationObserver((mutations) => {
  const contentChanged = mutations.some((mutation) =>
    mutation.target.matches?.(".app-content") || mutation.target.closest?.(".app-content")
  );
  if (contentChanged) scheduleSync();
});

observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("travelflow:navigation", (event) => {
  if (event.detail?.label) setActiveNavigation(event.detail.label);
  scheduleSync();
});
