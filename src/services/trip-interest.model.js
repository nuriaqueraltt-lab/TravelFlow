export const TRIP_INTEREST_TERMINAL_STATUSES = new Set(["BOOKING_CONFIRMED", "LOST"]);

export function getTripInterestStatus(lead, tripId) {
  const stored = lead?.tripInterests?.[tripId]?.status;
  if (stored) return stored;
  if ((lead?.bookingTripId || "") === tripId) return "BOOKING_CONFIRMED";
  if (lead?.status === "LOST" && (lead?.tripIds || []).length === 1) return "LOST";
  return lead?.status === "BOOKING_CONFIRMED" ? "FOLLOW_UP" : lead?.status || "NEW";
}

export function buildTripInterests(lead = {}, tripIds = [], tripLabels = [], suppliedStatuses = {}) {
  return tripIds.reduce((result, tripId, index) => {
    const previous = lead.tripInterests?.[tripId] || {};
    result[tripId] = {
      ...previous,
      tripName: tripLabels[index] || previous.tripName || "Viatge",
      status: suppliedStatuses[tripId] || getTripInterestStatus(lead, tripId)
    };
    return result;
  }, {});
}

export function hasActiveTripInterests(lead) {
  return (lead?.tripIds || []).some((tripId) => !TRIP_INTEREST_TERMINAL_STATUSES.has(getTripInterestStatus(lead, tripId)));
}

export function isBookedForTrip(lead, tripId) {
  return getTripInterestStatus(lead, tripId) === "BOOKING_CONFIRMED";
}

export function hasBookedTrip(lead) {
  return (lead?.tripIds || []).some((tripId) => isBookedForTrip(lead, tripId));
}

export function compatibleLeadStatus(lead, nextStatus) {
  return hasBookedTrip(lead) ? "BOOKING_CONFIRMED" : nextStatus;
}
