declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export class InvalidIdError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind}는 UUID 형식이어야 합니다: "${value}"`);
    this.name = 'InvalidIdError';
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
