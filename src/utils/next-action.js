export const TERMINAL_LEAD_STATUSES = new Set(["LOST", "BOOKING_CONFIRMED"]);

function taskMillis(task) {
  if (!task?.dueAt) return Number.POSITIVE_INFINITY;
  if (typeof task.dueAt.toMillis === "function") return task.dueAt.toMillis();
  if (typeof task.dueAt.toDate === "function") return task.dueAt.toDate().getTime();
  const value = new Date(task.dueAt).getTime();
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function getNextPendingTask(tasks = [], leadStatus = "") {
  if (TERMINAL_LEAD_STATUSES.has(leadStatus)) return null;
  return tasks
    .filter((task) => task?.status === "PENDING")
    .sort((a, b) => taskMillis(a) - taskMillis(b))[0] || null;
}

export function getNextActionView(tasks = [], leadStatus = "") {
  const task = getNextPendingTask(tasks, leadStatus);
  return {
    task,
    title: task?.title || "Sense acció",
    dueAt: task?.dueAt || null
  };
}
