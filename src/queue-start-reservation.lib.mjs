const reservationLocks = new WeakMap();

function getReservationLock(queue) {
  return reservationLocks.get(queue) || Promise.resolve();
}

/**
 * Atomically check and reserve the global startup slot for direct execution.
 *
 * Queue consumer starts are naturally serialized. Telegram direct starts need
 * the same serialization because overlapping handlers can both pass resource
 * checks before the first detached process is visible to process scanning.
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
    return { ...check, startReserved: true, reservedStartTime };
  } finally {
    releaseReservation();
  }
}
