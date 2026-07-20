const STATUS_CLASS_BY_LABEL = new Map([
  ["Nou", "lead-status--new"],
  ["Informació enviada", "lead-status--info-sent"],
  ["En seguiment", "lead-status--follow-up"],
  ["Ha contestat", "lead-status--replied"],
  ["Pendent de decisió", "lead-status--pending-decision"],
  ["Reserva confirmada", "lead-status--booking-confirmed"],
  ["Contactar més endavant", "lead-status--contact-later"],
  ["Perdut", "lead-status--lost"]
]);

const STATUS_CLASSES = [...STATUS_CLASS_BY_LABEL.values(), "lead-status--unknown"];

function decorateLeadStatus(element) {
  if (!(element instanceof HTMLElement)) return;

  const label = element.textContent?.trim() || "";
  const statusClass = STATUS_CLASS_BY_LABEL.get(label) || "lead-status--unknown";

  element.classList.remove(...STATUS_CLASSES);
  element.classList.add(statusClass);
}

function decorateLeadStatuses(root = document) {
  root.querySelectorAll?.(".lead-status").forEach(decorateLeadStatus);
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(".lead-status")) decorateLeadStatus(node);
      decorateLeadStatuses(node);
    });
  });
});

function startLeadStatusUi() {
  decorateLeadStatuses();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startLeadStatusUi, { once: true });
} else {
  startLeadStatusUi();
}
