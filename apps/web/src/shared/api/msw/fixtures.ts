import type { AddressDto, CartDto, OrderDto, ProductDto } from '@commerce/contracts';

/**
 * UUID 리터럴은 유효한 16진수여야 하고 마지막 그룹이 정확히 12자여야 한다 —
 * 백엔드의 값 객체가 형식을 검증한다. 계획 3·4에서 `l`, `ver`, `dup` 때문에
 * 세 번 깨졌으므로 16진수 안에서만 구분한다.
 */
export const PRODUCT_ID = '018f2b1c-4a5d-7e6f-8a9b-0f1a00000001';
export const SKU_ID = '018f2b1c-4a5d-7e6f-8a9b-0f1c00000001';
export const SKU_ID_2 = '018f2b1c-4a5d-7e6f-8a9b-0f1c00000002';
export const ORDER_ID = '018f2b1c-4a5d-7e6f-8a9b-0f1b00000001';
export const ADDRESS_ID = '018f2b1c-4a5d-7e6f-8a9b-0f1e00000001';
export const CART_ID = '018f2b1c-4a5d-7e6f-8a9b-0f1d00000001';

export const KRW = (amount: string) => ({ amount, currency: 'KRW' as const });

export function aProductDto(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    id: PRODUCT_ID,
    name: '티셔츠',
    status: 'ACTIVE',
    skus: [
      { id: SKU_ID, code: 'RED-M', price: KRW('12000') },
      { id: SKU_ID_2, code: 'RED-L', price: KRW('13000') },
    ],
    ...overrides,
  };
}

export function aCartDto(overrides: Partial<CartDto> = {}): CartDto {
  return {
    cartId: CART_ID,
    lines: [
      {
        skuId: SKU_ID,
        nameSnapshot: '티셔츠 RED-M',
        unitPrice: KRW('12000'),
        quantity: 2,
        subtotal: KRW('24000'),
      },
    ],
    total: KRW('24000'),
    unavailableSkuIds: [],
    ...overrides,
  };
}

export function anOrderDto(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: ORDER_ID,
    status: 'PAID',
    total: KRW('24000'),
    placedAt: '2026-03-01T00:00:00.000Z',
    shippingAddress: {
      recipient: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      line1: '서울시 강남구 테헤란로 1',
      line2: null,
    },
    lines: [
      {
        skuId: SKU_ID,
        nameSnapshot: '티셔츠 RED-M',
        unitPrice: KRW('12000'),
        quantity: 2,
        subtotal: KRW('24000'),
      },
    ],
    ...overrides,
  };
}

export function anAddressDto(overrides: Partial<AddressDto> = {}): AddressDto {
  return {
    id: ADDRESS_ID,
    label: '집',
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
    isDefault: true,
    ...overrides,
  };
}
