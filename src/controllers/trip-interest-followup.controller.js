import { suspendLeadsWaitingForTripDates } from "../services/trip-interest-followup.service.js";

let running = false;
let scheduled = false;

async function syncPendingTripDates() {
  if (running) {
    scheduled = true;
    return;
  }

  running = true;
  try {
    const affected = await suspendLeadsWaitingForTripDates();
    if (affected > 0) {
      window.dispatchEvent(new CustomEvent("travelflow:undated-trip-leads-updated", {
        detail: { affected }
      }));
    }
  } catch (error) {
    console.error("No s'han pogut sincronitzar els leads de viatges sense dates:", error);
  } finally {
    running = false;
    if (scheduled) {
      scheduled = false;
      window.setTimeout(syncPendingTripDates, 100);
    }
  }
}

window.addEventListener("travelflow:user-ready", syncPendingTripDates);
window.addEventListener("travelflow:lead-created", syncPendingTripDates);
window.addEventListener("travelflow:tasks-updated", syncPendingTripDates);

syncPendingTripDates();
