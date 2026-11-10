import { randomUUID } from 'node:crypto';

const reservationLocks = new WeakMap();

function getReservationLock(queue) {
  return reservationLocks.get(queue) || Promise.resolve();
}

/**
 * Atomically check and reserve the global startup slot for task execution.
 *
 * Queue consumer and Telegram direct starts share serialization because
 * overlapping admissions can both pass resource checks before the first
 * detached process is visible to process scanning.
 *
 * @param {Object} queue - SolveQueue-like object.
 * @param {Object} options - Same options as queue.canStartCommand().
 * @returns {Promise<Object>} canStartCommand() result plus reservation fields.
 */
export async function reserveStartSlotForQueue(queue, options = {}) {
  const previousReservation = getReservationLock(queue);
  let releaseReservation;
  reservationLocks.set(
    queue,
    new Promise(resolve => {
      releaseReservation = resolve;
    })
  );

  await previousReservation.catch(() => {});

  try {
    const check = await queue.canStartCommand(options);
    if (!check.canStart) {
      return { ...check, startReserved: false };
    }

    const reservedStartTime = queue.recordStart(options.tool || 'claude');
    // Reserve work as well as time: a zero minimum interval must still honor
    // one-at-a-time limits while a detached launch is not observable yet.
    const id = randomUUID();
    queue.startReservations.set(id, { id, tool: options.tool || 'claude', url: options.url || null, sessionName: id, startTime: new Date(reservedStartTime), status: 'starting' });
    return { ...check, startReserved: true, reservedStartTime, releaseStartReservation: () => queue.startReservations.delete(id) };
  } finally {
    releaseReservation();
  }
}
