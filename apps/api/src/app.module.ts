import { Module } from '@nestjs/common';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [HealthController],
})
export class AppModule {}
