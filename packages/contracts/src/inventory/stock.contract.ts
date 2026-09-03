import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

/**
 * `.int()`를 빠뜨리지 않는다. 계획 1의 M6이 남긴 교훈이다 — 비정수가 `Quantity`까지
 * 도달하면 도메인이 두 번째 그물이 되지만, 형식은 여기서 걸러야 한다.
 *
 * `available`은 서버가 계산해 내려주는 파생값이다. 클라이언트가 `onHand - reserved`를
 * 직접 빼게 두면 파생 규칙이 두 곳에 살게 된다.
 */
export const stockDtoSchema = z
  .object({
    skuId: z.string().uuid(),
    onHand: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  })
  .strict();

/** 등록 시점의 보유량은 0이어도 된다 — 품절 상태로 상품을 열어두는 경우다. */
export const registerStockBodySchema = z
  .object({
    skuId: z.string().uuid(),
    onHand: z.number().int().nonnegative(),
  })
  .strict();

/** 입고는 0을 거부한다. 아무 일도 하지 않으면서 성공을 돌려주는 요청이기 때문이다. */
export const restockBodySchema = z.object({ quantity: z.number().int().positive() }).strict();

export type StockDto = z.infer<typeof stockDtoSchema>;
export type RegisterStockBody = z.infer<typeof registerStockBodySchema>;
export type RestockBody = z.infer<typeof restockBodySchema>;

export const stockContract = c.router({
  register: {
    method: 'POST',
    path: '/stock',
    body: registerStockBodySchema,
    responses: {
      201: stockDtoSchema,
      400: errorDtoSchema, // VALIDATION_FAILED
      401: errorDtoSchema,
      409: errorDtoSchema, // STOCK_ALREADY_EXISTS
    },
    summary: 'SKU에 재고를 처음 등록한다',
  },
  get: {
    method: 'GET',
    path: '/stock/:skuId',
    pathParams: z.object({ skuId: z.string().uuid() }),
    responses: {
      200: stockDtoSchema,
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema, // STOCK_NOT_FOUND
    },
    summary: '재고 조회. available은 서버가 계산한다',
  },
  restock: {
    method: 'POST',
    path: '/stock/:skuId/restock',
    pathParams: z.object({ skuId: z.string().uuid() }),
    body: restockBodySchema,
    responses: {
      204: c.noBody(),
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema,
    },
    summary: '보유량을 늘린다. 예약량은 건드리지 않는다',
  },
});
