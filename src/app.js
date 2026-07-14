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
          <div>
            <strong>TravelFlow</strong>
            <span>Dones i Viatgeres</span>
          </div>
        </header>

        <div class="login-visual__content">
          <span class="login-visual__eyebrow">Gestió comercial amb ànima viatgera</span>
          <h1>Cap futura viatgera sense resposta.</h1>
          <p>
            Centralitza els leads, prioritza els seguiments i acompanya cada
            persona des del primer missatge fins a la reserva.
          </p>
        </div>

        <div class="login-visual__insight">
          <div class="login-visual__insight-icon" aria-hidden="true">✦</div>
          <div>
            <span>La teva prioritat d'avui</span>
            <strong>3 viatgeres esperen seguiment</strong>
          </div>
        </div>
      </section>

      <section class="login-panel">
        <div class="login-panel__inner">
          <div class="login-panel__mobile-brand">
            ${renderBrandMark()}
            <div>
              <strong>TravelFlow</strong>
              <span>Dones i Viatgeres</span>
            </div>
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16v12H4z" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
                <input
                  type="email"
                  name="email"
                  autocomplete="email"
                  placeholder="nom@donesiviatgeres.com"
                  required
                />
              </div>
            </label>

            <label class="form-field">
              <span>Contrasenya</span>
              <div class="form-control">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <input
                  id="passwordInput"
                  type="password"
                  name="password"
                  autocomplete="current-password"
                  placeholder="Introdueix la teva contrasenya"
                  required
                />
                <button
                  class="password-toggle"
                  id="passwordToggle"
                  type="button"
                  aria-label="Mostrar la contrasenya"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                </button>
              </div>
            </label>

            <div class="login-form__options">
              <label class="checkbox-field">
                <input type="checkbox" name="remember" />
                <span>Recorda'm</span>
              </label>
              <button class="link-button" type="button">He oblidat la contrasenya</button>
            </div>

            <button class="primary-button" type="submit">
              <span>Entrar a TravelFlow</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m14 7 5 5-5 5" />
              </svg>
            </button>

            <p class="login-form__message" id="loginMessage" role="status"></p>
          </form>

          <footer class="login-panel__footer">
            <span>Ús intern de Dones i Viatgeres</span>
            <span>TravelFlow · 2026</span>
          </footer>
        </div>
      </section>
    </main>
  `;
}

function setupLoginInteractions() {
  const form = document.querySelector("#loginForm");
  const passwordInput = document.querySelector("#passwordInput");
  const passwordToggle = document.querySelector("#passwordToggle");
  const message = document.querySelector("#loginMessage");

  passwordToggle?.addEventListener("click", () => {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    passwordToggle.setAttribute(
      "aria-label",
      shouldShow ? "Amagar la contrasenya" : "Mostrar la contrasenya"
    );
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    message.textContent = "Pantalla preparada. Connectarem Firebase al següent pas.";
  });
}

function bootstrap() {
  const appRoot = document.querySelector("#app");

  if (!appRoot) {
    throw new Error("No s'ha trobat el contenidor principal de TravelFlow.");
  }

  appRoot.innerHTML = renderLoginView();
  setupLoginInteractions();
}

bootstrap();