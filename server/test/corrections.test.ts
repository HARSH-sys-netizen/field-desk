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
import type { CustomerSnapshot } from '@crm/shared/crm';
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
});
