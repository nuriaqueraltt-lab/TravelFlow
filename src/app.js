import { BRAND_LOGO_URL } from "./config/app.constants.js";

function renderBrandMark() {
  return `
    <div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="img">
        <path d="M24 6c3.2 7.9 8.1 12.8 16 16-7.9 3.2-12.8 8.1-16 16-3.2-7.9-8.1-12.8-16-16 7.9-3.2 12.8-8.1 16-16Z" />
        <circle cx="24" cy="22" r="4.2" />
      </svg>
    </div>
  `;
}

function renderLoginView() {
  return `
    <main class="login-page">
      <section class="login-visual" aria-label="Presentació de TravelFlow">
        <div class="login-visual__glow login-visual__glow--one"></div>
        <div class="login-visual__glow login-visual__glow--two"></div>

        <header class="login-visual__brand">
          ${renderBrandMark()}
          <div><strong>TravelFlow</strong><span>Dones i Viatgeres</span></div>
        </header>

        <div class="login-visual__content">
          <span class="login-visual__eyebrow">Gestió comercial amb ànima viatgera</span>
          <h1>Cap futura viatgera sense resposta.</h1>
          <p>Centralitza els leads, prioritza els seguiments i acompanya cada persona des del primer missatge fins a la reserva.</p>
        </div>

        <div class="login-visual__insight">
          <div class="login-visual__insight-icon" aria-hidden="true">✦</div>
          <div><span>El teu espai comercial</span><strong>Organitzat, clar i sempre al dia</strong></div>
        </div>
      </section>

      <section class="login-panel">
        <div class="login-panel__inner">
          <div class="login-panel__mobile-brand">
            ${renderBrandMark()}
            <div><strong>TravelFlow</strong><span>Dones i Viatgeres</span></div>
          </div>

          <div class="login-panel__heading">
            <span class="section-kicker">Benvinguda de nou</span>
            <h2>Accedeix al teu espai</h2>
            <p>Gestiona les oportunitats i els seguiments del teu equip.</p>
          </div>

          <form class="login-form" id="loginForm" novalidate>
            <label class="form-field">
              <span>Correu electrònic</span>
              <div class="form-control">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
                <input type="email" name="email" autocomplete="email" placeholder="nom@donesiviatgeres.com" required />
              </div>
            </label>

            <label class="form-field">
              <span>Contrasenya</span>
              <div class="form-control">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <input id="passwordInput" type="password" name="password" autocomplete="current-password" placeholder="Introdueix la teva contrasenya" required />
                <button class="password-toggle" id="passwordToggle" type="button" aria-label="Mostrar la contrasenya">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                </button>
              </div>
            </label>

            <div class="login-form__options">
              <label class="checkbox-field"><input type="checkbox" name="remember" /><span>Recorda'm</span></label>
              <button class="link-button" type="button">He oblidat la contrasenya</button>
            </div>

            <button class="primary-button" type="submit">
              <span>Entrar a TravelFlow</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></svg>
            </button>
            <p class="login-form__message" id="loginMessage" role="status"></p>
          </form>

          <footer class="login-panel__footer"><span>Ús intern de Dones i Viatgeres</span><span>TravelFlow · 2026</span></footer>
        </div>
      </section>
    </main>
  `;
}

function renderIcon(name) {
  const icons = {
    dashboard: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />',
    leads: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M19 8v6M16 11h6" />',
    clients: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />',
    trips: '<path d="M3 12h18M12 3a15.3 15.3 0 0 1 0 18M12 3a15.3 15.3 0 0 0 0 18" /><circle cx="12" cy="12" r="9" />',
    analytics: '<path d="M4 19V10M10 19V5M16 19v-7M22 19V3" />',
    tasks: '<path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />',
    settings: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09a1.7 1.7 0 0 0-1.1-1.51 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.7.6 1 .3.28.68.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}

function renderSidebarItem({ icon, label, active = false, soon = false }) {
  return `<button class="sidebar-nav__item ${active ? "is-active" : ""}" type="button" ${soon ? "disabled" : ""}>${renderIcon(icon)}<span>${label}</span>${soon ? '<small>Properament</small>' : ""}</button>`;
}

function renderAppLoading() {
  return `<section class="dashboard-view"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Preparant el teu espai de treball...</p></div></section>`;
}

function renderAppShell() {
  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar__brand"><img class="login-brand-logo" src="${BRAND_LOGO_URL}" alt="Dones i Viatgeres" /><div class="login-brand-copy"><strong>TravelFlow</strong><span>CRM intern · Dones i Viatgeres</span></div></div>
        <nav class="sidebar-nav" aria-label="Navegació principal">
          <span class="sidebar-nav__label">Espai de treball</span>
          ${renderSidebarItem({ icon: "dashboard", label: "Dashboard", active: true })}
          ${renderSidebarItem({ icon: "leads", label: "Leads" })}
          ${renderSidebarItem({ icon: "clients", label: "Clientes" })}
          ${renderSidebarItem({ icon: "trips", label: "Viatges" })}
          ${renderSidebarItem({ icon: "analytics", label: "Analítica" })}
          ${renderSidebarItem({ icon: "tasks", label: "Tasques", soon: true })}
          <span class="sidebar-nav__label sidebar-nav__label--secondary">Sistema</span>
          ${renderSidebarItem({ icon: "settings", label: "Configuració", soon: true })}
        </nav>
        <footer class="sidebar-user">
          <div class="sidebar-user__avatar" aria-hidden="true">··</div>
          <div><strong>Carregant usuària...</strong><span>Preparant accés</span></div>
          <button type="button" aria-label="Més opcions">•••</button>
        </footer>
      </aside>

      <section class="app-main">
        <header class="topbar">
          <button class="topbar__menu" id="menuToggle" type="button" aria-label="Obrir menú">☰</button>
          <div class="topbar-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" placeholder="Cerca una viatgera, viatge o tasca..." />
            <kbd>⌘ K</kbd>
          </div>
          <div class="topbar-actions">
            <button class="icon-button" type="button" aria-label="Notificacions"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg><span></span></button>
            <div class="topbar-profile"><div aria-hidden="true">··</div><span>Carregant...</span></div>
          </div>
        </header>
        <main class="app-content">${renderAppLoading()}</main>
      </section>
      <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-label="Tancar menú"></button>
    </div>
  `;
}

function setupShellInteractions() {
  const sidebar = document.querySelector("#sidebar");
  const menuToggle = document.querySelector("#menuToggle");
  const backdrop = document.querySelector("#sidebarBackdrop");
  const closeSidebar = () => document.body.classList.remove("sidebar-open");
  menuToggle?.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  backdrop?.addEventListener("click", closeSidebar);
  sidebar?.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (window.innerWidth <= 980) closeSidebar();
  }));
}

export function showAppShell() {
  const appRoot = document.querySelector("#app");
  appRoot.innerHTML = renderAppShell();
  setupShellInteractions();
}

function setupLoginInteractions() {
  const passwordInput = document.querySelector("#passwordInput");
  const passwordToggle = document.querySelector("#passwordToggle");

  passwordToggle?.addEventListener("click", () => {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    passwordToggle.setAttribute("aria-label", shouldShow ? "Amagar la contrasenya" : "Mostrar la contrasenya");
  });

}

function bootstrap() {
  const appRoot = document.querySelector("#app");
  if (!appRoot) throw new Error("No s'ha trobat el contenidor principal de TravelFlow.");
  appRoot.innerHTML = renderLoginView();
  setupLoginInteractions();
}

bootstrap();
