# Architecture — first draft

Stage 1 of 4. Written after reading the assignment PDF and the business walkthrough, before reading the backend code in depth. Kept as written; later stages say what changed and why.

## What I think the problem is

Every command (`PUNCH_ORDER`, `CONFIRM_DELIVERY`, `RECORD_RETURN`, …) is a hand-written service method that mixes four different kinds of logic:

1. **Who** may run it (role checks).
2. **When** it is allowed (order status, shipment status, quantities left).
3. **What** it writes (the actual mutation).
4. **What else must change because of it** (cash allocation, reward points, credit notes).

Because 2 and 4 are spread across methods, the number of `if` branches grows with `actors × actions × states`, and a rule change (for example "also allocate cash after X") becomes a hunt through every service.

## First idea: a generic when/then rules engine

Inspired by Drools:

```
rule "Loading needs approval"
  when  action = START_LOADING and order.status != APPROVED
  then  reject APPROVAL_REQUIRED
```

- A `Rule` = `{ id, when(ctx) → boolean, then(ctx) → mutations }`.
- An engine loads `(action, payload, current state)`, fires all matching rules, collects mutations or questions, and commits them.
- Every table becomes a state machine (`orders.status`, `shipments.status`) with an explicit transition table, so an action can never move an entity into an undefined state.
- Side effects (points, ledgers) become rules that fire when the tables they depend on change.

## Draft module layout

```
server/src/rules/
  engine.ts        # evaluate rules, collect mutations, commit
  rules/*.ts       # one file per canonical rule (ORD-005, FUL-005, …)
  state-machines/  # order, shipment transition tables
```

## The two features (first guess)

- **FDSK-169 — move a payment to the right customer.** Change `customer_id` on the receipt and re-run allocation for both customers.
- **FDSK-170 — correct an overstated delivery.** Lower the delivered quantity and the matching charge, and put the shipment back to `DISPATCHED`.

## Open questions

- How much of the current code already behaves like a rules layer?
- Is a full forward-chaining engine justified for ~22 actions?
- Is changing `customer_id` in place allowed by the history rules?
