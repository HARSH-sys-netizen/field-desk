import { Injectable } from '@nestjs/common';
import type { CommandType, CrmCommand } from '@crm/shared/crm';
import type { ActionContext } from '../common/domain.js';
import { fail, touchedCustomers } from '../common/domain.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { ReturnsService } from '../returns/returns.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsService } from '../credits/credits.service.js';
import type { Facts } from './rule.js';
import { RULEBOOK } from './rulebook.js';
import { REACTIONS } from './reactions.js';

type Handler<T extends CommandType> = (
  c: ActionContext,
  payload: Extract<CrmCommand, { type: T }>['payload'],
) => void;
type Handlers = { [T in CommandType]: Handler<T> };

/**
 * Runs one action through its rule: WHO → WHEN → handler → reactions.
 * Everything here is generic; the business content is in rulebook.ts.
 */
@Injectable()
export class RulesEngine {
  private readonly handlers: Handlers;
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    customers: CustomersService,
    orders: OrdersService,
    fulfillment: FulfillmentService,
    returns: ReturnsService,
    private readonly accounts: AccountsService,
    private readonly rewards: RewardsService,
    credits: CreditsService,
  ) {
    this.handlers = {
      UPDATE_CUSTOMER: (c, p) => customers.updateCustomer(c, p),
      PUNCH_ORDER: (c, p) => orders.punch(c, p),
      EDIT_ORDER: (c, p) => orders.edit(c, p),
      SUBMIT_ORDER: (c, p) => orders.submit(c, p),
      APPROVE_ORDER: (c, p) => orders.approve(c, p),
      REJECT_ORDER: (c, p) => orders.reject(c, p),
      CANCEL_REMAINDER: (c, p) => orders.cancel(c, p),
      START_LOADING: (c, p) => fulfillment.load(c, p),
      DISPATCH_SHIPMENT: (c, p) => fulfillment.dispatch(c, p),
      CONFIRM_DELIVERY: (c, p) => fulfillment.deliver(c, p),
      CORRECT_DELIVERY: (c, p) => fulfillment.correctDelivery(c, p),
      CORRECT_DISPATCHED_ORDER: (c, p) => fulfillment.correct(c, p),
      RECORD_RETURN: (c, p) => returns.returnItems(c, p),
      RECEIVE_CUSTOMER_PAYMENT: (c, p) => accounts.receive(c, p),
      ALLOCATE_PAYMENT: () => undefined,
      MOVE_CUSTOMER_PAYMENT: (c, p) => accounts.move(c, p),
      ISSUE_CREDIT_NOTE: (c, p) => credits.issueCredit(c, p),
      APPLY_CREDIT_NOTE: (c, p) => credits.applyCredit(c, p),
      REFUND_CREDIT_NOTE: (c, p) => credits.refundCredit(c, p),
      REVERSE_CREDIT_APPLICATION: (c, p) =>
        credits.reverseCreditApplication(c, p),
      REVERSE_CREDIT_REFUND: (c, p) => credits.reverseCreditRefund(c, p),
      REDEEM_POINTS: (c, p) => rewards.redeem(c, p),
    };
  }

  run(c: ActionContext, command: CrmCommand) {
    const rule = RULEBOOK[command.type];
    // WHO
    if (c.actor.role !== 'ADMIN' && !rule.who.includes(c.actor.role))
      fail('FORBIDDEN', 'This operation requires a different role');
    // WHEN
    const facts = this.facts(c, command.payload);
    for (const guard of rule.when)
      if (!guard.holds(facts))
        fail(guard.otherwise.code, guard.otherwise.message);
    // THEN
    (this.handlers[command.type] as Handler<typeof command.type>)(
      c,
      command.payload,
    );
    // AFTERWARDS: reactions, in dependency order (see reactions.ts)
    if (rule.allocates)
      for (const customerId of rule.allocates === 'own account'
        ? [c.customerId]
        : c.relatedCustomerIds)
        this.accounts.allocateCash(c, customerId);
    const touched = new Set(c.effects.map((effect) => effect.entity));
    if (REACTIONS.points.watches.some((table) => touched.has(table)))
      for (const customerId of touchedCustomers(c))
        this.rewards.refresh(c, customerId);
  }

  /** Lazily loaded state that guards may read. */
  private facts(c: ActionContext, payload: CrmCommand['payload']): Facts {
    const p = payload as Readonly<Record<string, unknown>>;
    const once = <T>(load: () => T) => {
      let value: { v: T } | undefined;
      return () => (value ??= { v: load() }).v;
    };
    const order = once(() =>
      c.orderId ? this.ordersRepository.findById(c.orderId) : undefined,
    );
    const shipment = once(() =>
      c.orderId && typeof p.shipmentId === 'string'
        ? this.fulfillmentRepository.findForOrder(p.shipmentId, c.orderId)
        : undefined,
    );
    const receipt = once(() =>
      typeof p.receiptId === 'string'
        ? this.accountsRepository.findCustomerReceipt(p.receiptId, c.customerId)
        : undefined,
    );
    return {
      payload: p,
      order,
      shipment,
      currentRevisionApproved: () => {
        const row = order();
        return Boolean(
          row &&
          this.ordersRepository.approvalCount(row.id, row.current_revision),
        );
      },
      orderHasDispatch: () =>
        Boolean(
          c.orderId && this.fulfillmentRepository.dispatchedCount(c.orderId),
        ),
      orderHasCancellation: () =>
        Boolean(
          c.orderId && this.ordersRepository.cancellationCount(c.orderId),
        ),
      customerExists: (id) => Boolean(this.customersRepository.findById(id)),
      primaryCustomerId: () => c.customerId,
      receiptOfCustomer: () => Boolean(receipt()),
      receiptMoved: () =>
        Boolean(this.accountsRepository.transferOfReceipt(receipt()!.id)),
      receiptFundsCredit: () =>
        this.creditsRepository.reservedFromReceipt(receipt()!.id) > 0,
      clawbackPending: () =>
        this.rewardsRepository.debtForCustomer(c.customerId) > 0,
    };
  }
}
