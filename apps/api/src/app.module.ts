import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog';
import { CustomerModule } from './modules/customer';
import { IdentityModule } from './modules/identity';
import { InventoryModule } from './modules/inventory';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [SharedModule, IdentityModule, CustomerModule, CatalogModule, InventoryModule],
  controllers: [HealthController],
})
export class AppModule {}
