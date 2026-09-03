import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다.
import { SchedulerRegistry } from '@nestjs/schedule';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다.
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import {
  SCHEDULER_CONFIG,
  type SchedulerConfig,
} from '../../shared/infrastructure/scheduler/scheduler.config';
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
import { InventoryEventSubscriber } from './adapters/in/events/inventory-event.subscriber';
import { registerInventoryDomainErrors } from './adapters/in/http/inventory-domain-error-mappings';
import { StockController } from './adapters/in/http/stock.controller';
import { ReservationExpiryScheduler } from './adapters/in/scheduler/reservation-expiry.scheduler';
import { PessimisticStockRepository } from './adapters/out/persistence/pessimistic-stock.repository';
import { PrismaReservationRepository } from './adapters/out/persistence/prisma-reservation.repository';
import { CONFIRM_RESERVATION_USECASE } from './application/ports/in/confirm-reservation.usecase';
import {
  CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
  type ConfirmReservationsForOrderUseCase,
} from './application/ports/in/confirm-reservations-for-order.usecase';
import {
  EXPIRE_RESERVATIONS_USECASE,
  type ExpireReservationsUseCase,
} from './application/ports/in/expire-reservations.usecase';
import { GET_STOCK_QUERY } from './application/ports/in/queries/get-stock.query';
import { REGISTER_STOCK_USECASE } from './application/ports/in/register-stock.usecase';
import { RELEASE_RESERVATION_USECASE } from './application/ports/in/release-reservation.usecase';
import {
  RELEASE_RESERVATIONS_FOR_ORDER_USECASE,
  type ReleaseReservationsForOrderUseCase,
} from './application/ports/in/release-reservations-for-order.usecase';
import { RESERVE_STOCK_USECASE } from './application/ports/in/reserve-stock.usecase';
import { RESTOCK_USECASE } from './application/ports/in/restock.usecase';
import {
  RESTORE_RESERVATIONS_FOR_ORDER_USECASE,
  type RestoreReservationsForOrderUseCase,
} from './application/ports/in/restore-reservations-for-order.usecase';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from './application/ports/out/reservation.repository';
import { STOCK_REPOSITORY, type StockRepository } from './application/ports/out/stock.repository';
import { ConfirmReservationService } from './application/services/confirm-reservation.service';
import { ExpireReservationsService } from './application/services/expire-reservations.service';
import { GetStockService } from './application/services/get-stock.service';
import { RegisterStockService } from './application/services/register-stock.service';
import { ReleaseReservationService } from './application/services/release-reservation.service';
import { ReservationsForOrderService } from './application/services/reservations-for-order.service';
import { ReserveStockService } from './application/services/reserve-stock.service';
import { RestockService } from './application/services/restock.service';
import { readReservationTtl } from './reservation-ttl.config';

const RESERVATION_TTL = readReservationTtl(process.env);

@Module({
  controllers: [StockController],
  providers: [
    // @OnEvent는 프로바이더에서 동작한다 — controllers가 아니다.
    InventoryEventSubscriber,
    {
      // 기본 전략은 비관적 락이다(스펙 §6.4). 낙관적 어댑터로 바꾸려면 이 한 줄만
      // 고치면 되고, 도메인도 유스케이스도 테스트도 그대로다 — 그것이 포트 하나에
      // 어댑터 둘을 둔 이유이자 헥사고날의 값이 눈에 보이는 자리다.
      provide: STOCK_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PessimisticStockRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: RESERVATION_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaReservationRepository(prisma),
      inject: [PrismaService],
    },
    {
      // 생성자: ReserveStockService(stocks, reservations, transactions, clock, ids, ttl)
      // inject 배열이 이 순서와 위치별로 일치해야 한다. 같은 타입이 인접한 곳에서
      // 뒤바뀌면 타입 검사는 통과하고 런타임에만 깨진다.
      provide: RESERVE_STOCK_USECASE,
      useFactory: (
        stocks: StockRepository,
        reservations: ReservationRepository,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
      ) => new ReserveStockService(stocks, reservations, transactions, clock, ids, RESERVATION_TTL),
      inject: [STOCK_REPOSITORY, RESERVATION_REPOSITORY, TRANSACTION_MANAGER, CLOCK, ID_GENERATOR],
    },
    {
      // 생성자: ConfirmReservationService(stocks, reservations, transactions, clock)
      provide: CONFIRM_RESERVATION_USECASE,
      useFactory: (
        stocks: StockRepository,
        reservations: ReservationRepository,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ConfirmReservationService(stocks, reservations, transactions, clock),
      inject: [STOCK_REPOSITORY, RESERVATION_REPOSITORY, TRANSACTION_MANAGER, CLOCK],
    },
    {
      // 생성자: ReleaseReservationService(stocks, reservations, transactions, clock)
      provide: RELEASE_RESERVATION_USECASE,
      useFactory: (
        stocks: StockRepository,
        reservations: ReservationRepository,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ReleaseReservationService(stocks, reservations, transactions, clock),
      inject: [STOCK_REPOSITORY, RESERVATION_REPOSITORY, TRANSACTION_MANAGER, CLOCK],
    },
    {
      // 생성자: ExpireReservationsService(stocks, reservations, events, transactions, clock)
      provide: EXPIRE_RESERVATIONS_USECASE,
      useFactory: (
        stocks: StockRepository,
        reservations: ReservationRepository,
        events: DomainEventPublisher,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ExpireReservationsService(stocks, reservations, events, transactions, clock),
      inject: [
        STOCK_REPOSITORY,
        RESERVATION_REPOSITORY,
        DOMAIN_EVENT_PUBLISHER,
        TRANSACTION_MANAGER,
        CLOCK,
      ],
    },
    {
      // 생성자: RegisterStockService(stocks, transactions)
      provide: REGISTER_STOCK_USECASE,
      useFactory: (stocks: StockRepository, transactions: TransactionManager) =>
        new RegisterStockService(stocks, transactions),
      inject: [STOCK_REPOSITORY, TRANSACTION_MANAGER],
    },
    {
      // 생성자: RestockService(stocks, transactions)
      provide: RESTOCK_USECASE,
      useFactory: (stocks: StockRepository, transactions: TransactionManager) =>
        new RestockService(stocks, transactions),
      inject: [STOCK_REPOSITORY, TRANSACTION_MANAGER],
    },
    {
      // 생성자: ReservationsForOrderService(stocks, reservations, transactions, clock)
      provide: ReservationsForOrderService,
      useFactory: (
        stocks: StockRepository,
        reservations: ReservationRepository,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ReservationsForOrderService(stocks, reservations, transactions, clock),
      inject: [STOCK_REPOSITORY, RESERVATION_REPOSITORY, TRANSACTION_MANAGER, CLOCK],
    },
    {
      // 메서드 이름이 셋 다 execute일 수는 없으므로 얇은 객체로 감싼다.
      provide: CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
      useFactory: (service: ReservationsForOrderService): ConfirmReservationsForOrderUseCase => ({
        execute: (command) => service.confirm(command),
      }),
      inject: [ReservationsForOrderService],
    },
    {
      provide: RELEASE_RESERVATIONS_FOR_ORDER_USECASE,
      useFactory: (service: ReservationsForOrderService): ReleaseReservationsForOrderUseCase => ({
        execute: (command) => service.release(command),
      }),
      inject: [ReservationsForOrderService],
    },
    {
      provide: RESTORE_RESERVATIONS_FOR_ORDER_USECASE,
      useFactory: (service: ReservationsForOrderService): RestoreReservationsForOrderUseCase => ({
        execute: (command) => service.restore(command),
      }),
      inject: [ReservationsForOrderService],
    },
    {
      // 생성자: ReservationExpiryScheduler(registry, config, expireReservations)
      provide: ReservationExpiryScheduler,
      useFactory: (
        registry: SchedulerRegistry,
        config: SchedulerConfig,
        expireReservations: ExpireReservationsUseCase,
      ) => new ReservationExpiryScheduler(registry, config, expireReservations),
      inject: [SchedulerRegistry, SCHEDULER_CONFIG, EXPIRE_RESERVATIONS_USECASE],
    },
    {
      // 생성자: GetStockService(stocks) — 재고 조회는 애그리거트를 거친다.
      // 그 판단의 근거는 GetStockService의 doc 주석에 있다.
      provide: GET_STOCK_QUERY,
      useFactory: (stocks: StockRepository) => new GetStockService(stocks),
      inject: [STOCK_REPOSITORY],
    },
  ],
  exports: [
    RESERVE_STOCK_USECASE,
    CONFIRM_RESERVATION_USECASE,
    RELEASE_RESERVATION_USECASE,
    CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
    RELEASE_RESERVATIONS_FOR_ORDER_USECASE,
    RESTORE_RESERVATIONS_FOR_ORDER_USECASE,
  ],
})
export class InventoryModule {
  constructor(registry: DomainErrorRegistry) {
    registerInventoryDomainErrors(registry);
  }
}
