import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다.
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../shared/kernel/ports/domain-event.publisher';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import { registerPaymentDomainErrors } from './adapters/in/http/payment-domain-error-mappings';
import { PgWebhookController } from './adapters/in/http/pg-webhook.controller';
import { PrismaPaymentRepository } from './adapters/out/persistence/prisma-payment.repository';
import { FakePgAdapter } from './adapters/out/pg/fake-pg.adapter';
import { AUTHORIZE_PAYMENT_USECASE } from './application/ports/in/authorize-payment.usecase';
import {
  HANDLE_PG_CALLBACK_USECASE,
  type HandlePgCallbackUseCase,
} from './application/ports/in/handle-pg-callback.usecase';
import {
  REFUND_PAYMENT_USECASE,
  type RefundPaymentUseCase,
} from './application/ports/in/refund-payment.usecase';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from './application/ports/out/payment.repository';
import { PG_CLIENT, type PgClient } from './application/ports/out/pg-client';
import { PaymentService } from './application/services/payment.service';

@Module({
  controllers: [PgWebhookController],
  providers: [
    { provide: PG_CLIENT, useClass: FakePgAdapter },
    // FakePgAdapter를 클래스 토큰으로도 해석 가능하게 둔다. E2E가 이 인스턴스를
    // 꺼내 scenario를 바꾼다(태스크 21). useExisting이라 인스턴스는 하나다.
    { provide: FakePgAdapter, useExisting: PG_CLIENT },
    {
      provide: PAYMENT_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaPaymentRepository(prisma),
      inject: [PrismaService],
    },
    {
      // 생성자: PaymentService(payments, pg, events, transactions, clock, ids)
      // inject 배열이 이 순서와 위치별로 일치해야 한다.
      provide: PaymentService,
      useFactory: (
        payments: PaymentRepository,
        pg: PgClient,
        events: DomainEventPublisher,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
      ) => new PaymentService(payments, pg, events, transactions, clock, ids),
      inject: [
        PAYMENT_REPOSITORY,
        PG_CLIENT,
        DOMAIN_EVENT_PUBLISHER,
        TRANSACTION_MANAGER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    { provide: AUTHORIZE_PAYMENT_USECASE, useExisting: PaymentService },
    {
      // PaymentService.refund는 RefundPaymentUseCase.execute와 이름이 다르다.
      // 얇은 어댑터 객체로 감싼다 — 서비스에 execute를 셋 만들 수는 없기 때문이다.
      provide: REFUND_PAYMENT_USECASE,
      useFactory: (service: PaymentService): RefundPaymentUseCase => ({
        execute: (command) => service.refund(command),
      }),
      inject: [PaymentService],
    },
    {
      provide: HANDLE_PG_CALLBACK_USECASE,
      useFactory: (service: PaymentService): HandlePgCallbackUseCase => ({
        execute: (command) => service.handleCallback(command),
      }),
      inject: [PaymentService],
    },
  ],
  exports: [AUTHORIZE_PAYMENT_USECASE, REFUND_PAYMENT_USECASE, FakePgAdapter],
})
export class PaymentModule {
  constructor(registry: DomainErrorRegistry) {
    registerPaymentDomainErrors(registry);
  }
}
