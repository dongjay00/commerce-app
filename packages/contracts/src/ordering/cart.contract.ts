import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';
// moneyDtoSchema는 shared/money.dto.ts에 이미 있다. 새로 만들지 않는다 —
// 두 개가 되면 하나만 고쳐지는 날이 온다.
import { moneyDtoSchema } from '../shared/money.dto';

const c = initContract();

export const cartLineDtoSchema = z
  .object({
    skuId: z.string().uuid(),
    nameSnapshot: z.string().min(1),
    unitPrice: moneyDtoSchema,
    quantity: z.number().int().positive(),
    subtotal: moneyDtoSchema,
  })
  .strict();

export const cartDtoSchema = z
  .object({
    /** 장바구니가 아직 없으면 null. 빈 장바구니와 없는 장바구니를 구분한다. */
    cartId: z.string().uuid().nullable(),
    lines: z.array(cartLineDtoSchema),
    total: moneyDtoSchema,
    /** Catalog가 더 이상 팔지 않는 SKU. 클라이언트가 그 줄을 안내와 함께 표시한다. */
    unavailableSkuIds: z.array(z.string().uuid()),
  })
  .strict();

/** `.int()`를 빠뜨리지 않는다 — 계획 1의 M6. 형식은 여기서 걸러야 한다. */
export const addCartItemBodySchema = z
  .object({ skuId: z.string().uuid(), quantity: z.number().int().positive() })
  .strict();

export const changeCartItemBodySchema = z
  .object({ quantity: z.number().int().positive() })
  .strict();

export type CartDto = z.infer<typeof cartDtoSchema>;
export type CartLineDto = z.infer<typeof cartLineDtoSchema>;
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;
export type ChangeCartItemBody = z.infer<typeof changeCartItemBodySchema>;

export const cartContract = c.router({
  get: {
    method: 'GET',
    path: '/cart',
    responses: { 200: cartDtoSchema, 401: errorDtoSchema },
    summary: '내 장바구니. 없어도 200이고 빈 장바구니를 준다',
  },
  addItem: {
    method: 'POST',
    path: '/cart/items',
    body: addCartItemBodySchema,
    responses: {
      204: c.noBody(),
      400: errorDtoSchema, // VALIDATION_FAILED
      401: errorDtoSchema,
      422: errorDtoSchema, // CART_LINE_LIMIT_EXCEEDED
    },
    summary: '장바구니에 담는다. 같은 SKU면 수량이 합쳐진다',
  },
  changeQuantity: {
    method: 'PUT',
    path: '/cart/items/:skuId',
    pathParams: z.object({ skuId: z.string().uuid() }),
    body: changeCartItemBodySchema,
    responses: {
      204: c.noBody(),
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema, // CART_NOT_FOUND / CART_LINE_NOT_FOUND
    },
    summary: '수량을 바꾼다',
  },
  removeItem: {
    method: 'DELETE',
    path: '/cart/items/:skuId',
    pathParams: z.object({ skuId: z.string().uuid() }),
    responses: { 204: c.noBody(), 400: errorDtoSchema, 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '줄을 뺀다',
  },
});
