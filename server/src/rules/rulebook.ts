import { rulebook } from './rule.js';
import {
  currentRevisionApproved,
  hasDispatch,
  loadingNamesCurrentRevision,
  noClawbackPending,
  notCancelled,
  notDispatched,
  orderIs,
  paymentBelongsToCustomer,
  paymentFundsNoCredit,
  paymentNotMoved,
  reviewsCurrentRevision,
  shipmentIs,
  targetCustomerExists,
  targetIsAnotherCustomer,
} from './guards.js';

/**
 * The FieldDesk rulebook (business terms 2026-10-26.1).
 *
 * One entry per action. Read it as:
 *   <who> may <does> when <each condition holds>; afterwards <allocates>.
 * Admin may do everything. Quantity and amount limits (ACC-001, CRD-001,
 * FUL-001, …) live in the domain models and are cited per action.
 * `pnpm rules:report` renders this file as docs/solution/rulebook.md.
 */
export const RULEBOOK = rulebook({
  // ── Customers ──────────────────────────────────────────────────────────
  UPDATE_CUSTOMER: {
    area: 'Customers',
    does: "Change a customer's name or code",
    who: ['SALES', 'ACCOUNTS'],
    when: [],
    reads: [],
    cites: ['CUS-001'],
  },

  // ── Orders: commercial lifecycle (ORD-005) ─────────────────────────────
  PUNCH_ORDER: {
    area: 'Orders',
    does: 'Create a draft order at agreed prices',
    who: ['SALES'],
    when: [],
    reads: [],
    cites: ['CAT-002', 'ORD-005'],
  },
  EDIT_ORDER: {
    area: 'Orders',
    does: 'Replace the order terms with a new revision',
    who: ['SALES'],
    when: [notDispatched, notCancelled],
    reads: ['order'],
    cites: ['ORD-003', 'ORD-005', 'ORD-006'],
  },
  SUBMIT_ORDER: {
    area: 'Orders',
    does: 'Send the current revision for approval',
    who: ['SALES'],
    when: [
      orderIs(
        ['DRAFT', 'REJECTED', 'REAPPROVAL_REQUIRED'],
        'ORD-005',
        'This order is not awaiting submission',
      ),
    ],
    reads: ['order'],
    cites: ['ORD-005'],
  },
  APPROVE_ORDER: {
    area: 'Orders',
    does: 'Approve the exact current revision',
    who: ['KAM'],
    when: [
      orderIs(
        ['PENDING', 'REAPPROVAL_REQUIRED'],
        'ORD-005',
        'Submit the current revision for approval first',
      ),
      reviewsCurrentRevision('Approve the current commercial revision'),
    ],
    reads: ['order'],
    cites: ['ORD-005', 'REW-001'],
  },
  REJECT_ORDER: {
    area: 'Orders',
    does: 'Reject the exact current revision, with a reason',
    who: ['KAM'],
    when: [
      orderIs(
        ['PENDING', 'REAPPROVAL_REQUIRED'],
        'ORD-005',
        'The order is not awaiting approval',
      ),
      reviewsCurrentRevision('Review the current commercial revision'),
    ],
    reads: ['order'],
    cites: ['ORD-005'],
  },
  CANCEL_REMAINDER: {
    area: 'Orders',
    does: 'Cancel selected or all unshipped units, with a reason',
    who: ['SALES'],
    when: [],
    reads: ['order'],
    cites: ['ORD-001', 'ORD-004', 'ORD-005', 'ORD-006'],
  },

  // ── Fulfillment (FUL-003…006) ──────────────────────────────────────────
  START_LOADING: {
    area: 'Fulfillment',
    does: 'Reserve open units in a new loading batch',
    who: ['WAREHOUSE'],
    when: [currentRevisionApproved('The current revision needs approval')],
    reads: ['order'],
    cites: ['FUL-003', 'FUL-004', 'ORD-001'],
  },
  DISPATCH_SHIPMENT: {
    area: 'Fulfillment',
    does: 'Confirm the whole loading batch left the warehouse',
    who: ['WAREHOUSE'],
    when: [
      shipmentIs(['LOADING'], 'Select a shipment that is loading', 'FUL-005'),
      currentRevisionApproved('The loading document needs current approval'),
      loadingNamesCurrentRevision,
    ],
    reads: ['order', 'shipment'],
    cites: ['FUL-003', 'FUL-005'],
  },
  CONFIRM_DELIVERY: {
    area: 'Fulfillment',
    does: 'Confirm dispatched units the customer received',
    who: ['WAREHOUSE'],
    when: [
      shipmentIs(
        ['DISPATCHED'],
        'Select an open dispatched shipment',
        'FUL-006',
      ),
    ],
    reads: ['shipment'],
    allocates: 'own account',
    cites: ['FUL-001', 'FUL-006', 'WF-005', 'WF-002'],
  },
  CORRECT_DELIVERY: {
    area: 'Fulfillment',
    does: 'Lower an overstated delivery confirmation (FDSK-170)',
    who: ['KAM'],
    when: [
      shipmentIs(
        ['DISPATCHED', 'DELIVERED'],
        'Select a dispatched shipment of this order',
        'FUL-006',
      ),
    ],
    reads: ['shipment', 'charge'],
    allocates: 'own account',
    cites: ['FUL-001', 'WF-001', 'WF-005', 'WF-003', 'WF-002'],
  },
  RECORD_RETURN: {
    area: 'Fulfillment',
    does: 'Receive delivered units back, with an explicit deduction',
    who: ['WAREHOUSE'],
    when: [],
    reads: ['shipment', 'charge'],
    allocates: 'own account',
    cites: ['RET-001', 'RET-002', 'WF-003', 'WF-002'],
  },
  CORRECT_DISPATCHED_ORDER: {
    area: 'Fulfillment',
    does: 'Record authorized additional goods that were dispatched',
    who: ['KAM'],
    when: [hasDispatch],
    reads: ['order', 'shipment'],
    allocates: 'own account',
    cites: ['WF-004', 'WF-005', 'ORD-006', 'WF-002'],
  },

  // ── Accounts (ACC-001…003) ──────────────────────────────────────────────
  RECEIVE_CUSTOMER_PAYMENT: {
    area: 'Accounts',
    does: 'Record money received from a customer',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['charge'],
    allocates: 'own account',
    cites: ['ACC-002', 'ACC-003', 'WF-002'],
  },
  ALLOCATE_PAYMENT: {
    area: 'Accounts',
    does: 'Apply free cash to the oldest outstanding charges',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['receipt', 'charge'],
    allocates: 'own account',
    cites: ['ACC-003', 'WF-002'],
  },
  MOVE_CUSTOMER_PAYMENT: {
    area: 'Accounts',
    does: 'Move a payment recorded against the wrong customer (FDSK-169)',
    who: ['ACCOUNTS'],
    when: [
      targetIsAnotherCustomer,
      targetCustomerExists,
      paymentBelongsToCustomer,
      paymentNotMoved,
      paymentFundsNoCredit,
    ],
    reads: ['receipt', 'charge', 'points'],
    allocates: 'receiving account',
    cites: ['CUS-001', 'ACC-002', 'WF-001', 'WF-002', 'REW-003'],
  },

  // ── Credits (CRD-001…006) ───────────────────────────────────────────────
  ISSUE_CREDIT_NOTE: {
    area: 'Credits',
    does: 'Reserve free cash as explicit customer credit',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['receipt'],
    cites: ['CRD-001', 'CRD-002', 'CRD-006'],
  },
  APPLY_CREDIT_NOTE: {
    area: 'Credits',
    does: 'Settle a selected charge with credit',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['creditNote', 'charge'],
    cites: ['CRD-001', 'CRD-003', 'ACC-001'],
  },
  REFUND_CREDIT_NOTE: {
    area: 'Credits',
    does: 'Record a payout from open credit, with a bank reference',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['creditNote'],
    cites: ['CRD-001', 'CRD-004'],
  },
  REVERSE_CREDIT_APPLICATION: {
    area: 'Credits',
    does: 'Undo part of a recorded credit application',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['creditNote', 'charge'],
    cites: ['CRD-005', 'CRD-006'],
  },
  REVERSE_CREDIT_REFUND: {
    area: 'Credits',
    does: 'Undo part of a recorded refund',
    who: ['ACCOUNTS'],
    when: [],
    reads: ['creditNote'],
    cites: ['CRD-005', 'CRD-006'],
  },

  // ── Rewards (REW-001…004) ───────────────────────────────────────────────
  REDEEM_POINTS: {
    area: 'Rewards',
    does: 'Settle a selected charge with available points',
    who: ['SALES', 'ACCOUNTS'],
    when: [noClawbackPending],
    reads: ['charge', 'points'],
    cites: ['REW-003', 'REW-004'],
  },
});
