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
import { CatalogModule } from '../catalog';
import { CustomerModule } from '../customer';
import { InventoryModule } from '../inventory';
import { PaymentModule } from '../payment';
import { OrderingEventSubscriber } from './adapters/in/events/ordering-event.subscriber';
import { CartController } from './adapters/in/http/cart.controller';
import { OrderController } from './adapters/in/http/order.controller';
import { registerOrderingDomainErrors } from './adapters/in/http/ordering-domain-error-mappings';
import { InProcessCatalogAdapter } from './adapters/out/catalog/in-process-catalog.adapter';
import { InProcessCustomerAdapter } from './adapters/out/customer/in-process-customer.adapter';
import { InProcessInventoryAdapter } from './adapters/out/inventory/in-process-inventory.adapter';
import { InProcessPaymentAdapter } from './adapters/out/payment/in-process-payment.adapter';
import { PrismaCartRepository } from './adapters/out/persistence/prisma-cart.repository';
import { PrismaOrderQuery } from './adapters/out/persistence/prisma-order.query';
import { PrismaOrderRepository } from './adapters/out/persistence/prisma-order.repository';
import {
  ADD_ITEM_TO_CART_USECASE,
  type AddItemToCartUseCase,
} from './application/ports/in/add-item-to-cart.usecase';
import { CANCEL_ORDER_USECASE } from './application/ports/in/cancel-order.usecase';
import {
  CHANGE_CART_ITEM_QUANTITY_USECASE,
  type ChangeCartItemQuantityUseCase,
} from './application/ports/in/change-cart-item-quantity.usecase';
import { HANDLE_PAYMENT_REFUNDED_USECASE } from './application/ports/in/handle-payment-refunded.usecase';
import { HANDLE_STOCK_RESERVATION_EXPIRED_USECASE } from './application/ports/in/handle-stock-reservation-expired.usecase';
import { PLACE_ORDER_USECASE } from './application/ports/in/place-order.usecase';
import { GET_CART_QUERY } from './application/ports/in/queries/get-cart.query';
import { GET_ORDER_QUERY } from './application/ports/in/queries/get-order.query';
import { LIST_MY_ORDERS_QUERY } from './application/ports/in/queries/list-my-orders.query';
import {
  REMOVE_ITEM_FROM_CART_USECASE,
  type RemoveItemFromCartUseCase,
} from './application/ports/in/remove-item-from-cart.usecase';
import { CART_REPOSITORY, type CartRepository } from './application/ports/out/cart.repository';
import {
  CATALOG_PRICE_PROVIDER,
  type CatalogPriceProvider,
} from './application/ports/out/catalog-price.provider';
import {
  CUSTOMER_ADDRESS_PROVIDER,
  type CustomerAddressProvider,
} from './application/ports/out/customer-address.provider';
import {
  INVENTORY_RESERVER,
  type InventoryReserver,
} from './application/ports/out/inventory-reserver';
import { ORDER_QUERY, type OrderQuery } from './application/ports/out/order.query';
import { ORDER_REPOSITORY, type OrderRepository } from './application/ports/out/order.repository';
import { PAYMENT_GATEWAY, type PaymentGateway } from './application/ports/out/payment.gateway';
import { CancelOrderService } from './application/services/cancel-order.service';
import { GetCartService } from './application/services/get-cart.service';
import { GetOrderService } from './application/services/get-order.service';
import { OnPaymentRefundedService } from './application/services/handlers/on-payment-refunded.service';
import { OnStockReservationExpiredService } from './application/services/handlers/on-stock-reservation-expired.service';
import { ListMyOrdersService } from './application/services/list-my-orders.service';
import { ManageCartService } from './application/services/manage-cart.service';
import { PlaceOrderService } from './application/services/place-order.service';

@Module({
  // 네 ACL이 이 모듈들의 exports를 해석한다.
  imports: [CatalogModule, CustomerModule, InventoryModule, PaymentModule],
  controllers: [CartController, OrderController],
  providers: [
    // @OnEvent는 프로바이더에서 동작한다 — controllers가 아니다.
    OrderingEventSubscriber,

    { provide: CATALOG_PRICE_PROVIDER, useClass: InProcessCatalogAdapter },
    { provide: CUSTOMER_ADDRESS_PROVIDER, useClass: InProcessCustomerAdapter },
    { provide: INVENTORY_RESERVER, useClass: InProcessInventoryAdapter },
    { provide: PAYMENT_GATEWAY, useClass: InProcessPaymentAdapter },
    {
      provide: CART_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaCartRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: ORDER_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaOrderRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: ORDER_QUERY,
      useFactory: (prisma: PrismaService) => new PrismaOrderQuery(prisma),
      inject: [PrismaService],
    },
    {
      // 생성자: ManageCartService(carts, transactions, ids)
      provide: ManageCartService,
      useFactory: (carts: CartRepository, transactions: TransactionManager, ids: IdGenerator) =>
        new ManageCartService(carts, transactions, ids),
      inject: [CART_REPOSITORY, TRANSACTION_MANAGER, ID_GENERATOR],
    },
    {
      // 메서드 이름이 셋 다 execute일 수는 없으므로 얇은 객체로 감싼다.
      provide: ADD_ITEM_TO_CART_USECASE,
      useFactory: (service: ManageCartService): AddItemToCartUseCase => ({
        execute: (command) => service.addItem(command),
      }),
      inject: [ManageCartService],
    },
    {
      provide: REMOVE_ITEM_FROM_CART_USECASE,
      useFactory: (service: ManageCartService): RemoveItemFromCartUseCase => ({
        execute: (command) => service.removeItem(command),
      }),
      inject: [ManageCartService],
    },
    {
      provide: CHANGE_CART_ITEM_QUANTITY_USECASE,
      useFactory: (service: ManageCartService): ChangeCartItemQuantityUseCase => ({
        execute: (command) => service.changeQuantity(command),
      }),
      inject: [ManageCartService],
    },
    {
      // 생성자: PlaceOrderService(carts, orders, catalog, addresses, inventory,
      //                           payments, transactions, events, clock, ids)
      // **inject 배열이 이 순서와 위치별로 일치해야 한다.** 인자가 열 개이고 그중
      // 넷이 ACL이라, 하나만 뒤바뀌어도 타입 검사는 통과하고 런타임에만 깨진다.
      provide: PLACE_ORDER_USECASE,
      useFactory: (
        carts: CartRepository,
        orders: OrderRepository,
        catalog: CatalogPriceProvider,
        addresses: CustomerAddressProvider,
        inventory: InventoryReserver,
        payments: PaymentGateway,
        transactions: TransactionManager,
        events: DomainEventPublisher,
        clock: Clock,
        ids: IdGenerator,
      ) =>
        new PlaceOrderService(
          carts,
          orders,
          catalog,
          addresses,
          inventory,
          payments,
          transactions,
          events,
          clock,
          ids,
        ),
      inject: [
        CART_REPOSITORY,
        ORDER_REPOSITORY,
        CATALOG_PRICE_PROVIDER,
        CUSTOMER_ADDRESS_PROVIDER,
        INVENTORY_RESERVER,
        PAYMENT_GATEWAY,
        TRANSACTION_MANAGER,
        DOMAIN_EVENT_PUBLISHER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      // 생성자: CancelOrderService(orders, transactions, events, clock)
      provide: CANCEL_ORDER_USECASE,
      useFactory: (
        orders: OrderRepository,
        transactions: TransactionManager,
        events: DomainEventPublisher,
        clock: Clock,
      ) => new CancelOrderService(orders, transactions, events, clock),
      inject: [ORDER_REPOSITORY, TRANSACTION_MANAGER, DOMAIN_EVENT_PUBLISHER, CLOCK],
    },
    {
      // 생성자: OnPaymentRefundedService(orders, transactions, clock)
      provide: HANDLE_PAYMENT_REFUNDED_USECASE,
      useFactory: (orders: OrderRepository, transactions: TransactionManager, clock: Clock) =>
        new OnPaymentRefundedService(orders, transactions, clock),
      inject: [ORDER_REPOSITORY, TRANSACTION_MANAGER, CLOCK],
    },
    {
      // 생성자: OnStockReservationExpiredService(orders, transactions, events, clock)
      provide: HANDLE_STOCK_RESERVATION_EXPIRED_USECASE,
      useFactory: (
        orders: OrderRepository,
        transactions: TransactionManager,
        events: DomainEventPublisher,
        clock: Clock,
      ) => new OnStockReservationExpiredService(orders, transactions, events, clock),
      inject: [ORDER_REPOSITORY, TRANSACTION_MANAGER, DOMAIN_EVENT_PUBLISHER, CLOCK],
    },
    {
      // 생성자: GetCartService(carts, catalog)
      provide: GET_CART_QUERY,
      useFactory: (carts: CartRepository, catalog: CatalogPriceProvider) =>
        new GetCartService(carts, catalog),
      inject: [CART_REPOSITORY, CATALOG_PRICE_PROVIDER],
    },
    {
      provide: GET_ORDER_QUERY,
      useFactory: (query: OrderQuery) => new GetOrderService(query),
      inject: [ORDER_QUERY],
    },
    {
      provide: LIST_MY_ORDERS_QUERY,
      useFactory: (query: OrderQuery) => new ListMyOrdersService(query),
      inject: [ORDER_QUERY],
    },
  ],
})
export class OrderingModule {
  constructor(registry: DomainErrorRegistry) {
    registerOrderingDomainErrors(registry);
  }
}
