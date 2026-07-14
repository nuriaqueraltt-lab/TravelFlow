const PAGE_NAV = [
  { selector: ".daily-dashboard, .dashboard-view", label: "Dashboard" },
  { selector: ".leads-page, .lead-detail-page, .trip-leads-page", label: "Leads" },
  { selector: ".trips-management-page", label: "Viatges" },
  { selector: ".analytics-page", label: "Analítica" }
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

function syncFromVisiblePage() {
  const match = PAGE_NAV.find((item) => document.querySelector(`.app-content ${item.selector}`));
  if (match) setActiveNavigation(match.label);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".sidebar-nav__item");
  if (!button || button.disabled) return;
  const label = labelForButton(button);
  if (["Dashboard", "Leads", "Viatges", "Analítica"].includes(label)) setActiveNavigation(label);
}, true);

const observer = new MutationObserver(() => requestAnimationFrame(syncFromVisiblePage));
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("travelflow:navigation", (event) => setActiveNavigation(event.detail?.label));
