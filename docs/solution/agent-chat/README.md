# Coding-agent chat history

Deliverable 5. The work was done in one session with **Claude (Anthropic, Opus 5.5)** running as an agent in the Claude app, with shell, file and headless-browser tools in a cloud workspace.

- **Transcript:** [transcript.md](transcript.md) — written by the agent from its own conversation context: both user messages and the agent's replies verbatim, each tool call summarised in one line.
- **Session log below:** written by the agent at the end of the session from its own steps, so a reviewer can map each commit to the instruction and decision behind it.

## Instruction

> Do this please reqs each and every line ok and then proceed to make ok

(with the assignment PDF attached), followed at 19:45 by "Please do everything please". No other steering was given; the agent made the judgment calls listed under "Decisions".

## Session log (30 Oct 2026, IST)

Times are commit times (IST) from `git log`; the first row is when the request arrived.

| Time        | Step                                                                                                                                                                                           | Commits                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 18:50       | Request received. Read the brief; cloned `AviKKi/field-desk` with history; installed; ran the 251 API tests; read the walkthrough, canonical rules, every backend service and the test harness | —                                          |
| 18:56–18:57 | First, refined and post-research architecture drafts, committed before any code                                                                                                                | `5f4651d`, `841c185`, `071d72c`            |
| 19:01       | Settlement primitives extracted; returns moved onto them; suite green                                                                                                                          | `4d9d01b`, `69b77d3`                       |
| 19:04       | Multi-customer action boundary                                                                                                                                                                 | `d8b446d`                                  |
| 19:10       | FDSK-169: receipt capacity, transfers table, move handler, 5 HTTP tests                                                                                                                        | `359fe09`, `9ae1168`, `7af5ec8`            |
| 19:15       | FDSK-170: linked negative deliveries, migration fix, handler, 6 HTTP tests; Solution B branched here                                                                                           | `d21c019`, `cc49fe0`, `a9d9e6f`            |
| 19:22       | Solution A: rulebook, guards, reactions, engine; services stripped of role checks, state gates and hand-wired calls; 262/262 green                                                             | `4f58bb2`, `b8fe1fb`                       |
| 19:25       | ACC-004/FUL-007 documented; rulebook generator, scenario counter, drift tests                                                                                                                  | `d8ddd26`, `3eec3bf`, `75cc4c7`, `1842004` |
| 19:32       | UI for both features, verified in a headless browser on seeded data; screenshots                                                                                                               | `af9e8b0`, `5781c67`                       |
| 19:33–19:40 | Module READMEs, final architecture, decision guide, these notes, evaluator notes, final verification                                                                                           | `fc0a5e5`, `a318ee8`, `66cb735` and later  |

## Decisions the agent made, and why

1. **Did not build a Drools-style engine.** After reading the code, the existing action boundary, value models and audit review already covered most of it; the branching came from scattered gates and hand-wired reactions (stage 2 draft).
2. **Never update history in place.** A payment move and a delivery correction both use linked compensating rows, because WF-001 forbids editing posted value.
3. **Move whole receipts only; refuse receipts that fund credit.** A bank payment is one transaction; CRD-001 requires credit funding to stay.
4. **Allocate only on the receiving account after a move.** WF-002 lists receipt capture as an occasion, not the loss of a receipt.
5. **Correct latest confirmations first; treat missing units as in transit.** Matches the user story; units that never left the warehouse are out of scope.
6. **Keep error codes and messages unchanged** when lifting checks into guards, so the original 251 tests act as the regression suite for the refactor.
7. **Build Solution B first, then A on top**, so the commit history shows the middle ground as a working state and the framework as an explicit step.

## Problems hit

- drizzle-kit generated a table-rebuild migration that selected the new columns from the old `deliveries` table; fixed by hand (`NULL`, `''`).
- A test file nested the FDSK-170 suite inside FDSK-169's; fixed before committing.
- `OrderDetail.order` has no `fulfillmentStatus`; the test reads it from the bootstrap list instead.
- Prettier reformats Markdown tables, which broke the "generated rulebook is current" test; the generated file is now excluded from Prettier.
