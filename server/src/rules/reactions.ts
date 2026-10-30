/**
 * Side effects that follow from other changes, declared once instead of
 * being called by hand at the end of handlers.
 *
 * Order matters and is checked below: a reaction may only watch tables that
 * the action or an EARLIER reaction writes, so one ordered pass reaches a
 * fixed point (no reaction needs to run twice).
 */
export const REACTIONS = {
  cash: {
    rule: 'WF-002',
    says: 'Allocate free cash to the oldest outstanding charges (ACC-003)',
    trigger:
      'the action is a WF-002 occasion (its rule names an account to allocate on)',
    watches: [] as readonly string[],
    writes: ['payment_allocations'],
  },
  points: {
    rule: 'REW-001 / REW-002 / REW-003',
    says: 'Recompute locked, earned and clawback points for every touched account',
    trigger: 'any table that entitlement or qualifying cash depends on changed',
    watches: [
      'order_lines',
      'approvals',
      'cancellations',
      'return_lines',
      'payment_allocations',
      'reward_redemptions',
      'payment_transfers',
    ] as readonly string[],
    writes: ['reward_ledger'],
  },
} as const;

/** Fails fast at startup if a reaction watches a table a later one writes. */
export function assertReactionOrder() {
  const ordered = Object.entries(REACTIONS);
  ordered.forEach(([name, reaction], index) => {
    for (const [later, next] of ordered.slice(index + 1))
      for (const table of next.writes)
        if (reaction.watches.includes(table))
          throw new Error(
            `Reaction ${name} watches ${table}, which later reaction ${later} writes`,
          );
  });
}
assertReactionOrder();
