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
} from "../services/user-profile.service.js";

let restoringSession = false;

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

  window.dispatchEvent(new CustomEvent("travelflow:user-ready", { detail: profile }));
}

function continueToApp(form, profile) {
  form.dataset.authenticated = "true";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  requestAnimationFrame(() => requestAnimationFrame(() => applyProfileToShell(profile)));
}

async function authenticateAndLoadProfile(user, elements) {
  try {
    const profile = await loadCurrentUserProfile(user);
    setLoginState(elements);
    continueToApp(elements.form, profile);
  } catch (error) {
    clearCurrentUserProfile();
    await logout().catch(() => {});
    setLoginState(elements, {
      loading: false,
      error: getProfileErrorMessage(error)
    });
  }
}

async function handleLoginSubmit(event) {
  const elements = getLoginElements();
  const { form, emailInput, passwordInput, rememberInput } = elements;

  if (!form || form.dataset.authenticated === "true") return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  setLoginState(elements, { loading: true });

  try {
    const credential = await loginWithEmail(
      emailInput.value,
      passwordInput.value,
      Boolean(rememberInput?.checked)
    );
    await authenticateAndLoadProfile(credential.user, elements);
  } catch (error) {
    setLoginState(elements, {
      loading: false,
      error: getAuthErrorMessage(error)
    });
  }
}

async function restoreExistingSession(user) {
  if (!user || restoringSession) return;

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

document.addEventListener("submit", handleLoginSubmit, true);
observeAuthState(restoreExistingSession);
