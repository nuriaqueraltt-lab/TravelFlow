import {
  getAuthErrorMessage,
  loginWithEmail,
  logout,
  observeAuthState
} from "../services/auth.service.js";
import {
  clearCurrentUserProfile,
  getProfileErrorMessage,
  getProfileInitials,
  getRoleLabel,
  loadCurrentUserProfile
} from "../services/user-profile.service.js?v=20260721-2";
import { showAppShell } from "../app.js?v=20260721-2";

let restoringSession = false;
let logoutInProgress = false;
let loginInProgress = false;

const PROFILE_LOAD_TIMEOUT_MS = 15000;
const AUTH_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, errorCode) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(errorCode)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function getLoginElements() {
  const form = document.querySelector("#loginForm");

  return {
    form,
    emailInput: form?.elements.namedItem("email"),
    passwordInput: form?.elements.namedItem("password"),
    rememberInput: form?.elements.namedItem("remember"),
    submitButton: form?.querySelector('button[type="submit"]'),
    message: document.querySelector("#loginMessage")
  };
}

function setLoginState({ submitButton, message }, { loading = false, error = "" } = {}) {
  if (submitButton) {
    submitButton.disabled = loading;
    submitButton.setAttribute("aria-busy", String(loading));

    const label = submitButton.querySelector("span");
    if (label) label.textContent = loading ? "Comprovant accés..." : "Entrar a TravelFlow";
  }

  if (message) {
    message.textContent = error;
    message.classList.toggle("is-error", Boolean(error));
  }
}

function setLoginProgress(elements, label) {
  setLoginState(elements, { loading: true });
  const buttonLabel = elements.submitButton?.querySelector("span");
  if (buttonLabel) buttonLabel.textContent = label;
}

function renderUserMenu(profile) {
  const roleLabel = getRoleLabel(profile.role);
  return `
    <div class="user-menu" data-user-menu hidden>
      <div class="user-menu__identity">
        <strong>${profile.displayName}</strong>
        <span>${profile.email || ""}</span>
        <small>${roleLabel}</small>
      </div>
      <button class="user-menu__logout" type="button" data-logout>
        <span>Tancar sessió</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  `;
}

function setupUserMenu(profile) {
  const sidebarUser = document.querySelector(".sidebar-user");
  const sidebarButton = sidebarUser?.querySelector("button");
  const topbarProfile = document.querySelector(".topbar-profile");

  if (sidebarUser && !sidebarUser.querySelector("[data-user-menu]")) {
    sidebarUser.insertAdjacentHTML("beforeend", renderUserMenu(profile));
  }

  if (sidebarButton) {
    sidebarButton.dataset.userMenuToggle = "";
    sidebarButton.setAttribute("aria-label", "Obrir menú d’usuari");
    sidebarButton.setAttribute("aria-expanded", "false");
  }

  if (topbarProfile) {
    topbarProfile.setAttribute("role", "button");
    topbarProfile.setAttribute("tabindex", "0");
    topbarProfile.setAttribute("aria-label", "Obrir menú d’usuari");
    topbarProfile.setAttribute("aria-expanded", "false");
    topbarProfile.dataset.userMenuToggle = "";
  }
}

function applyProfileToShell(profile) {
  const initials = getProfileInitials(profile);
  const firstName = profile.displayName.split(/\s+/).filter(Boolean)[0] || profile.displayName;
  const roleLabel = getRoleLabel(profile.role);

  document.body.dataset.userRole = profile.role;
  document.body.dataset.userUid = profile.uid;

  const sidebarAvatar = document.querySelector(".sidebar-user__avatar");
  const sidebarName = document.querySelector(".sidebar-user strong");
  const sidebarRole = document.querySelector(".sidebar-user span");
  const topbarAvatar = document.querySelector(".topbar-profile div");
  const topbarName = document.querySelector(".topbar-profile span");

  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = profile.displayName;
  if (sidebarRole) sidebarRole.textContent = roleLabel;
  if (topbarAvatar) topbarAvatar.textContent = initials;
  if (topbarName) topbarName.textContent = firstName;

  setupUserMenu(profile);
  window.dispatchEvent(new CustomEvent("travelflow:user-ready", { detail: profile }));
}

function continueToApp(profile) {
  document.body.dataset.userRole = profile.role;
  document.body.dataset.userUid = profile.uid;
  showAppShell();
  applyProfileToShell(profile);
}

async function authenticateAndLoadProfile(user, elements) {
  try {
    const profile = await withTimeout(
      loadCurrentUserProfile(user),
      PROFILE_LOAD_TIMEOUT_MS,
      "PROFILE_LOAD_TIMEOUT"
    );
    setLoginState(elements);
    continueToApp(profile);
  } catch (error) {
    clearCurrentUserProfile();
    setLoginState(elements, {
      loading: false,
      error: getProfileErrorMessage(error)
    });
    // Tancar la sessió és una neteja secundària: mai ha de mantenir
    // bloquejada la pantalla si Firebase o Safari deixen la petició pendent.
    void logout().catch(() => {});
  }
}

async function handleLoginSubmit(event) {
  const elements = getLoginElements();
  const { form, emailInput, passwordInput, rememberInput } = elements;

  if (!form || form.dataset.authenticated === "true" || loginInProgress) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  setLoginProgress(elements, "Iniciant sessió...");
  loginInProgress = true;

  try {
    const credential = await withTimeout(
      loginWithEmail(
        emailInput.value,
        passwordInput.value,
        Boolean(rememberInput?.checked)
      ),
      AUTH_TIMEOUT_MS,
      "AUTH_TIMEOUT"
    );
    setLoginProgress(elements, "Carregant perfil...");
    await authenticateAndLoadProfile(credential.user, elements);
  } catch (error) {
    setLoginState(elements, {
      loading: false,
      error: getAuthErrorMessage(error)
    });
  } finally {
    loginInProgress = false;
  }
}

async function restoreExistingSession(user) {
  if (!user || restoringSession || loginInProgress) return;

  const elements = getLoginElements();
  const { form, emailInput, passwordInput } = elements;
  if (!form || form.dataset.authenticated === "true") return;

  restoringSession = true;
  setLoginState(elements, { loading: true });
  emailInput.value = user.email ?? "sessio@travelflow.app";
  passwordInput.value = "sessio-restaurada";

  try {
    await authenticateAndLoadProfile(user, elements);
  } finally {
    restoringSession = false;
  }
}

function closeUserMenu() {
  const menu = document.querySelector("[data-user-menu]");
  if (menu) menu.hidden = true;
  document.querySelectorAll("[data-user-menu-toggle]").forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
}

function toggleUserMenu() {
  const menu = document.querySelector("[data-user-menu]");
  if (!menu) return;
  const shouldOpen = menu.hidden;
  menu.hidden = !shouldOpen;
  document.querySelectorAll("[data-user-menu-toggle]").forEach((toggle) => toggle.setAttribute("aria-expanded", String(shouldOpen)));
}

async function handleLogout() {
  if (logoutInProgress) return;
  logoutInProgress = true;

  const button = document.querySelector("[data-logout]");
  if (button) {
    button.disabled = true;
    button.querySelector("span")?.replaceChildren("Tancant sessió...");
  }

  try {
    clearCurrentUserProfile();
    await logout();
  } finally {
    document.body.classList.remove("sidebar-open", "modal-open");
    delete document.body.dataset.userRole;
    delete document.body.dataset.userUid;
    window.location.reload();
  }
}

document.addEventListener("submit", handleLoginSubmit, true);

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-user-menu-toggle]");
  const logoutButton = event.target.closest("[data-logout]");

  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleUserMenu();
    return;
  }

  if (logoutButton) {
    event.preventDefault();
    handleLogout();
    return;
  }

  if (!event.target.closest("[data-user-menu]")) closeUserMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeUserMenu();
  if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".topbar-profile[data-user-menu-toggle]")) {
    event.preventDefault();
    toggleUserMenu();
  }
});

observeAuthState(restoreExistingSession);
