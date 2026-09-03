import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';
import { moneyDtoSchema } from '../shared/money.dto';

const c = initContract();

export const skuDtoSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1).max(50),
    price: moneyDtoSchema,
  })
  .strict();

export const productDtoSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    skus: z.array(skuDtoSchema),
  })
  .strict();

export const productListSchema = z.object({ products: z.array(productDtoSchema) }).strict();

/**
 * `skus`의 `.min(1)`은 형식 검증인가 도메인 규칙인가? **형식이다.**
 * "빈 배열은 이 요청의 형태가 아니다"는 전송 계약의 문제이고, "SKU 없는 상품은
 * 존재할 수 없다"는 `Product.register`가 지킨다. 둘 다 있는 것이 맞다.
 *
 * 계획 2가 비밀번호 길이에서 내린 판단(정책은 도메인, 형태는 Zod)과 모순되지 않는다 —
 * 저기서는 **정책 숫자**가 Zod로 샜던 것이고 여기서는 배열의 형태다.
 */
export const registerProductBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    skus: z
      .array(z.object({ code: z.string().min(1).max(50), price: moneyDtoSchema }).strict())
      .min(1),
  })
  .strict();

export const updatePriceBodySchema = z.object({ price: moneyDtoSchema }).strict();

/** 쿼리 파라미터는 문자열로 도착하므로 coerce가 필요하다. limit 상한이 없으면 한 방으로 DB를 훑는다. */
export const searchProductsQuerySchema = z
  .object({
    keyword: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type SkuDto = z.infer<typeof skuDtoSchema>;
export type ProductDto = z.infer<typeof productDtoSchema>;
export type ProductListDto = z.infer<typeof productListSchema>;
export type RegisterProductBody = z.infer<typeof registerProductBodySchema>;
export type UpdatePriceBody = z.infer<typeof updatePriceBodySchema>;
export type SearchProductsQueryParams = z.infer<typeof searchProductsQuerySchema>;

export const productContract = c.router({
  register: {
    method: 'POST',
    path: '/products',
    body: registerProductBodySchema,
    responses: {
      201: productDtoSchema,
      400: errorDtoSchema, // VALIDATION_FAILED / INVALID_PRODUCT / INVALID_PRICE
      401: errorDtoSchema,
      409: errorDtoSchema, // DUPLICATE_SKU_CODE
    },
    summary: '상품과 SKU를 등록한다',
  },
  updatePrice: {
    method: 'PUT',
    path: '/products/:productId/skus/:skuId/price',
    pathParams: z.object({ productId: z.string().uuid(), skuId: z.string().uuid() }),
    body: updatePriceBodySchema,
    responses: {
      204: c.noBody(),
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema, // PRODUCT_NOT_FOUND / SKU_NOT_FOUND
    },
    summary: 'SKU 가격을 변경한다',
  },
  get: {
    method: 'GET',
    path: '/products/:productId',
    pathParams: z.object({ productId: z.string().uuid() }),
    responses: { 200: productDtoSchema, 400: errorDtoSchema, 404: errorDtoSchema },
    summary: '상품 상세',
  },
  search: {
    method: 'GET',
    path: '/products',
    query: searchProductsQuerySchema,
    responses: { 200: productListSchema, 400: errorDtoSchema },
    summary: 'ACTIVE 상품 검색. 이름 오름차순',
  },
});
