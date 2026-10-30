import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type {
  CrmBootstrap,
  CustomerSnapshot,
  OrderDetail,
} from '@crm/shared/crm';
import { DatabaseService } from '../src/database/database.service.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';
import { seedReferenceData } from '../src/scripts/seed-reference-data.js';
import { HttpDesk } from './support/http-desk.js';

const directory = mkdtempSync(join(tmpdir(), 'corrections-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'corrections.db');
process.env.JWT_SECRET = 'corrections-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const one = [{ skuId: 'sku-a', qty: 1, unitPricePaise: 10000 }];

/** Every account check passes and the account position identity holds. */
function assertConsistent(snapshot: CustomerSnapshot) {
  const failed = snapshot.review.checks.filter((check) => !check.passed);
  assert.deepEqual(failed, []);
  const { summary } = snapshot;
  assert.equal(
    summary.netBalancePaise,
    summary.outstandingPaise -
      summary.unappliedCashPaise -
      summary.creditsOpenPaise,
  );
}

describe('Corrections: FDSK-169 and FDSK-170', { concurrency: false }, () => {
  let app: INestApplication;
  let desk: HttpDesk;
  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue([{ ttl: 60000, limit: 100000 }])
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    migrate(app.get(DatabaseService).db, {
      migrationsFolder: resolve('drizzle'),
    });
    const password = 'corrections-admin-password';
    const admin = await app.get(UsersService).create({
      name: 'Corrections operator',
      email: 'corrections@example.test',
      password,
      role: 'ADMIN',
    });
    seedReferenceData(app.get(DatabaseService), admin);
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password })
      .expect(200);
    const headers = login.headers['set-cookie'] as unknown as string[];
    desk = new HttpDesk(app, headers[0]!.split(';')[0]!);
  });
  after(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  describe('FDSK-169 move a payment recorded against the wrong customer', () => {
    async function delivered(customerId: string) {
      const orderId = await desk.order(customerId, one);
      await desk.ship(orderId);
      return orderId;
    }
    function move(
      customerId: string,
      receiptId: string,
      targetCustomerId: string,
    ) {
      return {
        type: 'MOVE_CUSTOMER_PAYMENT' as const,
        payload: {
          customerId,
          receiptId,
          targetCustomerId,
          reason: 'Bank reference shows Greenfield paid',
        },
      };
    }

    it('moves the user-story payment from Northside to Greenfield', async () => {
      const northside = await desk.createCustomer();
      const greenfield = await desk.createCustomer();
      await delivered(northside.id);
      await delivered(greenfield.id);
      const receipt = await desk.receive(northside.id, 10000);
      const receiptId = receipt.references.receiptId!;
      let wrong = await desk.snapshot(northside.id);
      assert.equal(wrong.summary.outstandingPaise, 0);
      assert.equal(wrong.summary.points.available, 1000);

      const result = await desk.apply(
        move(northside.id, receiptId, greenfield.id),
        'ACCOUNTS',
      );
      assert.equal(result.references.targetCustomerId, greenfield.id);
      assert.ok(result.aggregateVersions[greenfield.id]);

      wrong = await desk.snapshot(northside.id);
      const right = await desk.snapshot(greenfield.id);
      assertConsistent(wrong);
      assertConsistent(right);
      // Northside owes again; nothing it received remains.
      assert.equal(wrong.summary.outstandingPaise, 10000);
      assert.equal(wrong.summary.receivedPaise, 0);
      assert.equal(wrong.summary.unappliedCashPaise, 0);
      assert.deepEqual(wrong.summary.points, {
        locked: 1000,
        available: 0,
        redeemed: 0,
        clawbackPending: 0,
      });
      // Greenfield's charge is settled by the moved payment.
      assert.equal(right.summary.outstandingPaise, 0);
      assert.equal(right.summary.receivedPaise, 10000);
      assert.equal(right.summary.points.available, 1000);
      // History: the original receipt and its released allocation remain,
      // and the moved receipt keeps the bank reference and receipt time.
      const original = wrong.ledger.receipts.find(
        (row) => row.id === receiptId,
      )!;
      assert.equal(original.amount_paise, 10000);
      assert.deepEqual(
        wrong.ledger.allocations.map((row) => row.amount_paise),
        [10000, -10000],
      );
      const moved = right.ledger.receipts[0]!;
      assert.equal(moved.id, result.references.receiptId);
      assert.equal(moved.reference, original.reference);
      assert.equal(moved.created_at, original.created_at);
      assert.equal(wrong.ledger.transfers.length, 1);
      assert.deepEqual(right.ledger.transfers, wrong.ledger.transfers);
      assert.ok(
        right.timeline.some((event) => event.type === 'MOVE_CUSTOMER_PAYMENT'),
      );
    });

    it('moves unapplied advance value with the payment', async () => {
      const northside = await desk.createCustomer();
      const greenfield = await desk.createCustomer();
      await delivered(northside.id);
      await delivered(greenfield.id);
      const receipt = await desk.receive(northside.id, 15000);
      await desk.apply(
        move(northside.id, receipt.references.receiptId!, greenfield.id),
        'ACCOUNTS',
      );
      const right = await desk.snapshot(greenfield.id);
      assertConsistent(right);
      assert.equal(right.summary.outstandingPaise, 0);
      assert.equal(right.summary.unappliedCashPaise, 5000);
      assert.equal(right.summary.netBalancePaise, -5000);
      const wrong = await desk.snapshot(northside.id);
      assertConsistent(wrong);
      assert.equal(wrong.summary.netBalancePaise, 10000);
    });

    it('turns points already spent from the moved cash into a clawback', async () => {
      const northside = await desk.createCustomer();
      const greenfield = await desk.createCustomer();
      await delivered(northside.id);
      await delivered(northside.id);
      const receipt = await desk.receive(northside.id, 10000);
      const open = (await desk.snapshot(northside.id)).summary.charges.find(
        (charge) => charge.outstandingPaise > 0,
      )!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: northside.id,
            chargeId: open.id,
            points: 1000,
          },
        },
        'ACCOUNTS',
      );
      await desk.apply(
        move(northside.id, receipt.references.receiptId!, greenfield.id),
        'ACCOUNTS',
      );
      const wrong = await desk.snapshot(northside.id);
      assertConsistent(wrong);
      assert.equal(wrong.summary.points.clawbackPending, 1000);
      assert.equal(wrong.summary.points.available, 0);
      assert.equal(wrong.summary.outstandingPaise, 19000);
      const right = await desk.snapshot(greenfield.id);
      assertConsistent(right);
      assert.equal(right.summary.unappliedCashPaise, 10000);
    });

    it('can move a payment again if the first correction was also wrong', async () => {
      const a = await desk.createCustomer();
      const b = await desk.createCustomer();
      const c = await desk.createCustomer();
      const receipt = await desk.receive(a.id, 5000);
      const first = await desk.apply(
        move(a.id, receipt.references.receiptId!, b.id),
        'ACCOUNTS',
      );
      await desk.apply(
        move(b.id, first.references.receiptId!, c.id),
        'ACCOUNTS',
      );
      for (const id of [a.id, b.id, c.id])
        assertConsistent(await desk.snapshot(id));
      assert.equal((await desk.snapshot(b.id)).summary.receivedPaise, 0);
      assert.equal(
        (await desk.snapshot(c.id)).summary.unappliedCashPaise,
        5000,
      );
    });

    it('rejects invalid moves without changing either account', async () => {
      const northside = await desk.createCustomer();
      const greenfield = await desk.createCustomer();
      await delivered(northside.id);
      const receipt = await desk.receive(northside.id, 20000);
      const receiptId = receipt.references.receiptId!;
      const cases: Array<
        [ReturnType<typeof move>, 'ACCOUNTS' | 'SALES', string]
      > = [
        [
          move(northside.id, receiptId, northside.id),
          'ACCOUNTS',
          'SAME_CUSTOMER',
        ],
        [move(northside.id, receiptId, greenfield.id), 'SALES', 'FORBIDDEN'],
        [
          move(greenfield.id, receiptId, northside.id),
          'ACCOUNTS',
          'RECEIPT_NOT_FOUND',
        ],
        [
          move(northside.id, receiptId, 'missing-customer'),
          'ACCOUNTS',
          'NOT_FOUND',
        ],
      ];
      for (const [command, role, code] of cases) {
        const result = await desk.assertUnchanged(
          await desk.envelope(command, role),
          command.payload.customerId,
          'REJECTED',
        );
        assert.equal(result.errors[0]!.code, code);
      }
      // A receipt that funds a credit note cannot move (CRD-001 backing).
      await desk.apply(
        {
          type: 'ISSUE_CREDIT_NOTE',
          payload: {
            customerId: northside.id,
            amountPaise: 5000,
            reason: 'Goodwill credit',
          },
        },
        'ACCOUNTS',
      );
      const funded = await desk.assertUnchanged(
        await desk.envelope(
          move(northside.id, receiptId, greenfield.id),
          'ACCOUNTS',
        ),
        northside.id,
        'REJECTED',
      );
      assert.equal(funded.errors[0]!.code, 'RECEIPT_FUNDS_CREDIT');
      // A payment moved once cannot be moved again from the old account.
      const other = await desk.receive(northside.id, 1000);
      await desk.apply(
        move(northside.id, other.references.receiptId!, greenfield.id),
        'ACCOUNTS',
      );
      const again = await desk.assertUnchanged(
        await desk.envelope(
          move(northside.id, other.references.receiptId!, greenfield.id),
          'ACCOUNTS',
        ),
        northside.id,
        'REJECTED',
      );
      assert.equal(again.errors[0]!.code, 'RECEIPT_MOVED');
    });
  });
  describe('FDSK-170 correct an overstated delivery confirmation', () => {
    const ten = [{ skuId: 'sku-a', qty: 10, unitPricePaise: 10000 }];
    const detail = (orderId: string) =>
      desk.read<OrderDetail>(`orders/${orderId}`);
    function correct(
      orderId: string,
      shipmentId: string,
      shipmentLineId: string,
      deliveredQty: number,
    ) {
      return {
        type: 'CORRECT_DELIVERY' as const,
        payload: {
          orderId,
          shipmentId,
          items: [{ shipmentLineId, deliveredQty }],
          reason: 'Customer received six boxes; four still in transit',
        },
      };
    }
    async function overstated(customerId: string) {
      const orderId = await desk.order(customerId, ten);
      const shipment = await desk.ship(orderId);
      return {
        orderId,
        shipmentId: shipment.id,
        lineId: shipment.lines[0]!.id,
      };
    }

    it('corrects ten delivered boxes to six and lets Warehouse confirm the rest', async () => {
      const customer = await desk.createCustomer();
      const { orderId, shipmentId, lineId } = await overstated(customer.id);
      assert.equal(
        (await desk.snapshot(customer.id)).summary.outstandingPaise,
        100000,
      );

      await desk.apply(correct(orderId, shipmentId, lineId, 6), 'KAM');
      let order = await detail(orderId);
      let shipment = order.shipments.find((row) => row.id === shipmentId)!;
      assert.equal(shipment.status, 'DISPATCHED');
      assert.equal(shipment.lines[0]!.delivered, 6);
      assert.equal(order.lines[0]!.delivered, 6);
      const listed = await desk.read<CrmBootstrap>('bootstrap');
      assert.equal(
        listed.orders.find((row) => row.id === orderId)!.fulfillmentStatus,
        'PARTIALLY_DELIVERED',
      );
      let state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.outstandingPaise, 60000);
      assert.deepEqual(
        state.ledger.finance.map((row) => [row.kind, row.amount_paise]),
        [
          ['DELIVERY', 100000],
          ['DELIVERY_CORRECTION', -40000],
        ],
      );

      await desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            items: [{ shipmentLineId: lineId, qty: 4 }],
          },
        },
        'WAREHOUSE',
      );
      order = await detail(orderId);
      shipment = order.shipments.find((row) => row.id === shipmentId)!;
      assert.equal(shipment.status, 'DELIVERED');
      state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.outstandingPaise, 100000);
    });

    it('releases cash and points earned on the units that were not delivered', async () => {
      const customer = await desk.createCustomer();
      const { orderId, shipmentId, lineId } = await overstated(customer.id);
      await desk.receive(customer.id, 100000);
      assert.equal(
        (await desk.snapshot(customer.id)).summary.points.available,
        10000,
      );

      await desk.apply(correct(orderId, shipmentId, lineId, 6), 'KAM');
      let state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.outstandingPaise, 0);
      assert.equal(state.summary.unappliedCashPaise, 40000);
      assert.equal(state.summary.netBalancePaise, -40000);
      assert.deepEqual(state.summary.points, {
        locked: 4000,
        available: 6000,
        redeemed: 0,
        clawbackPending: 0,
      });

      // Confirming the four boxes later re-allocates the advance (WF-002).
      await desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            items: [{ shipmentLineId: lineId, qty: 4 }],
          },
        },
        'WAREHOUSE',
      );
      state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.netBalancePaise, 0);
      assert.equal(state.summary.points.available, 10000);
    });

    it('releases cash before redeemed points, as returns do (WF-003 order)', async () => {
      const customer = await desk.createCustomer();
      const { orderId, shipmentId, lineId } = await overstated(customer.id);
      await desk.receive(customer.id, 60000);
      const charge = (await desk.snapshot(customer.id)).summary.charges[0]!;
      await desk.apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: customer.id,
            chargeId: charge.id,
            points: 4000,
          },
        },
        'ACCOUNTS',
      );
      await desk.apply(correct(orderId, shipmentId, lineId, 6), 'KAM');
      const state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.unappliedCashPaise, 4000);
      assert.equal(state.summary.points.redeemed, 4000);
      assert.equal(state.summary.charges[0]!.outstandingPaise, 0);
    });

    it('corrects the latest confirmation first when there were several', async () => {
      const customer = await desk.createCustomer();
      const orderId = await desk.order(customer.id, ten);
      const shipment = await desk.ship(orderId, [10], [5]);
      const lineId = shipment.lines[0]!.id;
      await desk.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId: shipment.id,
            items: [{ shipmentLineId: lineId, qty: 5 }],
          },
        },
        'WAREHOUSE',
      );
      await desk.apply(correct(orderId, shipment.id, lineId, 6), 'KAM');
      const state = await desk.snapshot(customer.id);
      assertConsistent(state);
      const [first, second, adjustment] = state.ledger.finance;
      assert.equal(adjustment!.kind, 'DELIVERY_CORRECTION');
      assert.equal(adjustment!.adjusts_id, second!.id);
      assert.notEqual(adjustment!.adjusts_id, first!.id);
      assert.equal(adjustment!.amount_paise, -40000);
    });

    it('keeps returned units within the corrected delivery', async () => {
      const customer = await desk.createCustomer();
      const { orderId, shipmentId, lineId } = await overstated(customer.id);
      await desk.apply(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId: lineId, qty: 3 }],
            feePaise: 0,
            reason: 'Damaged boxes',
          },
        },
        'WAREHOUSE',
      );
      const tooLow = await desk.assertUnchanged(
        await desk.envelope(correct(orderId, shipmentId, lineId, 2), 'KAM'),
        customer.id,
        'REJECTED',
      );
      assert.equal(tooLow.errors[0]!.code, 'RETURNED_UNITS');
      await desk.apply(correct(orderId, shipmentId, lineId, 5), 'KAM');
      const state = await desk.snapshot(customer.id);
      assertConsistent(state);
      assert.equal(state.summary.outstandingPaise, 20000);
    });

    it('rejects corrections that are not lowering a confirmed delivery', async () => {
      const customer = await desk.createCustomer();
      const { orderId, shipmentId, lineId } = await overstated(customer.id);
      const cases: Array<[number, 'KAM' | 'WAREHOUSE', string]> = [
        [6, 'WAREHOUSE', 'FORBIDDEN'],
        [10, 'KAM', 'NOTHING_TO_CORRECT'],
        [11, 'KAM', 'NOTHING_TO_CORRECT'],
      ];
      for (const [qty, role, code] of cases) {
        const result = await desk.assertUnchanged(
          await desk.envelope(correct(orderId, shipmentId, lineId, qty), role),
          customer.id,
          'REJECTED',
        );
        assert.equal(result.errors[0]!.code, code);
      }
      const other = await desk.order(customer.id, ten);
      const otherLine = (await detail(other)).lines[0]!;
      const started = await desk.apply(
        {
          type: 'START_LOADING',
          payload: {
            orderId: other,
            items: [{ lineKey: otherLine.lineKey, qty: 2 }],
          },
        },
        'WAREHOUSE',
      );
      const loadingShipment = (await detail(other)).shipments[0]!;
      const notDispatched = await desk.assertUnchanged(
        await desk.envelope(
          correct(
            other,
            started.references.shipmentId!,
            loadingShipment.lines[0]!.id,
            0,
          ),
          'KAM',
        ),
        customer.id,
        'REJECTED',
      );
      assert.equal(notDispatched.errors[0]!.code, 'SHIPMENT_STATE');
    });
  });
});
