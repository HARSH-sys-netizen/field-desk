import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';
import { crmSkus } from '../catalog/catalog.model.js';

export const crmOrders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull().unique(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    current_revision: integer('current_revision').notNull(),
    version: integer('version').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('orders_customer_id_idx').on(t.customer_id),
    check(
      'orders_current_revision_check',
      sql`typeof(${t.current_revision}) = 'integer' and ${t.current_revision} > 0`,
    ),
    check(
      'orders_version_check',
      sql`typeof(${t.version}) = 'integer' and ${t.version} >= 0`,
    ),
  ],
);

export const crmOrderRevisions = sqliteTable(
  'order_revisions',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    actor_id: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('order_revisions_order_id_idx').on(t.order_id),
    check(
      'order_revisions_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
    uniqueIndex('order_revisions_number_idx').on(t.order_id, t.revision),
  ],
);

export const crmOrderLines = sqliteTable(
  'order_lines',
  {
    id: text('id').primaryKey(),
    revision_id: text('revision_id')
      .notNull()
      .references(() => crmOrderRevisions.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    sku_id: text('sku_id')
      .notNull()
      .references(() => crmSkus.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    unit_price_paise: integer('unit_price_paise').notNull(),
    points_per_unit: integer('points_per_unit').notNull(),
  },
  (t) => [
    index('order_lines_revision_id_idx').on(t.revision_id),
    index('order_lines_order_id_idx').on(t.order_id),
    index('order_lines_sku_id_idx').on(t.sku_id),
    check(
      'order_lines_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
    check(
      'order_lines_unit_price_paise_check',
      sql`typeof(${t.unit_price_paise}) = 'integer' and ${t.unit_price_paise} > 0`,
    ),
    check(
      'order_lines_points_per_unit_check',
      sql`typeof(${t.points_per_unit}) = 'integer' and ${t.points_per_unit} > 0`,
    ),
    uniqueIndex('order_lines_sku_idx').on(t.revision_id, t.sku_id),
  ],
);

export const crmApprovals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    actor_id: text('actor_id').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('approvals_order_id_idx').on(t.order_id),
    check(
      'approvals_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
  ],
);

export const crmCancellations = sqliteTable(
  'cancellations',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    qty: integer('qty').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('cancellations_order_id_idx').on(t.order_id),
    check(
      'cancellations_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
  ],
);

export interface FulfillmentProgress {
  orderedQty: number;
  canceledQty: number;
  loadingQty: number;
  dispatchedQty: number;
  deliveredQty: number;
}
export function fulfillmentState(
  progress: FulfillmentProgress,
):
  | 'CANCELLED'
  | 'DELIVERED'
  | 'PARTIALLY_DELIVERED'
  | 'DISPATCHED'
  | 'PARTIALLY_DISPATCHED'
  | 'LOADING'
  | 'UNFULFILLED' {
  const active = progress.orderedQty - progress.canceledQty;
  if (active === 0) return 'CANCELLED';
  if (progress.deliveredQty >= active) return 'DELIVERED';
  if (progress.deliveredQty > 0) return 'PARTIALLY_DELIVERED';
  if (progress.dispatchedQty >= active) return 'DISPATCHED';
  if (progress.dispatchedQty > 0) return 'PARTIALLY_DISPATCHED';
  return progress.loadingQty > 0 ? 'LOADING' : 'UNFULFILLED';
}
export type Order = typeof crmOrders.$inferSelect;
export type CommercialLine = typeof crmOrderLines.$inferSelect;
