# Fulfillment

Owns physical shipments, loading quantities, dispatch evidence, incremental delivery confirmations, and authorized dispatch supplements.

## Implementation

- [fulfillment.model.ts](fulfillment.model.ts): Shipment, shipment-line, delivery, and correction mappings; deliverable quantity validation.
- [fulfillment.repository.ts](fulfillment.repository.ts): Typed physical-document persistence and loaded, dispatched, and delivered quantity reads.
- [fulfillment.service.ts](fulfillment.service.ts): Prepare, dispatch, confirm delivery, lower an overstated delivery with linked negative deliveries (FDSK-170, FUL-007), append an authorized correction, and list shipments.
- [fulfillment.controller.ts](fulfillment.controller.ts): Authenticated shipment reads for an order.

## Coordination

Orders owns commercial revisions and approvals. Delivery appends an Accounts charge and invokes cash allocation and reward refresh. A correction retains the original physical document and records its supporting facts. Returns owns goods coming back after delivery. Mutating methods receive the Actions context and run inside its transaction; loading or dispatch alone does not create a receivable.

## Related

- [Backend module index](../README.md)
