/**
 * Stable error codes shared by the host half, the client half and the docs.
 * Keep this list in sync with docs/mvp-plan.md §4.3.
 */
export const ERROR_CODES = Object.freeze({
  depMissing: 'E_DEP_MISSING',
  depVersion: 'E_DEP_VERSION',
  tokenRequired: 'E_TOKEN_REQUIRED',
  keyRequired: 'E_KEY_REQUIRED',
  machineStopped: 'E_MACHINE_STOPPED',
  machineBusy: 'E_MACHINE_BUSY',
  approvalExpired: 'E_APPROVAL_EXPIRED',
  approvalReplay: 'E_APPROVAL_REPLAY',
  approvalUnknown: 'E_APPROVAL_UNKNOWN',
  hostDown: 'E_HOST_DOWN',
  botUnknown: 'E_BOT_UNKNOWN',
  queueFull: 'E_QUEUE_FULL',
  balanceLow: 'E_BALANCE_LOW',
  internal: 'E_INTERNAL',
})
