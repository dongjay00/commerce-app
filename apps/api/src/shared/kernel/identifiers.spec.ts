import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import {
  AccountId,
  AddressId,
  CartId,
  CorruptedRecordError,
  CustomerId,
  InvalidIdError,
  OrderId,
  PaymentId,
  ProductId,
  ReservationId,
  SessionId,
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

  it('InvalidIdError는 DomainError다 — 검증 우회로 여기 도달해도 400을 정직하게 응답한다', () => {
    const error = new InvalidIdError('OrderId', 'x');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(InvalidIdError.CODE);
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

const VALID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b';
const BROKEN = 'not-a-uuid';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 "abstract 생성자 타입을
// non-abstract 생성자 타입에 대입할 수 없다"는 tsc 오류가 난다. 런타임 동작(instanceof
// 검사)은 abstract 여부와 무관하므로, 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

describe('경로별 실패 분류', () => {
  it('인바운드 경로(of)의 실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => AccountId.of(BROKEN)).toThrow(InvalidIdError);
    // DomainError 하위 클래스여야 예외 필터가 400으로 옮긴다.
    expect(() => AccountId.of(BROKEN)).toThrow(DomainErrorConstructor);
  });

  it('영속 복원 경로(fromPersistence)의 실패는 DomainError가 아니다 — 저장된 데이터가 깨진 것이다', () => {
    expect(() => AccountId.fromPersistence(BROKEN)).toThrow(CorruptedRecordError);
    // 여기가 이 테스트의 핵심이다. DomainError였다면 예외 필터가 400을 내보내
    // "당신의 요청이 잘못됐다"고 거짓말한다. 실제로는 우리 DB가 깨진 것이므로 500이 맞다.
    expect(() => AccountId.fromPersistence(BROKEN)).not.toThrow(DomainErrorConstructor);
  });

  it('두 경로 모두 정상 UUID는 통과시키고 값을 보존한다', () => {
    expect(AccountId.of(VALID)).toBe(VALID);
    expect(AccountId.fromPersistence(VALID)).toBe(VALID);
  });

  it('SessionId가 존재하고 다른 식별자와 섞이지 않는다', () => {
    const session: SessionId = SessionId.of(VALID);
    const customer: CustomerId = CustomerId.of(VALID);
    // @ts-expect-error SessionId는 CustomerId에 대입할 수 없다 (branded type).
    const wrong: CustomerId = session;
    expect(wrong).toBe(customer);
  });
});
