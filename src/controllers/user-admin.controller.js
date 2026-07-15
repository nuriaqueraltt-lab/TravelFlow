import {
  createManagedUser,
  generateTemporaryPassword,
  getManagedUsers,
  getUserAdminError,
  sendManagedUserPasswordReset,
  updateManagedUser
} from "../services/user-admin.service.js";
import { getCurrentUserProfile, USER_ROLES } from "../services/user-profile.service.js";

let usersCache = [];
let loading = false;

function root() {
  return document.querySelector(".app-content");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function isAdmin() {
  return getCurrentUserProfile()?.role === USER_ROLES.ADMIN;
}

function renderUserRow(user) {
  const isSelf = user.id === getCurrentUserProfile()?.uid;
  return `
    <article class="user-admin-row" data-managed-user="${escapeHtml(user.id)}">
      <div class="user-admin-row__identity">
        <span class="user-admin-avatar">${escapeHtml(String(user.displayName || user.email || "U").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""))}</span>
        <div>
          <strong>${escapeHtml(user.displayName || "Usuària")}${isSelf ? " · Tu" : ""}</strong>
          <span>${escapeHtml(user.email || "Sense correu")}</span>
        </div>
      </div>
      <label>
        <span>Rol</span>
        <select data-user-role ${isSelf ? "disabled" : ""}>
          <option value="COMERCIAL" ${user.role === "COMERCIAL" ? "selected" : ""}>Comercial</option>
          <option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>Administració</option>
        </select>
      </label>
      <label class="user-admin-status">
        <span>Accés</span>
        <select data-user-active ${isSelf ? "disabled" : ""}>
          <option value="true" ${user.active !== false ? "selected" : ""}>Actiu</option>
          <option value="false" ${user.active === false ? "selected" : ""}>Desactivat</option>
        </select>
      </label>
      <div class="user-admin-row__actions">
        <button class="secondary-button" type="button" data-reset-user-password data-user-email="${escapeHtml(user.email || "")}">Restablir contrasenya</button>
        ${isSelf ? "" : '<button class="primary-button primary-button--compact" type="button" data-save-managed-user>Guardar</button>'}
      </div>
    </article>`;
}

function renderView() {
  return `
    <section class="user-admin-page">
      <header class="page-heading">
        <div>
          <span class="section-kicker">Configuració</span>
          <h1>Usuaris i accessos</h1>
          <p>Dona accés a l’equip i controla què pot gestionar cada persona.</p>
        </div>
        <button class="secondary-button" type="button" data-refresh-managed-users>Actualitzar llista</button>
      </header>

      <section class="user-admin-layout">
        <article class="content-card user-admin-create-card">
          <header>
            <span class="section-kicker">Nou accés</span>
            <h2>Donar d’alta una usuària</h2>
            <p>Es crearà el compte de Firebase i el perfil de TravelFlow sense tancar la teva sessió.</p>
          </header>
          <form class="user-admin-form" data-create-managed-user>
            <label>Nom complet<input name="displayName" required placeholder="Ex. Alba Garcia" /></label>
            <label>Correu electrònic<input name="email" type="email" required placeholder="alba@donesiviatgeres.com" /></label>
            <label>Rol<select name="role"><option value="COMERCIAL">Comercial</option><option value="ADMIN">Administració</option></select></label>
            <label>Contrasenya temporal
              <span class="user-admin-password-field">
                <input name="temporaryPassword" minlength="8" required />
                <button class="secondary-button" type="button" data-generate-password>Generar</button>
              </span>
            </label>
            <p class="user-admin-help">Si el compte ja existeix a Firebase però no apareix a la llista, torna a introduir el mateix correu i la mateixa contrasenya temporal. TravelFlow completarà el perfil que falta.</p>
            <button class="primary-button" type="submit">Crear o completar accés</button>
            <p class="user-admin-message" data-user-admin-message role="status"></p>
          </form>
        </article>

        <article class="content-card user-admin-list-card">
          <header>
            <span class="section-kicker">Equip</span>
            <h2>Accessos actuals</h2>
            <p>${usersCache.length} usuàries configurades.</p>
          </header>
          <div class="user-admin-list">
            ${usersCache.length ? usersCache.map(renderUserRow).join("") : '<div class="daily-empty"><strong>No hi ha usuaris configurats</strong></div>'}
          </div>
        </article>
      </section>
    </section>`;
}

export async function showUserAdminView() {
  if (!isAdmin() || loading || !root()) return;
  loading = true;
  window.dispatchEvent(new CustomEvent("travelflow:navigation", { detail: { label: "Configuració" } }));
  root().innerHTML = '<section class="user-admin-page"><div class="leads-loading"><span class="leads-loading__spinner"></span><p>Carregant accessos...</p></div></section>';
  try {
    usersCache = await getManagedUsers();
    root().innerHTML = renderView();
  } catch (error) {
    root().innerHTML = `<div class="leads-error">${escapeHtml(getUserAdminError(error))}</div>`;
  } finally {
    loading = false;
  }
}

function enableSettingsNavigation() {
  if (!isAdmin()) return;
  const button = [...document.querySelectorAll(".sidebar-nav__item")].find((item) => item.textContent.trim().startsWith("Configuració"));
  if (!button) return;
  button.disabled = false;
  button.dataset.navKey = "settings";
  button.querySelector("small")?.remove();
}

function setMessage(text, isError = false) {
  const message = document.querySelector("[data-user-admin-message]");
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("is-error", isError);
  message.classList.toggle("is-success", !isError && Boolean(text));
}

document.addEventListener("click", async (event) => {
  const settings = event.target.closest(".sidebar-nav__item");
  if (settings?.textContent.trim().startsWith("Configuració") && isAdmin()) {
    event.preventDefault();
    showUserAdminView();
    return;
  }

  if (event.target.closest("[data-refresh-managed-users]")) {
    loading = false;
    await showUserAdminView();
    return;
  }

  const generate = event.target.closest("[data-generate-password]");
  if (generate) {
    const input = generate.closest("form")?.elements.namedItem("temporaryPassword");
    if (input) input.value = generateTemporaryPassword();
    return;
  }

  const save = event.target.closest("[data-save-managed-user]");
  if (save) {
    const row = save.closest("[data-managed-user]");
    save.disabled = true;
    try {
      await updateManagedUser(row.dataset.managedUser, {
        role: row.querySelector("[data-user-role]").value,
        active: row.querySelector("[data-user-active]").value === "true"
      });
      loading = false;
      await showUserAdminView();
    } catch (error) {
      window.alert(getUserAdminError(error));
      save.disabled = false;
    }
    return;
  }

  const reset = event.target.closest("[data-reset-user-password]");
  if (reset) {
    const email = reset.dataset.userEmail;
    if (!email || !window.confirm(`Enviar un correu per restablir la contrasenya a ${email}?`)) return;
    reset.disabled = true;
    try {
      await sendManagedUserPasswordReset(email);
      window.alert("S’ha enviat el correu per restablir la contrasenya.");
    } catch (error) {
      window.alert(getUserAdminError(error));
    } finally {
      reset.disabled = false;
    }
  }
}, true);

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-create-managed-user]");
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  setMessage("Creant o completant l’accés...");
  try {
    const created = await createManagedUser({
      displayName: data.get("displayName"),
      email: data.get("email"),
      role: data.get("role"),
      temporaryPassword: data.get("temporaryPassword")
    });
    const password = data.get("temporaryPassword");
    const visibleUser = {
      id: created.uid,
      displayName: created.displayName,
      email: created.email,
      role: created.role,
      active: true
    };
    usersCache = [visibleUser, ...usersCache.filter((user) => user.id !== created.uid)]
      .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email), "ca"));
    root().innerHTML = renderView();
    setMessage(`${created.recoveredExistingAccount ? "Perfil completat" : "Accés creat"} per a ${created.displayName}. Contrasenya temporal: ${password}`);

    getManagedUsers().then((users) => {
      usersCache = users;
      if (document.querySelector(".user-admin-page")) root().innerHTML = renderView();
    }).catch((error) => console.warn("No s’ha pogut refrescar la llista d’usuaris:", error));
  } catch (error) {
    setMessage(getUserAdminError(error), true);
    button.disabled = false;
  }
}, true);

window.addEventListener("travelflow:user-ready", enableSettingsNavigation);
const observer = new MutationObserver(enableSettingsNavigation);
observer.observe(document.body, { childList: true, subtree: true });
enableSettingsNavigation();
