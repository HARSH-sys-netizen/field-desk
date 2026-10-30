import type { Allows, Guard, StatesOf } from './rule.js';

/**
 * Named conditions. Each one cites the canonical rule it enforces, says in
 * plain English what must be true, and names the states it leaves possible.
 */
const guard = (g: Guard) => g;

type OrderStatus = StatesOf<'order'>;
type ShipmentStatus = StatesOf<'shipment'>;

export const orderIs = (
  statuses: readonly OrderStatus[],
  rule: string,
  message: string,
) =>
  guard({
    rule,
    says: `The order is ${statuses.map((s) => s.toLowerCase().replaceAll('_', ' ')).join(' or ')}`,
    allows: { order: statuses },
    holds: (f) => statuses.includes(f.order()?.status as OrderStatus),
    otherwise: { code: 'ORDER_STATE', message },
  });

export const reviewsCurrentRevision = (message: string) =>
  guard({
    rule: 'ORD-005',
    says: 'The decision names the current revision',
    holds: (f) => f.payload.revision === f.order()?.current_revision,
    otherwise: { code: 'REVISION_CONFLICT', message },
  });

export const notDispatched = guard({
  rule: 'ORD-003',
  says: 'Nothing has been dispatched yet',
  holds: (f) => !f.orderHasDispatch(),
  otherwise: {
    code: 'ORDER_DISPATCHED',
    message: 'Dispatched orders require an authorized shipment correction',
  },
});

export const notCancelled = guard({
  rule: 'ORD-003',
  says: 'Nothing has been cancelled',
  allows: {
    order: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'REAPPROVAL_REQUIRED'],
  },
  holds: (f) => f.order()?.status !== 'CANCELLED' && !f.orderHasCancellation(),
  otherwise: {
    code: 'ORDER_CANCELLED',
    message: 'Canceled quantities cannot be edited',
  },
});

export const hasDispatch = guard({
  rule: 'WF-004',
  says: 'The order already has a dispatch',
  holds: (f) => f.orderHasDispatch(),
  otherwise: {
    code: 'ORDER_NOT_DISPATCHED',
    message: 'Use an ordinary commercial edit before dispatch',
  },
});

export const currentRevisionApproved = (message: string) =>
  guard({
    rule: 'FUL-003',
    says: "The order's current revision is approved",
    allows: { order: ['APPROVED'] },
    holds: (f) =>
      f.order()?.status === 'APPROVED' && f.currentRevisionApproved(),
    otherwise: { code: 'APPROVAL_REQUIRED', message },
  });

export const loadingNamesCurrentRevision = guard({
  rule: 'FUL-003',
  says: 'The loading document names the current revision',
  holds: (f) => f.shipment()?.revision === f.order()?.current_revision,
  otherwise: {
    code: 'APPROVAL_REQUIRED',
    message: 'The loading document needs current approval',
  },
});

export const shipmentIs = (
  statuses: readonly ShipmentStatus[],
  message: string,
  rule: string,
) =>
  guard({
    rule,
    says: `The shipment is ${statuses.map((s) => s.toLowerCase()).join(' or ')}`,
    allows: { shipment: statuses },
    holds: (f) => statuses.includes(f.shipment()?.status as ShipmentStatus),
    otherwise: { code: 'SHIPMENT_STATE', message },
  });

export const targetIsAnotherCustomer = guard({
  rule: 'CUS-001',
  says: 'The payment moves to a different customer',
  holds: (f) => f.payload.targetCustomerId !== f.primaryCustomerId(),
  otherwise: {
    code: 'SAME_CUSTOMER',
    message: 'Choose a different customer to receive the payment',
  },
});

export const targetCustomerExists = guard({
  rule: 'CUS-001',
  says: 'The receiving customer exists',
  holds: (f) => f.customerExists(String(f.payload.targetCustomerId)),
  otherwise: { code: 'NOT_FOUND', message: 'Target customer not found' },
});

export const paymentBelongsToCustomer = guard({
  rule: 'CUS-001',
  says: 'The payment is recorded against this customer',
  holds: (f) => f.receiptOfCustomer(),
  otherwise: {
    code: 'RECEIPT_NOT_FOUND',
    message: 'Select a payment recorded against this customer',
  },
});

export const paymentNotMoved = guard({
  rule: 'ACC-002',
  says: 'The payment has not already been moved',
  allows: { receipt: ['FREE', 'ALLOCATED', 'FUNDS_CREDIT'] },
  holds: (f) => !f.receiptMoved(),
  otherwise: {
    code: 'RECEIPT_MOVED',
    message: 'This payment has already been moved to another customer',
  },
});

export const paymentFundsNoCredit = guard({
  rule: 'CRD-001',
  says: 'The payment does not fund a credit note',
  allows: { receipt: ['FREE', 'ALLOCATED'] },
  holds: (f) => !f.receiptFundsCredit(),
  otherwise: {
    code: 'RECEIPT_FUNDS_CREDIT',
    message:
      'This payment funds a credit note on this account; settle or refund that credit through Accounts before moving the payment',
  },
});

export const noClawbackPending = guard({
  rule: 'REW-004',
  says: 'No reward clawback is pending',
  allows: { points: ['CLEAR'] },
  holds: (f) => !f.clawbackPending(),
  otherwise: {
    code: 'POINTS_UNAVAILABLE',
    message: 'There are not enough available points',
  },
});

/** Merge the states several guards allow for one entity (intersection). */
export function allowedStates(guards: readonly Guard[]): Allows {
  const merged: Record<string, readonly string[]> = {};
  for (const g of guards)
    for (const [entity, states] of Object.entries(g.allows ?? {}) as Array<
      [string, readonly string[]]
    >)
      merged[entity] = merged[entity]
        ? merged[entity].filter((s) => states.includes(s))
        : states;
  return merged as Allows;
}
