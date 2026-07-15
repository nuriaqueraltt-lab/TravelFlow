import { deleteLeadCompletely, getLeadDeleteError } from "../services/lead-delete.service.js";
import { showLeadsView } from "./leads.controller.js";

function ensureDeleteButton() {
  const hero = document.querySelector(".lead-detail-hero");
  if (!hero || hero.querySelector("[data-delete-lead]")) return;

  const actions = document.createElement("div");
  actions.className = "lead-detail-hero__actions";

  const editButton = hero.querySelector("[data-edit-lead]");
  if (editButton) actions.appendChild(editButton);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "secondary-button lead-delete-button";
  deleteButton.dataset.deleteLead = "";
  deleteButton.textContent = "Eliminar lead";
  actions.appendChild(deleteButton);
  hero.appendChild(actions);
}

async function handleDelete(button) {
  const leadId = document.body.dataset.currentLeadId || "";
  const heading = document.querySelector(".lead-detail-hero h1")?.textContent?.trim() || "aquest lead";

  if (!leadId) {
    window.alert("No s'ha pogut identificar el lead.");
    return;
  }

  const confirmed = window.confirm(`Vols eliminar definitivament ${heading}?\n\nTambé s'eliminaran les seves tasques i activitats. Aquesta acció no es pot desfer.`);
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Eliminant...";

  try {
    await deleteLeadCompletely(leadId);
    document.body.removeAttribute("data-current-lead-id");
    window.dispatchEvent(new CustomEvent("travelflow:tasks-updated"));
    await showLeadsView();
  } catch (error) {
    console.error("No s'ha pogut eliminar el lead:", error);
    window.alert(getLeadDeleteError(error));
    button.disabled = false;
    button.textContent = "Eliminar lead";
  }
}

const observer = new MutationObserver(() => requestAnimationFrame(ensureDeleteButton));
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("click", (event) => {
  const row = event.target.closest("[data-lead-id]");
  if (row?.dataset.leadId) document.body.dataset.currentLeadId = row.dataset.leadId;

  if (event.target.closest("[data-back-to-leads]")) {
    document.body.removeAttribute("data-current-lead-id");
  }

  const button = event.target.closest("[data-delete-lead]");
  if (button) handleDelete(button);
});

ensureDeleteButton();
