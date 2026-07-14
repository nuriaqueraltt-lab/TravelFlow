function renderWelcomeView() {
  return `
    <section class="welcome-page">
      <div class="welcome-card">
        <span class="welcome-eyebrow">Dones i Viatgeres</span>
        <h1>TravelFlow</h1>
        <p>
          El teu espai per gestionar leads, seguiments i futures viatgeres
          sense que se n'escapi cap.
        </p>
        <div class="welcome-status" role="status">
          <span class="welcome-status__dot" aria-hidden="true"></span>
          Base visual carregada correctament
        </div>
      </div>
    </section>
  `;
}

function bootstrap() {
  const appRoot = document.querySelector("#app");

  if (!appRoot) {
    throw new Error("No s'ha trobat el contenidor principal de TravelFlow.");
  }

  appRoot.innerHTML = renderWelcomeView();
}

bootstrap();
