function enhanceLoginExperience(root = document) {
  const login = root.querySelector?.(".login-page");
  if (!login || login.dataset.experienceReady === "true") return;

  login.dataset.experienceReady = "true";

  const eyebrow = login.querySelector(".login-visual__eyebrow");
  const title = login.querySelector(".login-visual__content h1");
  const description = login.querySelector(".login-visual__content p");
  const insightLabel = login.querySelector(".login-visual__insight span");
  const insightValue = login.querySelector(".login-visual__insight strong");
  const panelKicker = login.querySelector(".login-panel__heading .section-kicker");
  const panelTitle = login.querySelector(".login-panel__heading h2");
  const panelDescription = login.querySelector(".login-panel__heading p");

  if (eyebrow) eyebrow.textContent = "CRM intern · Dones i Viatgeres";
  if (title) title.textContent = "Cada conversa pot convertir-se en una nova viatgera.";
  if (description) {
    description.textContent = "Centralitza els leads, organitza els seguiments i transforma l'interès en reserves sense perdre cap oportunitat pel camí.";
  }
  if (insightLabel) insightLabel.textContent = "Activitat comercial protegida";
  if (insightValue) insightValue.textContent = "Les dades reals es carreguen en iniciar sessió";
  if (panelKicker) panelKicker.textContent = "Espai privat de l'equip";
  if (panelTitle) panelTitle.textContent = "Accedeix a TravelFlow";
  if (panelDescription) panelDescription.textContent = "Gestiona leads, tasques, viatges i decisions comercials des d'un únic lloc.";
}

const observer = new MutationObserver(() => enhanceLoginExperience());
observer.observe(document.body, { childList: true, subtree: true });
enhanceLoginExperience();
