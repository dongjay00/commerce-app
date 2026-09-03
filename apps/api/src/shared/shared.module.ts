import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { readJwtConfig } from './infrastructure/auth/jwt.config';
import { JwtTokenService } from './infrastructure/auth/jwt-token.service';
import { SystemClock } from './infrastructure/clock/system-clock';
import { AccessTokenGuard } from './infrastructure/http/access-token.guard';
import { DomainErrorRegistry } from './infrastructure/http/domain-error.registry';
import { DomainExceptionFilter } from './infrastructure/http/domain-exception.filter';
import { registerKernelDomainErrors } from './infrastructure/http/kernel-domain-error-mappings';
import { UuidV7Generator } from './infrastructure/id/uuid-v7.generator';
import { NestEventEmitterTransport } from './infrastructure/messaging/nest-event-emitter.transport';
import { OutboxEventPublisher } from './infrastructure/outbox/outbox-event.publisher';
import { OutboxRelay } from './infrastructure/outbox/outbox-relay';
import { OutboxRelayScheduler } from './infrastructure/outbox/outbox-relay.scheduler';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { PrismaTransactionManager } from './infrastructure/prisma/prisma-transaction-manager';
import {
  readSchedulerConfig,
  SCHEDULER_CONFIG,
  type SchedulerConfig,
} from './infrastructure/scheduler/scheduler.config';
import { ACCESS_TOKEN_VERIFIER } from './kernel/ports/access-token-verifier';
import { CLOCK, type Clock } from './kernel/ports/clock';
import { DOMAIN_EVENT_PUBLISHER } from './kernel/ports/domain-event.publisher';
import { EVENT_TRANSPORT, type EventTransport } from './kernel/ports/event-transport';
import { ID_GENERATOR, type IdGenerator } from './kernel/ports/id-generator';
import { TRANSACTION_MANAGER } from './kernel/ports/transaction-manager';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot(), ScheduleModule.forRoot()],
  providers: [
    PrismaService,
    {
      provide: DomainErrorRegistry,
      useFactory: () => {
        const registry = new DomainErrorRegistry();
        registerKernelDomainErrors(registry);
        return registry;
      },
    },
    // 이 등록이 실제로 전역 필터를 설치한다는 것은 app.module.spec.ts가
    // ApplicationConfig.getGlobalFilters()로 확인한다 — main.ts에는 더 이상
    // 설치 지점이 없다.
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    { provide: EVENT_TRANSPORT, useClass: NestEventEmitterTransport },
    {
      provide: TRANSACTION_MANAGER,
      useFactory: (prisma: PrismaService) => new PrismaTransactionManager(prisma),
      inject: [PrismaService],
    },
    {
      provide: DOMAIN_EVENT_PUBLISHER,
      useFactory: (prisma: PrismaService, ids: IdGenerator) =>
        new OutboxEventPublisher(prisma, ids),
      inject: [PrismaService, ID_GENERATOR],
    },
    {
      provide: OutboxRelay,
      useFactory: (prisma: PrismaService, transport: EventTransport, clock: Clock) =>
        new OutboxRelay(prisma, transport, clock),
      inject: [PrismaService, EVENT_TRANSPORT, CLOCK],
    },
    // JwtConfig는 인터페이스라 DI로 해석할 수 없다. 팩토리로 만든다.
    // 잘못된 설정은 여기서 부팅을 실패시킨다 — 첫 로그인 요청에서 500으로 드러나는
    // 것보다 낫다.
    {
      provide: JwtTokenService,
      useFactory: () => new JwtTokenService(readJwtConfig(process.env)),
    },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JwtTokenService },
    // SchedulerConfig도 인터페이스라 DI로 해석할 수 없다. 잘못된 주기는 여기서
    // 부팅을 실패시킨다.
    { provide: SCHEDULER_CONFIG, useFactory: () => readSchedulerConfig(process.env) },
    {
      // 생성자: OutboxRelayScheduler(registry, config, relay)
      provide: OutboxRelayScheduler,
      useFactory: (registry: SchedulerRegistry, config: SchedulerConfig, relay: OutboxRelay) =>
        new OutboxRelayScheduler(registry, config, relay),
      inject: [SchedulerRegistry, SCHEDULER_CONFIG, OutboxRelay],
    },
    AccessTokenGuard,
  ],
  exports: [
    PrismaService,
    SCHEDULER_CONFIG,
    DomainErrorRegistry,
    OutboxRelay,
    CLOCK,
    ID_GENERATOR,
    EVENT_TRANSPORT,
    TRANSACTION_MANAGER,
    DOMAIN_EVENT_PUBLISHER,
    JwtTokenService,
    ACCESS_TOKEN_VERIFIER,
    AccessTokenGuard,
  ],
})
export class SharedModule {}
