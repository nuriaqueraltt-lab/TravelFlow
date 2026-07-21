const PAGE_SELECTORS = [
  ".leads-page",
  ".clients-page",
  ".trips-hub-page",
  ".trips-management-page",
  ".analytics-page",
  ".user-admin-page"
];

function addDashboardBackButton() {
  const page = document.querySelector(`.app-content :is(${PAGE_SELECTORS.join(", ")})`);
  if (!page || page.querySelector(":scope > [data-back-dashboard]")) return;

  const button = document.createElement("button");
  button.className = "lead-detail-back";
  button.type = "button";
  button.dataset.backDashboard = "";
  button.textContent = "← Tornar al Dashboard";
  page.prepend(button);
}

const observer = new MutationObserver(addDashboardBackButton);
observer.observe(document.body, { childList: true, subtree: true });

addDashboardBackButton();
