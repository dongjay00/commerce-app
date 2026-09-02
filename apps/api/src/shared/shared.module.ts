import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SystemClock } from './infrastructure/clock/system-clock';
import { DomainErrorRegistry } from './infrastructure/http/domain-error.registry';
import { registerKernelDomainErrors } from './infrastructure/http/kernel-domain-error-mappings';
import { UuidV7Generator } from './infrastructure/id/uuid-v7.generator';
import { NestEventEmitterTransport } from './infrastructure/messaging/nest-event-emitter.transport';
import { OutboxEventPublisher } from './infrastructure/outbox/outbox-event.publisher';
import { OutboxRelay } from './infrastructure/outbox/outbox-relay';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { PrismaTransactionManager } from './infrastructure/prisma/prisma-transaction-manager';
import { CLOCK, type Clock } from './kernel/ports/clock';
import { DOMAIN_EVENT_PUBLISHER } from './kernel/ports/domain-event.publisher';
import { EVENT_TRANSPORT, type EventTransport } from './kernel/ports/event-transport';
import { ID_GENERATOR, type IdGenerator } from './kernel/ports/id-generator';
import { TRANSACTION_MANAGER } from './kernel/ports/transaction-manager';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
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
  ],
  exports: [
    PrismaService,
    DomainErrorRegistry,
    OutboxRelay,
    CLOCK,
    ID_GENERATOR,
    EVENT_TRANSPORT,
    TRANSACTION_MANAGER,
    DOMAIN_EVENT_PUBLISHER,
  ],
})
export class SharedModule {}
