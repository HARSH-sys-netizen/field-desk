# Evaluator notes

Harsh Bang — Tejas AI Engineering take-home, _Business Rules Engine_.

## Start here

1. [Final architecture](docs/solution/04-architecture-final.md) — what was built and why (10 min).
2. [Generated rulebook](docs/solution/rulebook.md) — every business rule in plain language, with the scenario count.
3. [`server/src/rules/rulebook.ts`](server/src/rules/rulebook.ts) — the same rules as code.
4. [Decision guide](docs/solution/decision-guide.md) — when this level of framework is worth it.
5. `git log --reverse 5f4651d^..main` — the story, one logical step per commit.

## Deliverables map

| Brief item                                              | Where                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Private repo, original history kept                  | This repo; upstream history is intact below `5f4651d`                                                                                                                                                                                                   |
| 2. Bonus: two solutions                                 | `solution-b-middle-ground` (refactor + features, no framework) and `main` (adds the rulebook layer). Compared in §8 of the final architecture                                                                                                           |
| 3. Decision tree / metrics                              | [decision-guide.md](docs/solution/decision-guide.md)                                                                                                                                                                                                    |
| 4. Architecture and its evolution, committed as written | [01 first draft](docs/solution/01-architecture-first-draft.md) → [02 refined](docs/solution/02-architecture-refined-draft.md) → [03 post-research](docs/solution/03-architecture-post-research.md) → [04 final](docs/solution/04-architecture-final.md) |
| 5. Chat history with the coding agent                   | [docs/solution/agent-chat/](docs/solution/agent-chat/README.md)                                                                                                                                                                                         |
| 6. Git history, bonus systematic commits                | Small commits with what/why messages; nothing squashed                                                                                                                                                                                                  |
| 7. These notes                                          | This file                                                                                                                                                                                                                                               |
| FDSK-169                                                | `MOVE_CUSTOMER_PAYMENT` — rule ACC-004; tests in `server/test/corrections.test.ts`                                                                                                                                                                      |
| FDSK-170                                                | `CORRECT_DELIVERY` — rule FUL-007; tests in the same file                                                                                                                                                                                               |

## Run it

```sh
pnpm install && pnpm env:setup && pnpm db:migrate
pnpm admin:create          # prompts for name, email, password
pnpm db:seed && pnpm dev   # http://localhost:5173
pnpm check                 # lint, typecheck, 268 API tests, build
pnpm rules:report          # regenerate docs/solution/rulebook.md
```

- **FDSK-169:** Customers → _Northside Stores_ → Payments & credits → Record payment → _Move payment_ on the receipt → choose _Greenfield Wholesale_.
- **FDSK-170:** Sales orders → any delivered order → Shipments → _Correct delivery_ → enter the quantity actually received. _Confirm delivery_ reappears for the remaining units.

Screenshots of both flows are in [docs/solution/screenshots](docs/solution/screenshots).

## Honesty notes

- **Built with a coding agent.** All code and documents were produced in one session with Claude (Opus 5.5) acting as the coding agent, directed and reviewed by me. The commit history is that session as it happened.
- **The four architecture drafts were written minutes apart** (commit times 18:56–19:34), not over days. They are genuine stages — draft 1 before reading the code, draft 2 after, draft 3 after weighing alternatives, draft 4 after building — but the evolution was fast because the agent did the reading.
- **The upstream app was already well structured.** Most of the value here is in finding where branching actually comes from (stage 2) rather than in a large framework.
- **Limits I know about** are listed in §9 of the final architecture, e.g. guards cover state gates but not quantity/money rules, and the scenario count assumes independent states.

## Assumptions made where the rules were silent

| Topic                          | Assumption                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Payment move scope             | The whole receipt moves; partial moves are not supported                                                     |
| Credit-funded receipts         | Refused (CRD-001 backing must stay); Accounts must use the credit first                                      |
| Allocation after a move        | WF-002 runs on the receiving account only; the wrong account keeps its charges open until Accounts allocates |
| Moved receipt date             | Keeps the original receipt time, so ACC-003 cash order reflects when money arrived                           |
| Overstated delivery            | Missing units are in transit and stay dispatched; correcting units that never left is out of scope           |
| Which confirmation to correct  | Latest first                                                                                                 |
| Released cash after correction | Becomes free cash and is re-allocated under WF-002 (delivery correction added as an occasion)                |
| Rules version                  | Kept at 2026-10-26.1 (tests pin it); new rules marked as extensions                                          |

## Time spent

Agent session (from the request time and commit timestamps, 30 Oct 2026, IST):

| Activity                                               | Time                                        |
| ------------------------------------------------------ | ------------------------------------------- |
| Reading brief, repo, docs and code; running tests      | 18:50–18:56 (6 min)                         |
| Architecture drafts 1–3                                | 18:56–18:57 (1 min, written during reading) |
| Refactor + FDSK-169 + FDSK-170 with tests (Solution B) | 18:57–19:15 (18 min)                        |
| Rulebook layer, report, drift tests (Solution A)       | 19:15–19:25 (10 min)                        |
| UI and browser verification                            | 19:25–19:32 (7 min)                         |
| Final documents and verification                       | 19:32–19:45 (13 min)                        |

Outside the agent session I directed the work through two messages (18:50 and 19:45) and reviewed the result; that time was not tracked separately. The whole session ran from 18:50 to about 19:50 IST.

## AI workflow notes

- **Tests as the refactor's safety net.** Guards kept the original error codes and messages, so the upstream 251 tests verified the rulebook refactor unchanged.
- **Drift tests.** `server/test/rulebook.test.ts` fails if the code's roles disagree with `business_terms.md`, if a cited rule ID does not exist, or if the generated rulebook is stale — useful when an agent edits code and docs separately.
- **Generated docs.** The readable rulebook and the scenario count come from the same declarations the engine enforces.
- **Browser verification.** Both UI flows were driven in headless Chromium against the seeded dataset before committing.
