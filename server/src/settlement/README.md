# Settlement

Owns the charge arithmetic shared by every operation that settles or unsettles a charge. It has no tables of its own; it writes through the Accounts, Credits, and Rewards repositories.

## Implementation

- [settlement.service.ts](settlement.service.ts):
  - `balance` — ACC-001 for one charge: retained value, cash, credit, points, and the outstanding amount.
  - `reduce` — lower a charge with a linked negative adjustment and release settlement that now exceeds it.
  - `release` — WF-003 release order: cash, then credit, then points; within cash or credit, sources in reverse order of first use. Returns released cash per receipt.

## Users

Allocation (ACC-003), point redemption, credit application, returns (WF-003), delivery correction (FDSK-170), and payment moves (FDSK-169) all use these primitives, so the release order is defined once.

## Related

- [Backend module index](../README.md)
- [Canonical business rules](../../../docs/candidate-walkthrough/canonical_business_rules.md)
