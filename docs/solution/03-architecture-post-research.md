# Architecture — after research and LLM discussion

Stage 3 of 4. The refined draft was discussed with the coding agent (Claude) against the hints in the brief and well-known approaches. This stage records what each approach offers here, and what was adopted or rejected.

## Approaches considered

| Approach | What it gives | Fit for this repo | Decision |
| --- | --- | --- | --- |
| **Drools-style forward chaining** (Rete network, working memory, `when/then`) | Rules as data; non-engineers can read rules; engine finds which rules fire | ~23 actions, every action is already explicit. A Rete engine adds a runtime and debugging model for a problem whose rules are mostly *per action*. Fowler's warning applies: rule engines get hard to reason about once rules chain implicitly. | **Borrow the `when/then` vocabulary, not the engine.** Guards are named predicates with plain-English text; there is no inference loop over arbitrary facts. |
| **State machines per table** (XState-like transition tables) | Impossible transitions are unrepresentable | Order and shipment status are real state machines (ORD-005, FUL-004..006). Accounts, credits and rewards are *ledgers*: their "state" is derived from sums, not a status column. | **Use for statuses only**, as declared allowed-states on guards. Ledgers stay as invariants. |
| **Reactive modeling / dependency chains** | Points and allocation update as side effects of the facts they depend on | This is exactly the hard-wired `allocateCash` + `refresh` problem. The action already records which tables it wrote (`c.effects`). | **Adopt.** Reactions subscribe to occasions (WF-002 is defined as a list of occasions) or to touched tables (rewards depend on allocations, approvals, cancellations, returns, revisions). Runs inside the same transaction until no reaction writes anything new. |
| **Saga pattern** with compensating events | Atomicity across services/databases | One SQLite database, one immediate transaction per action. Compensation is already modelled as *business* history (negative rows), which a saga would duplicate. | **Reject** for this scale; note it as the path if modules split into services. |
| **Event sourcing** | Full history; projections rebuilt from events | The ledgers are already append-only and the audit trail stores payloads. A rewrite would be large and not shorten the rules. | **Reject.** Keep append-only ledgers. |
| **State reconciliation engine** `(action, payload, state) → mutations \| questions` | Ambiguity as first-class output | Already implemented by `DomainDecision`. | **Keep and reuse** for the new features where intent is ambiguous. |

## Design that comes out of this

```
                ┌──────────── Action boundary (ActionsService) ─────────────┐
 envelope ──▶   │ idempotency → version check → RULEBOOK[type]               │
                │   who  : roles                    (one table, all actions)│
                │   when : named guards (FUL-003…)  (state gates, in order) │
                │   then : domain handler            (services + models)    │
                │   react: WF-002 allocation, REW-002 points (fixed point)  │
                │ → per-customer version bump, audit event, invariant review│
                └────────────────────────────────────────────────────────────┘
```

- **Rulebook** (`server/src/rules/rulebook.ts`) — typed as `Record<CommandType, Rule>`, so a new command does not compile until it has rules.
- **Guards** (`server/src/rules/guards.ts`) — small named predicates. Each has a rule ID, plain-English text and, where it constrains a status, the allowed states (used to count scenarios).
- **Reactions** (`server/src/rules/reactions.ts`) — WF-002 and REW-002 declared once.
- **Generated rulebook** — a script renders the declarations into Markdown a non-engineer can read, and counts naive vs pruned scenarios from the same declarations.
- **Settlement primitives** — `release` implements WF-003's cash → credit → points order once.

## Two solutions (bonus deliverable)

- **Solution B — middle ground**: only the refactoring patterns (settlement primitives, receipt capacity in one place, multi-customer boundary) plus both features, with reactions still called explicitly. Branch `solution-b-middle-ground`.
- **Solution A — rulebook layer**: B plus the declarative rulebook, guards and reactions. Branch `main`.

## References

- Martin Fowler, *RulesEngine* — https://martinfowler.com/bliki/RulesEngine.html
- Drools documentation — https://docs.drools.org
- Stately/XState documentation — https://stately.ai/docs
- Chris Richardson, *Saga pattern* — https://microservices.io/patterns/data/saga.html
- Martin Fowler, *Event Sourcing* — https://martinfowler.com/eaaDev/EventSourcing.html
