import { describe, expect, it } from 'vitest';
import { ADD_ITEM_TO_CART_USECASE } from './in/add-item-to-cart.usecase';
import { CANCEL_ORDER_USECASE } from './in/cancel-order.usecase';
import { CHANGE_CART_ITEM_QUANTITY_USECASE } from './in/change-cart-item-quantity.usecase';
import { HANDLE_PAYMENT_REFUNDED_USECASE } from './in/handle-payment-refunded.usecase';
import { HANDLE_STOCK_RESERVATION_EXPIRED_USECASE } from './in/handle-stock-reservation-expired.usecase';
import { PLACE_ORDER_USECASE } from './in/place-order.usecase';
import { REMOVE_ITEM_FROM_CART_USECASE } from './in/remove-item-from-cart.usecase';
import { CART_REPOSITORY } from './out/cart.repository';
import { CATALOG_PRICE_PROVIDER } from './out/catalog-price.provider';
import { CUSTOMER_ADDRESS_PROVIDER } from './out/customer-address.provider';
import { INVENTORY_RESERVER } from './out/inventory-reserver';
import { ORDER_REPOSITORY } from './out/order.repository';
import { PAYMENT_GATEWAY } from './out/payment.gateway';

/**
 * 포트 토큰의 정체성을 고정한다.
 *
 * 커버리지: 포트 파일은 인터페이스와 `Symbol` 하나가 전부라 `import type`으로만
 * 쓰이면 런타임에 로드되지 않고, Vitest의 `coverage.all`이 켜져 있어 0%로 잡혀
 * application 임계값(90/85)을 실패시킨다.
 *
 * 태스크 11~14가 포트를 더할 때마다 이 목록을 확장한다.
 */
describe('Ordering 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: CART_REPOSITORY, name: 'CartRepository' },
    { token: ORDER_REPOSITORY, name: 'OrderRepository' },
    { token: CATALOG_PRICE_PROVIDER, name: 'CatalogPriceProvider' },
    { token: CUSTOMER_ADDRESS_PROVIDER, name: 'CustomerAddressProvider' },
    { token: INVENTORY_RESERVER, name: 'InventoryReserver' },
    { token: PAYMENT_GATEWAY, name: 'PaymentGateway' },
    { token: ADD_ITEM_TO_CART_USECASE, name: 'AddItemToCartUseCase' },
    { token: REMOVE_ITEM_FROM_CART_USECASE, name: 'RemoveItemFromCartUseCase' },
    { token: CHANGE_CART_ITEM_QUANTITY_USECASE, name: 'ChangeCartItemQuantityUseCase' },
    { token: PLACE_ORDER_USECASE, name: 'PlaceOrderUseCase' },
    { token: CANCEL_ORDER_USECASE, name: 'CancelOrderUseCase' },
    { token: HANDLE_PAYMENT_REFUNDED_USECASE, name: 'HandlePaymentRefundedUseCase' },
    {
      token: HANDLE_STOCK_RESERVATION_EXPIRED_USECASE,
      name: 'HandleStockReservationExpiredUseCase',
    },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('토큰들은 서로 다르다', () => {
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);
  });
});
