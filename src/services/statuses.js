export const STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
  PICKED_UP: 'picked_up',      // handed over, but before the specified start date
  ACTIVE: 'active',            // the specified rental window (start date -> end date) is underway
  OVERDUE: 'overdue',
  RETURN_CLAIMED: 'return_claimed',
  RETURNED: 'returned',
  DISPUTED: 'disputed',
  COMPLETED: 'completed',
});

export const ALL_STATUSES = Object.values(STATUS);

// Statuses that BLOCK the equipment's dates. Everything else frees them.
// PICKED_UP blocks too: the equipment is already physically with the renter,
// whether or not the official rental window has started yet.
export const BLOCKING_STATUSES = [STATUS.PICKED_UP, STATUS.APPROVED, STATUS.ACTIVE, STATUS.OVERDUE, STATUS.RETURN_CLAIMED, STATUS.DISPUTED];

export const TERMINAL_STATUSES = [STATUS.REJECTED, STATUS.CANCELLED, STATUS.NO_SHOW, STATUS.COMPLETED];
