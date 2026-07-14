const MAIN_SECTIONS = ["Dashboard", "Leads", "Viatges", "Analítica"];
let currentSection = "Dashboard";

function navButtons() {
  return [...document.querySelectorAll(".sidebar-nav__item")];
}

function labelForButton(button) {
  return button.querySelector("span")?.textContent?.trim() || button.textContent.trim();
}

export function setActiveNavigation(label) {
  if (!MAIN_SECTIONS.includes(label)) return;
  currentSection = label;

  navButtons().forEach((button) => {
    const isActive = labelForButton(button) === label;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function sectionFromClick(target) {
  const navButton = target.closest(".sidebar-nav__item");
  if (navButton && !navButton.disabled) {
    const label = labelForButton(navButton);
    if (MAIN_SECTIONS.includes(label)) return label;
  }

  if (target.closest("[data-back-dashboard]")) return "Dashboard";
  if (target.closest("[data-dashboard-lead], [data-dashboard-trip], [data-lead-id], [data-back-to-leads]")) return "Leads";

  return null;
}

document.addEventListener("click", (event) => {
  const section = sectionFromClick(event.target);
  if (section) setActiveNavigation(section);
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