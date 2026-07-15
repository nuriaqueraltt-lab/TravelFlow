function renderDashboardLoadingState() {
  return `
    <section class="dashboard-view" data-dashboard-entry-loading>
      <div class="leads-loading">
        <span class="leads-loading__spinner"></span>
        <p>Preparant la teva llista de feina...</p>
      </div>
    </section>
  `;
}

function removeLegacyDashboard() {
  const appContent = document.querySelector(".app-shell .app-content");
  if (!appContent) return false;

  const legacyDashboard = appContent.querySelector(".assistant-card, .action-list, .travel-interest-card");
  if (!legacyDashboard) return true;

  appContent.innerHTML = renderDashboardLoadingState();
  return true;
}

if (!removeLegacyDashboard()) {
  const observer = new MutationObserver(() => {
    if (removeLegacyDashboard()) observer.disconnect();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
