import { fail } from '../common/domain.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { crmSkus } from '../catalog/catalog.model.js';
import { crmOrders } from '../orders/orders.model.js';

export const crmShipments = sqliteTable(
  'shipments',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    original_shipment_id: text('original_shipment_id'),
    correction_id: text('correction_id'),
    created_at: text('created_at').notNull(),
    dispatched_at: text('dispatched_at'),
  },
  (t) => [
    index('shipments_order_id_idx').on(t.order_id),
    check(
      'shipments_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
  ],
);

export const crmShipmentLines = sqliteTable(
  'shipment_lines',
  {
    id: text('id').primaryKey(),
    shipment_id: text('shipment_id')
      .notNull()
      .references(() => crmShipments.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    sku_id: text('sku_id')
      .notNull()
      .references(() => crmSkus.id, { onDelete: 'cascade' }),
    loaded_qty: integer('loaded_qty').notNull(),
    dispatched_qty: integer('dispatched_qty').notNull(),
    unit_price_paise: integer('unit_price_paise').notNull(),
    points_per_unit: integer('points_per_unit').notNull(),
  },
  (t) => [
    index('shipment_lines_shipment_id_idx').on(t.shipment_id),
    index('shipment_lines_order_id_idx').on(t.order_id),
    index('shipment_lines_sku_id_idx').on(t.sku_id),
    check(
      'shipment_lines_loaded_qty_check',
      sql`typeof(${t.loaded_qty}) = 'integer' and ${t.loaded_qty} >= 0`,
    ),
    check(
      'shipment_lines_dispatched_qty_check',
      sql`typeof(${t.dispatched_qty}) = 'integer' and ${t.dispatched_qty} >= 0`,
    ),
    check(
      'shipment_lines_unit_price_paise_check',
      sql`typeof(${t.unit_price_paise}) = 'integer' and ${t.unit_price_paise} > 0`,
    ),
    check(
      'shipment_lines_points_per_unit_check',
      sql`typeof(${t.points_per_unit}) = 'integer' and ${t.points_per_unit} > 0`,
    ),
  ],
);

export const crmDeliveries = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    shipment_line_id: text('shipment_line_id')
      .notNull()
      .references(() => crmShipmentLines.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    /** Set on a negative row that corrects an overstated confirmation (FDSK-170). */
    corrects_delivery_id: text('corrects_delivery_id').references(
      (): AnySQLiteColumn => crmDeliveries.id,
    ),
    reason: text('reason').notNull().default(''),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('deliveries_shipment_line_id_idx').on(t.shipment_line_id),
    index('deliveries_order_id_idx').on(t.order_id),
    index('deliveries_corrects_delivery_idx').on(t.corrects_delivery_id),
    check(
      'deliveries_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ((${t.qty} > 0 and ${t.corrects_delivery_id} is null) or (${t.qty} < 0 and ${t.corrects_delivery_id} is not null))`,
    ),
  ],
);

export const crmCorrections = sqliteTable(
  'corrections',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    original_revision: integer('original_revision').notNull(),
    new_revision: integer('new_revision').notNull(),
    actor_id: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
    authorization_reference: text('authorization_reference').notNull(),
    location: text('location').notNull(),
    shipment_id: text('shipment_id'),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('corrections_order_id_idx').on(t.order_id),
    check(
      'corrections_original_revision_check',
      sql`typeof(${t.original_revision}) = 'integer' and ${t.original_revision} > 0`,
    ),
    check(
      'corrections_new_revision_check',
      sql`typeof(${t.new_revision}) = 'integer' and ${t.new_revision} > 0`,
    ),
  ],
);

export type ShipmentRecord = typeof crmShipments.$inferSelect;
export type ShipmentLineRecord = typeof crmShipmentLines.$inferSelect;
export class ShipmentQuantity {
  constructor(
    readonly dispatched: number,
    readonly delivered: number,
  ) {}
  get awaitingDelivery() {
    return this.dispatched - this.delivered;
  }
  /**
   * FDSK-170: a confirmed quantity can only be lowered, and never below the
   * units already returned (FUL-001: r ≤ d ≤ s).
   */
  assertCorrectable(correctedQty: number, returned: number) {
    if (correctedQty >= this.delivered)
      fail(
        'NOTHING_TO_CORRECT',
        'The corrected quantity must be lower than the confirmed delivery',
      );
    if (correctedQty < returned)
      fail(
        'RETURNED_UNITS',
        'Returned units cannot exceed the corrected delivery',
      );
  }
  assertDeliverable(qty: number) {
    if (qty > this.awaitingDelivery)
      fail('QUANTITY_EXCEEDED', 'Delivery exceeds the dispatched quantity');
  }
}
