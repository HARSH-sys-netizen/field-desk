import { Module } from '@nestjs/common';
import { ActionsService } from './actions.service.js';
import { ActionsController } from './actions.controller.js';
import { UsersRepositoryModule } from '../users/users.repository.js';
import { ActionsRepositoryModule } from '../actions/actions.repository.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { CustomersModule } from '../customers/customers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { ReturnsModule } from '../returns/returns.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CreditsModule } from '../credits/credits.module.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { AuditRepositoryModule } from '../audit/audit.repository.js';
import { AuditModule } from '../audit/audit.module.js';
import { RulesEngine } from '../rules/rules.engine.js';
@Module({
  imports: [
    UsersRepositoryModule,
    ActionsRepositoryModule,
    OrdersRepositoryModule,
    CustomersRepositoryModule,
    CustomersModule,
    OrdersModule,
    FulfillmentModule,
    ReturnsModule,
    AccountsModule,
    RewardsModule,
    CreditsModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
    FulfillmentRepositoryModule,
    AccountsRepositoryModule,
    AuditRepositoryModule,
    AuditModule,
  ],
  controllers: [ActionsController],
  providers: [ActionsService, RulesEngine],
  exports: [ActionsService],
})
export class ActionsModule {}
