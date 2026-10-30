import { Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChargeBalance } from '../accounts/accounts.model.js';
import type { Receipt, ReceivableEntry } from '../accounts/accounts.model.js';
import type { ActionContext } from '../common/domain.js';
import { fail } from '../common/domain.js';
import {
  AccountsRepository,
  AccountsRepositoryModule,
} from '../accounts/accounts.repository.js';
import {
  CreditsRepository,
  CreditsRepositoryModule,
} from '../credits/credits.repository.js';
import {
  RewardsRepository,
  RewardsRepositoryModule,
} from '../rewards/rewards.repository.js';

/**
 * One place for the receipt (ACC-002) and charge (ACC-001) arithmetic:
 * b_j = v_j − c_j − k_j − z_j (retained − cash − credit − points).
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
  ) {}
  balance(chargeId: string, amountPaise: number) {
    return new ChargeBalance(
      amountPaise + this.accountsRepository.adjustmentsForCharge(chargeId),
      this.accountsRepository.cashForCharge(chargeId),
      this.creditsRepository.appliedToCharge(chargeId),
      this.rewardsRepository.redeemedForCharge(chargeId),
    );
  }
  /** ACC-002 free cash of a receipt: u_i = m_i − a_i − f_i. */
  freeCash(receipt: Receipt) {
    return (
      this.accountsRepository.capacityOfReceipt(receipt) -
      this.accountsRepository.allocatedFromReceipt(receipt.id) -
      this.creditsRepository.reservedFromReceipt(receipt.id)
    );
  }
  /**
   * Lower a charge's retained value with a linked negative adjustment and
   * release any settlement that now exceeds it (WF-003 release order):
   * cash, then credit, then points; within cash or credit, the most recently
   * first-used source first. Returns released cash per receipt.
   */
  reduce(
    c: ActionContext,
    charge: ReceivableEntry,
    reductionPaise: number,
    kind: string,
    sourceId: string,
    released = new Map<string, number>(),
  ) {
    const before = this.balance(charge.id, charge.amount_paise);
    const reduction = Math.min(before.retainedPaise, reductionPaise);
    if (reduction <= 0) return { reduction: 0, released };
    this.accountsRepository.insertCharge(c, {
      id: randomUUID(),
      customer_id: charge.customer_id,
      order_id: charge.order_id,
      line_key: charge.line_key,
      shipment_line_id: charge.shipment_line_id,
      kind,
      amount_paise: -reduction,
      adjusts_id: charge.id,
      source_id: sourceId,
      action_id: c.id,
      created_at: c.now,
    });
    this.release(
      c,
      charge,
      Math.max(
        0,
        before.cashPaise +
          before.creditPaise +
          before.points -
          (before.retainedPaise - reduction),
      ),
      sourceId,
      released,
    );
    return { reduction, released };
  }
  /** Release `overage` of a charge's settlement back to its sources. */
  release(
    c: ActionContext,
    charge: ReceivableEntry,
    overage: number,
    sourceId: string,
    released = new Map<string, number>(),
  ) {
    for (const allocation of this.accountsRepository.cashByReceiptForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, allocation.n);
      if (!take) continue;
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        receipt_id: allocation.receipt_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      released.set(
        allocation.receipt_id,
        (released.get(allocation.receipt_id) ?? 0) + take,
      );
      overage -= take;
    }
    for (const application of this.creditsRepository.creditByNoteForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, application.n);
      if (!take) continue;
      this.creditsRepository.insertApplication(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        credit_note_id: application.credit_note_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      overage -= take;
    }
    if (overage > 0) {
      if (overage > this.rewardsRepository.redeemedForCharge(charge.id))
        fail(
          'SETTLEMENT_MISMATCH',
          'The charge cannot be settled against its source documents',
        );
      this.rewardsRepository.insertRedemption(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        charge_id: charge.id,
        points: -overage,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [bucket, delta] of [
        ['AVAILABLE', overage],
        ['REDEEMED', -overage],
      ] as const)
        this.rewardsRepository.insertPosting(c, {
          id: randomUUID(),
          customer_id: charge.customer_id,
          line_key: null,
          bucket,
          points_delta: delta,
          source_id: sourceId,
          action_id: c.id,
          created_at: c.now,
        });
    }
    return released;
  }
}

@Module({
  imports: [
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
  ],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
