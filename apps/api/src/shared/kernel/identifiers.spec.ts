import { describe, expect, it } from 'vitest';
import {
  AccountId,
  AddressId,
  CartId,
  CustomerId,
  InvalidIdError,
  OrderId,
  PaymentId,
  ProductId,
  ReservationId,
  SkuId,
} from './identifiers';

const VALID_UUID = '0192f3a0-1234-7abc-8def-0123456789ab';

describe('식별자', () => {
  it('UUID 형식이면 생성된다', () => {
    expect(OrderId.of(VALID_UUID)).toBe(VALID_UUID);
  });

  it('UUID가 아니면 거부한다', () => {
    expect(() => OrderId.of('order-1')).toThrow(InvalidIdError);
  });

  it('빈 문자열을 거부한다', () => {
    expect(() => OrderId.of('')).toThrow(InvalidIdError);
  });

  it('대문자 UUID는 대소문자를 보존한 채 그대로 반환한다', () => {
    const upper = VALID_UUID.toUpperCase();
    expect(SkuId.of(upper)).toBe(upper);
  });

  it('서로 다른 ID 타입은 컴파일 단계에서 섞이지 않는다', () => {
    // 런타임에는 같은 문자열이지만 타입이 다르다. 이 대입 자체가 타입 에러여야 하고,
    // 에러가 사라지면(=브랜드가 사라지면) @ts-expect-error가 typecheck를 실패시킨다.
    // @ts-expect-error CustomerId를 OrderId에 대입할 수 없다
    const wrong: OrderId = CustomerId.of(VALID_UUID);
    void wrong;
  });

  it('각 팩토리의 리터럴과 타입 별칭이 일치한다 — 복붙 실수를 컴파일 단계에서 잡는다', () => {
    // makeIdFactory('OrderId')에 넘긴 문자열 리터럴과 `type OrderId = Brand<string, 'OrderId'>`의
    // 리터럴은 사람이 손으로 맞춰야 한다. 아홉 쌍 중 하나라도 어긋나면 아래 대입이
    // typecheck 단계에서 실패한다 — 식별자가 늘어나는 계획 2~4에서의 복붙 실수를 막는다.
    const _orderId: OrderId = OrderId.of(VALID_UUID);
    const _cartId: CartId = CartId.of(VALID_UUID);
    const _skuId: SkuId = SkuId.of(VALID_UUID);
    const _productId: ProductId = ProductId.of(VALID_UUID);
    const _customerId: CustomerId = CustomerId.of(VALID_UUID);
    const _accountId: AccountId = AccountId.of(VALID_UUID);
    const _reservationId: ReservationId = ReservationId.of(VALID_UUID);
    const _paymentId: PaymentId = PaymentId.of(VALID_UUID);
    const _addressId: AddressId = AddressId.of(VALID_UUID);
    void [
      _orderId,
      _cartId,
      _skuId,
      _productId,
      _customerId,
      _accountId,
      _reservationId,
      _paymentId,
      _addressId,
    ];
  });
});
