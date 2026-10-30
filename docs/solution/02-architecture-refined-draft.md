# Architecture — refined draft

Stage 2 of 4. Written after running the app and its 251 API tests and reading every backend service. It corrects the first draft.

## What the code actually does well

The sample app is not spaghetti. It already has:

| Concern                                      | Where it lives today                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Transaction, idempotency, version check      | `ActionsService.execute` — one boundary for every command                             |
| Value invariants (ACC-001, CRD-001, FUL-001) | Small models: `ChargeBalance`, `CreditBalance`, `ShipmentQuantity`, `ReturnQuantity`  |
| Post-commit invariant review                 | `AuditService.review` — every command is rolled back if any account check fails       |
| History (WF-001)                             | Append-only rows; negative rows linked by `adjusts_id` / `reversal_of_id`             |
| Ambiguity questions (7.2)                    | `DomainDecision` → `NEEDS_DECISION` with options (used by `CORRECT_DISPATCHED_ORDER`) |

So the first draft's "build an engine that evaluates every rule" would duplicate things that already work. The _state reconciliation engine_ hint from the brief already exists in embryo: `(action, payload, state) → effects | decisions`.

## Where the explosion really is

Measured by reading the services:

1. **Hard-wired reactions.** WF-002 (cash allocation) and REW-002 (points) are invoked by hand at the end of handlers: `allocateCash` + `refresh` appear in 5 handlers, `refresh` alone in one more. Adding an allocation occasion means editing a service; forgetting one is a silent bug.
2. **Scattered permissions.** 21 `authorize(c, …)` calls, one per handler. The roles table in `business_terms.md` and the code can drift.
3. **Scattered state gates.** Order/shipment status checks are inline `if`s in each handler, with slightly different messages.
4. **Duplicated balance arithmetic.** `retained − cash − credit − points` is recomputed in four places (allocation, redemption, credit application, summary).
5. **Settlement release exists only inside returns.** WF-003's "release cash, then credit, then points" is ~120 lines inside `ReturnsService`; FDSK-170 needs the same release.
6. **One customer per action.** `ActionsService` bumps the version and runs the review for `c.customerId` only. FDSK-169 touches two customers.

## Refined plan

Keep the boundary and models; add a thin declarative layer where the explosion is:

- **Rulebook** — one declaration per action: who, when (named guards), cited rule IDs, reactions. Enforced by the action boundary, not by each handler.
- **Reactions** — WF-002 and reward refresh declared once, triggered by the action's occasion or by the tables its effects touched.
- **Settlement primitives** — one `release(charge, amount)` used by returns, delivery correction and payment moves.
- **Multi-account actions** — the boundary versions and reviews every customer an action touches.

## FDSK-169 and FDSK-170, revised

- Changing `receipts.customer_id` in place breaks WF-001 (history) and makes the old customer's past balances unexplainable. Use a **receipt transfer**: reverse the source customer's allocations, close the receipt's capacity with a transfer record, open a linked receipt on the target customer, then allocate.
- Lowering the delivery row in place has the same problem. Use a **linked negative delivery** that reverses part of the original confirmation; WF-005 then naturally produces one negative charge adjustment per corrective fact.
