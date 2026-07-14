import {
  getAuthErrorMessage,
  loginWithEmail,
  observeAuthState
} from "../services/auth.service.js";

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
    if (label) {
      label.textContent = loading ? "Comprovant accés..." : "Entrar a TravelFlow";
    }
  }

  if (message) {
    message.textContent = error;
    message.classList.toggle("is-error", Boolean(error));
  }
}

function continueToApp(form) {
  form.dataset.authenticated = "true";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function handleLoginSubmit(event) {
  const elements = getLoginElements();
  const { form, emailInput, passwordInput, rememberInput } = elements;

  if (!form || form.dataset.authenticated === "true") {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  setLoginState(elements, { loading: true });

  try {
    await loginWithEmail(
      emailInput.value,
      passwordInput.value,
      Boolean(rememberInput?.checked)
    );

    setLoginState(elements);
    continueToApp(form);
  } catch (error) {
    setLoginState(elements, {
      loading: false,
      error: getAuthErrorMessage(error)
    });
  }
}

function restoreExistingSession(user) {
  if (!user) return;

  const elements = getLoginElements();
  const { form, emailInput, passwordInput } = elements;

  if (!form || form.dataset.authenticated === "true") return;

  emailInput.value = user.email ?? "sessio@travelflow.app";
  passwordInput.value = "sessio-restaurada";
  continueToApp(form);
}

document.addEventListener("submit", handleLoginSubmit, true);
observeAuthState(restoreExistingSession);
