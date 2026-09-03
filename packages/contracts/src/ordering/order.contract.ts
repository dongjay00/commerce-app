import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';
import { moneyDtoSchema } from '../shared/money.dto';

const c = initContract();

/**
 * `REFUND_PENDING`은 스펙 §5.4의 다이어그램에 없다 — 계획 4의 편차 1이다.
 * 취소 요청과 환불 완료 사이의 상태이고, 없으면 고객에게 거짓말을 하고
 * 취소가 멱등하지 않다.
 */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]);

export const shippingAddressDtoSchema = z
  .object({
    recipient: z.string().min(1),
    phone: z.string().min(1),
    zip: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().nullable(),
  })
  .strict();

export const orderLineDtoSchema = z
  .object({
    skuId: z.string().uuid(),
    nameSnapshot: z.string().min(1),
    unitPrice: moneyDtoSchema,
    quantity: z.number().int().positive(),
    subtotal: moneyDtoSchema,
  })
  .strict();

/**
 * **`customerId`가 없다.** `OrderView`에는 인가 비교용으로 있지만 와이어에는 나가지
 * 않는다 — 본인 주문만 볼 수 있으므로 클라이언트가 이미 아는 값이고, 담으면 응답이
 * 남의 고객 id를 실을 여지가 생긴다. 컨트롤러의 `toDto`가 그 필드를 떨어뜨린다.
 */
export const orderDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: orderStatusSchema,
    total: moneyDtoSchema,
    placedAt: z.string().datetime(),
    shippingAddress: shippingAddressDtoSchema,
    lines: z.array(orderLineDtoSchema).min(1),
  })
  .strict();

export const orderSummaryDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: orderStatusSchema,
    total: moneyDtoSchema,
    placedAt: z.string().datetime(),
    lineCount: z.number().int().positive(),
  })
  .strict();

export const orderListDtoSchema = z.object({ orders: z.array(orderSummaryDtoSchema) }).strict();

export const placeOrderBodySchema = z.object({ addressId: z.string().uuid() }).strict();

export const placeOrderResultSchema = z
  .object({ orderId: z.string().uuid(), status: orderStatusSchema })
  .strict();

export const cancelOrderResultSchema = z.object({ status: orderStatusSchema }).strict();

/** 쿼리 파라미터는 문자열로 도착하므로 coerce가 필요하다. */
export const listMyOrdersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type OrderDto = z.infer<typeof orderDtoSchema>;
export type OrderSummaryDto = z.infer<typeof orderSummaryDtoSchema>;
export type OrderListDto = z.infer<typeof orderListDtoSchema>;
export type PlaceOrderBody = z.infer<typeof placeOrderBodySchema>;
export type PlaceOrderResultDto = z.infer<typeof placeOrderResultSchema>;
export type CancelOrderResultDto = z.infer<typeof cancelOrderResultSchema>;
export type ListMyOrdersQueryParams = z.infer<typeof listMyOrdersQuerySchema>;

export const orderContract = c.router({
  place: {
    method: 'POST',
    path: '/orders',
    body: placeOrderBodySchema,
    responses: {
      /** 결제 거절이어도 201이다 — 주문은 만들어졌고 본문의 status가 결과를 말한다. */
      201: placeOrderResultSchema,
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema, // SHIPPING_ADDRESS_NOT_FOUND
      409: errorDtoSchema, // OUT_OF_STOCK
      422: errorDtoSchema, // EMPTY_CART / UNKNOWN_SKU
    },
    summary: '주문한다. 재고 예약과 결제 승인이 이 안에서 일어난다',
  },
  get: {
    method: 'GET',
    path: '/orders/:orderId',
    pathParams: z.object({ orderId: z.string().uuid() }),
    responses: {
      200: orderDtoSchema,
      400: errorDtoSchema,
      401: errorDtoSchema,
      403: errorDtoSchema, // ORDER_NOT_OWNED
      404: errorDtoSchema,
    },
    summary: '주문 상세. 본인 주문만 볼 수 있다',
  },
  list: {
    method: 'GET',
    path: '/orders',
    query: listMyOrdersQuerySchema,
    responses: { 200: orderListDtoSchema, 400: errorDtoSchema, 401: errorDtoSchema },
    summary: '내 주문 목록. 최신순',
  },
  cancel: {
    method: 'POST',
    path: '/orders/:orderId/cancel',
    pathParams: z.object({ orderId: z.string().uuid() }),
    body: c.noBody(),
    responses: {
      /** 204가 아니라 200인 이유: CANCELLED와 REFUND_PENDING을 구분해 보여줘야 한다. */
      200: cancelOrderResultSchema,
      400: errorDtoSchema,
      401: errorDtoSchema,
      403: errorDtoSchema,
      404: errorDtoSchema,
      409: errorDtoSchema, // ORDER_CONFLICT
    },
    summary: '주문을 취소한다. 결제 후면 환불이 시작된다',
  },
});
