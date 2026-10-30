# CLI scripts

Owns local administrator bootstrapping and repeat-safe development data creation.

## Implementation

- [create-admin.ts](create-admin.ts): Interactive or environment-driven administrator creation through Users.
- [seed-reference-data.ts](seed-reference-data.ts): Initial local products, customer identities, and staff desks.
- [seed-data.ts](seed-data.ts): Atomic dataset construction through explicit domain dependencies and Actions commands.
- [seed.ts](seed.ts): CLI application context, active administrator selection, dependency assembly, and state summary output.
- [seed.model.ts](seed.model.ts): The seed completion marker and saved dataset summary.
- [rules-report.ts](rules-report.ts): Renders the rulebook as plain-language Markdown and counts naive versus pruned scenarios (`pnpm rules:report`).

## Coordination

These are CLI entry points, not HTTP controllers. The dataset builder receives the actual domain services and repositories rather than a CRM facade. It records completion only after account checks pass, preserves existing data on reruns, and rejects production use or non-admin callers. Setup commands and dataset coverage are documented in the development guide linked from the backend index.

## Related

- [Backend module index](../README.md)
