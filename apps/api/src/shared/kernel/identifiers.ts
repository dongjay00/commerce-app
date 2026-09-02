import { DomainError } from './domain-error';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * UUID 형식이 아닌 값으로 브랜드 ID를 만들려 할 때 던진다. 스펙 §8.4상 UUID
 * 형식 검증은 어댑터(Zod)의 책임이라 여기 도달하는 건 원칙적으로 프로그래머
 * 에러다. 그래도 DomainError로 등록해 400을 낸다 — `GET /orders/abc`처럼 이미
 * 검증을 우회해 값 객체까지 도달한 잘못된 입력에 500을 돌려주는 건 클라이언트에게
 * 거짓을 말하는 것이기 때문이다(방어적 depth, 정직한 응답).
 */
export class InvalidIdError extends DomainError {
  static readonly CODE = 'INVALID_ID';
  readonly code = InvalidIdError.CODE;

  constructor(kind: string, value: string) {
    super(`${kind}는 UUID 형식이어야 합니다: "${value}"`);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeIdFactory<T extends string>(kind: T) {
  return {
    of(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new InvalidIdError(kind, value);
      }
      return value as Brand<string, T>;
    },
  };
}

export type OrderId = Brand<string, 'OrderId'>;
export type CartId = Brand<string, 'CartId'>;
export type SkuId = Brand<string, 'SkuId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type ReservationId = Brand<string, 'ReservationId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type AddressId = Brand<string, 'AddressId'>;

export const OrderId = makeIdFactory('OrderId');
export const CartId = makeIdFactory('CartId');
export const SkuId = makeIdFactory('SkuId');
export const ProductId = makeIdFactory('ProductId');
export const CustomerId = makeIdFactory('CustomerId');
export const AccountId = makeIdFactory('AccountId');
export const ReservationId = makeIdFactory('ReservationId');
export const PaymentId = makeIdFactory('PaymentId');
export const AddressId = makeIdFactory('AddressId');
