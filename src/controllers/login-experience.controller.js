const BRAND_LOGO_URL = "https://donesiviatgeres.com/wp-content/uploads/2024/10/cropped-Logo-Ventura-Tours.png";

function renderOfficialBrand() {
  return `
    <img class="login-brand-logo" src="${BRAND_LOGO_URL}" alt="Dones i Viatgeres" />
    <div class="login-brand-copy">
      <strong>TravelFlow</strong>
      <span>CRM intern · Dones i Viatgeres</span>
    </div>
  `;
}

function enhanceLoginExperience(root = document) {
  const login = root.querySelector?.(".login-page");
  if (!login || login.dataset.experienceReady === "true") return;

  login.dataset.experienceReady = "true";

  login.querySelectorAll(".login-visual__brand, .login-panel__mobile-brand").forEach((brand) => {
    brand.innerHTML = renderOfficialBrand();
  });

  const eyebrow = login.querySelector(".login-visual__eyebrow");
  const title = login.querySelector(".login-visual__content h1");
  const description = login.querySelector(".login-visual__content p");
  const insightIcon = login.querySelector(".login-visual__insight-icon");
  const insightLabel = login.querySelector(".login-visual__insight span");
  const insightValue = login.querySelector(".login-visual__insight strong");
  const panelKicker = login.querySelector(".login-panel__heading .section-kicker");
  const panelTitle = login.querySelector(".login-panel__heading h2");
  const panelDescription = login.querySelector(".login-panel__heading p");

  if (eyebrow) eyebrow.textContent = "Gestió comercial amb ànima viatgera";
  if (title) title.textContent = "Potser avui comença el viatge més especial d’algú.";
  if (description) {
    description.textContent = "Darrere de cada consulta hi ha una dona amb ganes de descobrir el món. Cuida cada conversa, acompanya cada il·lusió i ajuda-la a fer el primer pas.";
  }
  if (insightIcon) insightIcon.textContent = "✦";
  if (insightLabel) insightLabel.textContent = "Una frase per començar el dia";
  if (insightValue) insightValue.textContent = "Mai és tard per descobrir un lloc nou... ni una nova versió de tu mateixa.";
  if (panelKicker) panelKicker.textContent = "Espai privat de l’equip";
  if (panelTitle) panelTitle.textContent = "Accedeix a TravelFlow";
  if (panelDescription) panelDescription.textContent = "Tot el que necessites per cuidar cada futura viatgera, en un únic lloc.";
}

const observer = new MutationObserver(() => enhanceLoginExperience());
observer.observe(document.body, { childList: true, subtree: true });
enhanceLoginExperience();