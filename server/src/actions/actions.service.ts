import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { User } from '@crm/shared';
import type { ActionEnvelope, ActionResult } from '@crm/shared/crm';
import { BUSINESS_TERMS_VERSION } from '@crm/shared/crm';
import { UsersRepository } from '../users/users.repository.js';
import { ActionsRepository } from '../actions/actions.repository.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditRepository } from '../audit/audit.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RulesEngine } from '../rules/rules.engine.js';
import type { ActionContext as Context } from '../common/domain.js';
import {
  useOrder,
  useCustomer,
  touchedCustomers,
  fail,
  DomainFailure as Failure,
  DomainDecision as Decision,
} from '../common/domain.js';
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
@Injectable()
export class ActionsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly actionsRepository: ActionsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly accountsService: AccountsService,
    private readonly auditRepository: AuditRepository,
    private readonly auditService: AuditService,
    private readonly database: DatabaseService,
    private readonly rules: RulesEngine,
  ) {}
  execute(envelope: ActionEnvelope, requester: User): ActionResult {
    return this.database.db.transaction(
      () => {
        const actorId = envelope.actorId ?? requester.id;
        if (actorId !== requester.id && requester.role !== 'ADMIN')
          throw new ForbiddenException(
            'You cannot submit actions as another staff member',
          );
        const row = this.usersRepository.findById(actorId);
        if (!row?.active)
          throw new ForbiddenException(
            'The staff account is inactive or missing',
          );
        const actor: User = row;
        const fingerprint = createHash('sha256')
          .update(
            stable({
              command: envelope.command,
              actorId,
              expectedVersion: envelope.expectedVersion,
            }),
          )
          .digest('hex');
        const previous = this.actionsRepository.findRequest(
          requester.id,
          envelope.idempotencyKey,
        );
        if (previous) {
          if (previous.fingerprint === fingerprint)
            return JSON.parse(previous.result) as ActionResult;
          return {
            status: 'CONFLICT',
            actionId: '',
            errors: [
              {
                code: 'IDEMPOTENCY_CONFLICT',
                message:
                  'This request key has already been used for different input',
              },
            ],
            decisions: [],
            effects: [],
            trace: [],
            aggregateVersions: {},
            references: {},
            termsVersion: BUSINESS_TERMS_VERSION,
          };
        }
        const c: Context = {
          id: randomUUID(),
          actor,
          requester,
          now: new Date().toISOString(),
          customerId: '',
          relatedCustomerIds: [],
          effects: [],
          references: {},
          command: envelope.command,
        };
        const result: ActionResult = {
          status: 'APPLIED',
          actionId: c.id,
          errors: [],
          decisions: [],
          effects: c.effects,
          trace: [],
          aggregateVersions: {},
          references: c.references,
          termsVersion: BUSINESS_TERMS_VERSION,
        };
        try {
          this.database.db.transaction(() => {
            const p = envelope.command.payload;
            const aggregate =
              'orderId' in p
                ? useOrder(c, this.ordersRepository.findById(p.orderId))
                : useCustomer(
                    c,
                    this.customersRepository.findById(p.customerId),
                  );
            if (
              envelope.command.type !== 'PUNCH_ORDER' &&
              envelope.expectedVersion === undefined
            )
              fail(
                'VERSION_REQUIRED',
                'Refresh the record and include its version',
              );
            if (
              envelope.expectedVersion !== undefined &&
              envelope.expectedVersion !== aggregate.version
            )
              fail(
                'VERSION_CONFLICT',
                'The record changed. Refresh and try again.',
              );
            result.trace.push({
              stage: 'request',
              explanation: `${actor.name} (${actor.role}) requested ${envelope.command.type} against version ${aggregate.version}. Business terms ${BUSINESS_TERMS_VERSION}.`,
            });
            this.rules.run(c, envelope.command);
            const failedChecks: string[] = [];
            for (const customerId of touchedCustomers(c)) {
              this.customersRepository.updateCustomer(c, customerId, {
                version:
                  this.accountsService.summary(customerId).customer.version + 1,
              });
              for (const order of this.ordersRepository.forCustomer(customerId))
                this.ordersRepository.updateOrder(c, order.id, {
                  version: order.version + 1,
                });
              result.aggregateVersions[customerId] =
                this.customersRepository.findById(customerId)!.version;
              for (const order of this.ordersRepository.forCustomer(customerId))
                result.aggregateVersions[order.id] = order.version;
              this.auditRepository.insertEvent(c, {
                id: randomUUID(),
                customer_id: customerId,
                order_id:
                  customerId === c.customerId ? (c.orderId ?? null) : null,
                actor_id: actor.id,
                actor_name: actor.name,
                requested_by: requester.id,
                action_id: c.id,
                type: envelope.command.type,
                payload: JSON.stringify(envelope.command.payload),
                occurred_at: c.now,
              });
              const review = this.auditService.review(customerId);
              if (customerId === c.customerId) result.review = review;
              failedChecks.push(
                ...review.checks
                  .filter((check) => !check.passed)
                  .map((check) => check.label),
              );
            }
            if (failedChecks.length)
              fail('ACCOUNT_INCONSISTENT', failedChecks.join('; '));
            this.auditService.enrich(c);
            result.trace.push(
              ...c.effects
                .filter((effect) => effect.reason)
                .map((effect) => ({
                  stage: effect.entity,
                  explanation: effect.reason!,
                })),
            );
            result.trace.push({
              stage: 'completed',
              explanation: `${envelope.command.type} completed by ${actor.name}. ${c.effects.length} records written.`,
            });
          });
        } catch (error) {
          c.effects.length = 0;
          result.aggregateVersions = {};
          result.references = {};
          result.review = undefined;
          result.trace = [];
          if (error instanceof Decision) {
            result.status = 'NEEDS_DECISION';
            result.decisions = error.decisions;
          } else if (error instanceof Failure) {
            result.status = error.code.includes('CONFLICT')
              ? 'CONFLICT'
              : 'REJECTED';
            result.errors = [{ code: error.code, message: error.message }];
          } else throw error;
          result.trace.push({
            stage: 'not_applied',
            explanation: error.message,
          });
        }
        this.actionsRepository.saveRequest({
          id: c.id,
          requester_id: requester.id,
          actor_id: actor.id,
          idempotency_key: envelope.idempotencyKey,
          fingerprint: fingerprint,
          result: JSON.stringify(result),
          created_at: c.now,
        });
        return result;
      },
      { behavior: 'immediate' },
    );
  }
}
