import { CreditBalance } from '../credits/credits.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CustomerSummary,
  LedgerView,
  CustomerAccountRow,
} from '@crm/shared/crm';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { DatabaseService } from '../database/database.service.js';
import { SettlementService } from '../settlement/settlement.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { useCustomer, fail, safe } from '../common/domain.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly rewardsService: RewardsService,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly database: DatabaseService,
    private readonly settlement: SettlementService,
  ) {}
  receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const receiptId = randomUUID();
    c.references.receiptId = receiptId;
    this.accountsRepository.insertReceipt(c, {
      id: receiptId,
      customer_id: c.customerId,
      amount_paise: p.amountPaise,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });
  }
  /**
   * FDSK-169. A payment was recorded against the wrong customer. History is
   * kept (WF-001) and settlement never crosses accounts (CUS-001):
   * 1. release every charge the receipt settles on the source account;
   * 2. close the source receipt's capacity with a transfer record;
   * 3. open a linked receipt on the target with the same bank reference and
   *    original receipt time, then allocate it there (WF-002: a receipt).
   * Points earned from the moved cash follow REW-002/REW-003 on both sides.
   */
  move(c: Context, p: Payload<'MOVE_CUSTOMER_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const target = this.customersRepository.findById(p.targetCustomerId)!;
    const receipt = this.accountsRepository.findCustomerReceipt(
      p.receiptId,
      c.customerId,
    )!;
    const transferId = randomUUID();
    for (const allocation of this.accountsRepository.cashByChargeForReceipt(
      receipt.id,
    ))
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: c.customerId,
        receipt_id: receipt.id,
        charge_id: allocation.charge_id,
        amount_paise: -allocation.n,
        action_id: c.id,
        created_at: c.now,
      });
    const movedReceiptId = randomUUID();
    this.accountsRepository.insertReceipt(c, {
      id: movedReceiptId,
      customer_id: target.id,
      amount_paise: receipt.amount_paise,
      reference: receipt.reference,
      action_id: c.id,
      created_at: receipt.created_at,
    });
    this.accountsRepository.insertTransfer(c, {
      id: transferId,
      from_receipt_id: receipt.id,
      to_receipt_id: movedReceiptId,
      from_customer_id: c.customerId,
      to_customer_id: target.id,
      amount_paise: receipt.amount_paise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    c.relatedCustomerIds.push(target.id);
    c.references.transferId = transferId;
    c.references.receiptId = movedReceiptId;
    c.references.targetCustomerId = target.id;
  }
  allocateCash(c: Context, customerId = c.customerId) {
    for (const receipt of this.accountsRepository.receiptsForCustomer(
      customerId,
    )) {
      let available = this.settlement.freeCash(receipt);
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.accountsRepository.chargesInDueOrder(
        customerId,
      )) {
        if (!available) break;
        const take = Math.min(
          available,
          Math.max(
            0,
            this.settlement.balance(charge.id, charge.amount_paise)
              .outstandingPaise,
          ),
        );
        if (take)
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }
  }
  summary(customerId: string): CustomerSummary {
    const customer = this.customersRepository.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const charges = this.accountsRepository
      .chargesForCustomer(customerId)
      .map((charge) => {
        const balance = this.settlement.balance(charge.id, charge.amount_paise);
        return {
          ...charge,
          remainingPaise: balance.retainedPaise,
          cashPaidPaise: balance.cashPaise,
          outstandingPaise: balance.outstandingPaise,
        };
      });
    const credits = this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => {
        const appliedPaise = this.creditsRepository.appliedFromCredit(note.id);
        const refundedPaise = this.creditsRepository.refundedFromCredit(
          note.id,
        );
        return {
          ...note,
          appliedPaise,
          refundedPaise,
          availablePaise: new CreditBalance(
            note.amount_paise,
            appliedPaise,
            refundedPaise,
          ).availablePaise,
        };
      });
    const receipts = this.accountsRepository.receiptsByInsertion(customerId);
    const unappliedCashPaise = safe(
      receipts.reduce(
        (sum, receipt) => sum + this.settlement.freeCash(receipt),
        0,
      ),
    );
    const receivedPaise =
      this.accountsRepository.receivedForCustomer(customerId);
    const refundsPaise = this.creditsRepository.refundedForCustomer(customerId);
    const redemption = this.rewardsRepository.redeemedForCustomer(customerId);
    const netBalancePaise = safe(
      this.accountsRepository.postedForCustomer(customerId) -
        receivedPaise +
        refundsPaise -
        redemption,
    );
    return {
      customer,
      charges,
      credits,
      netBalancePaise,
      unappliedCashPaise,
      receivedPaise,
      refundsPaise,
      outstandingPaise: safe(
        charges.reduce((sum, row) => sum + row.outstandingPaise, 0),
      ),
      creditsOpenPaise: safe(
        credits.reduce((sum, row) => sum + row.availablePaise, 0),
      ),
      points: this.rewardsService.balances(customerId),
    };
  }
  ledger(customerId: string): LedgerView {
    this.summary(customerId);
    return {
      finance: this.accountsRepository.entriesForCustomer(customerId),
      receipts: this.accountsRepository.receiptsByInsertion(customerId),
      allocations: this.accountsRepository.allocationsForCustomer(customerId),
      creditApplications:
        this.creditsRepository.applicationsForCustomer(customerId),
      credits: this.creditsRepository.creditsForCustomer(customerId),
      refunds: this.creditsRepository.refundsForCustomer(customerId),
      redemptions: this.rewardsRepository.redemptionsForCustomer(customerId),
      rewards: this.rewardsRepository.entriesForCustomer(customerId),
      returns: this.returnsRepository.forCustomer(customerId),
      corrections:
        this.fulfillmentRepository.correctionsForCustomer(customerId),
      transfers: this.accountsRepository.transfersForCustomer(customerId),
    };
  }
  accounts(): CustomerAccountRow[] {
    return this.database.db.transaction(() =>
      this.customersRepository.list().map((customer) => {
        const summary = this.summary(customer.id);
        return {
          customer,
          netBalancePaise: summary.netBalancePaise,
          outstandingPaise: summary.outstandingPaise,
          unappliedCashPaise: summary.unappliedCashPaise,
          creditsOpenPaise: summary.creditsOpenPaise,
        };
      }),
    );
  }
}
