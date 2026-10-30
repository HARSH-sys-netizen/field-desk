# Common helpers

Contains small shared execution types, domain errors, effect recording, and HTTP validation utilities.

## Implementation

- [domain.ts](domain.ts): `ActionContext`, command payload types, domain failures and decisions, the set of customers an action touches, safe integer arithmetic, and before/after effect capture.
- [validation.pipe.ts](validation.pipe.ts): Transforms Zod validation failures into structured HTTP 400 responses.

## Coordination

This directory has no Nest module or persistence. Domain services use the execution context supplied by Actions; repositories attach changes to its effects for later audit enrichment. Effect recording alone does not persist an event or commit a transaction. Domain-specific state transitions and value calculations remain with their owning models.

## Related

- [Backend module index](../README.md)
