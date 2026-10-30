import { Module } from '@nestjs/common';
import { RewardsService } from './rewards.service.js';
import { RewardsController } from './rewards.controller.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { SettlementModule } from '../settlement/settlement.service.js';
@Module({
  imports: [
    CustomersRepositoryModule,
    RewardsRepositoryModule,
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    OrdersRepositoryModule,
    ReturnsRepositoryModule,
    SettlementModule,
  ],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
