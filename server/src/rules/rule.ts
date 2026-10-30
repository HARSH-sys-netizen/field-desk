import type { CommandType } from '@crm/shared/crm';
import type { Role } from '@crm/shared';

/**
 * Vocabulary of the rulebook. A rule says, for one action:
 *   WHO may do it, WHEN it is allowed (named guards, checked in order),
 *   WHAT it reads (for scenario counting), and WHAT FOLLOWS (reactions).
 * The handler that writes the records stays in the owning domain service.
 */

/** Entities whose states drive branching, and the states they can be in. */
export const ENTITY_STATES = {
  order: [
    'DRAFT',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'REAPPROVAL_REQUIRED',
    'CANCELLED',
  ],
  shipment: ['LOADING', 'DISPATCHED', 'DELIVERED', 'VOIDED'],
  receipt: ['FREE', 'ALLOCATED', 'FUNDS_CREDIT', 'MOVED'],
  charge: ['OUTSTANDING', 'SETTLED'],
  creditNote: ['OPEN', 'USED_UP'],
  points: ['CLEAR', 'CLAWBACK_PENDING'],
} as const;
export type Entity = keyof typeof ENTITY_STATES;
export type StatesOf<E extends Entity> = (typeof ENTITY_STATES)[E][number];
export type Allows = { [E in Entity]?: readonly StatesOf<E>[] };

/** Read-only view of the current state that guards evaluate. */
export interface Facts {
  readonly payload: Readonly<Record<string, unknown>>;
  order(): { status: string; current_revision: number } | undefined;
  currentRevisionApproved(): boolean;
  shipment(): { status: string; revision: number } | undefined;
  orderHasDispatch(): boolean;
  orderHasCancellation(): boolean;
  customerExists(id: string): boolean;
  primaryCustomerId(): string;
  receiptOfCustomer(): boolean;
  receiptMoved(): boolean;
  receiptFundsCredit(): boolean;
  clawbackPending(): boolean;
}

export interface Guard {
  /** Canonical rule this guard enforces, e.g. FUL-003. */
  rule: string;
  /** Plain-English condition, readable by a non-engineer. */
  says: string;
  /** States this guard leaves possible (used to count scenarios). */
  allows?: Allows;
  holds(facts: Facts): boolean;
  otherwise: { code: string; message: string };
}

export interface Rule {
  /** What the action is for, in business words. */
  does: string;
  /** Roles besides Admin, who can perform every action. */
  who: readonly Role[];
  /** Conditions checked in order; the first that fails rejects the action. */
  when: readonly Guard[];
  /** Entities whose state the action's validity depends on. */
  reads: readonly Entity[];
  /** WF-002 occasion: allocate free cash afterwards, on this account. */
  allocates?: 'own account' | 'receiving account';
  /** Canonical rules the action implements. */
  cites: readonly string[];
}

export type Rulebook = { readonly [T in CommandType]: Rule };

export const rulebook = (rules: Rulebook): Rulebook => rules;
