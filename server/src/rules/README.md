# Rules

Owns the declarative rulebook: who may run each action, when it is allowed, which entity states it depends on, and which follow-up work it triggers. The domain services own only the records an action writes.

## Implementation

- [rule.ts](rule.ts): Vocabulary — `Rule`, `Guard`, `Facts`, and the entity states used for scenario counting.
- [guards.ts](guards.ts): Named conditions. Each cites a canonical rule, says in plain English what must hold, and names the states it leaves possible.
- [rulebook.ts](rulebook.ts): One entry per command, typed as `Record<CommandType, Rule>` so a new command cannot compile without its rule.
- [reactions.ts](reactions.ts): WF-002 cash allocation and the REW-001/002/003 points refresh, declared once with a startup check that one ordered pass reaches a fixed point.
- [rules.engine.ts](rules.engine.ts): Generic runner — WHO, WHEN (guards in order), handler, then reactions. Builds lazily loaded `Facts` for guards.

## Coordination

`ActionsService` calls `RulesEngine.run` inside its transaction after the idempotency and version checks. A failed guard raises the same `DomainFailure` codes as before. Quantity and amount invariants stay in the domain models (`ChargeBalance`, `CreditBalance`, `ShipmentQuantity`, `ReturnQuantity`) and the post-action Audit review.

`pnpm rules:report` renders the rulebook as [docs/solution/rulebook.md](../../../docs/solution/rulebook.md); `test/rulebook.test.ts` fails if that file, the business-terms role table, or the canonical rule IDs drift from this code.

## Related

- [Backend module index](../README.md)
- [Final architecture](../../../docs/solution/04-architecture-final.md)
