import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

// 공백만 있는 값을 거부한다. .min(1)은 ' '를 통과시킨다.
const requiredText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: '공백만으로는 채울 수 없습니다' });

export const addressBodySchema = z
  .object({
    label: requiredText(30),
    recipient: requiredText(50),
    phone: requiredText(30),
    zip: requiredText(10),
    line1: requiredText(200),
    line2: z.string().max(200).optional(),
  })
  .strict();

export const addressDtoSchema = addressBodySchema
  .extend({
    id: z.string().uuid(),
    isDefault: z.boolean(),
  })
  .strict();

export const addressListSchema = z.object({ addresses: z.array(addressDtoSchema) }).strict();

export type AddressBody = z.infer<typeof addressBodySchema>;
export type AddressDto = z.infer<typeof addressDtoSchema>;
export type AddressListDto = z.infer<typeof addressListSchema>;

export const addressContract = c.router({
  list: {
    method: 'GET',
    path: '/addresses',
    responses: { 200: addressListSchema, 401: errorDtoSchema },
    summary: '내 주소록. 기본 배송지가 먼저 온다',
  },
  add: {
    method: 'POST',
    path: '/addresses',
    body: addressBodySchema,
    responses: { 201: addressDtoSchema, 400: errorDtoSchema, 401: errorDtoSchema },
    summary: '주소 추가. 첫 주소는 자동으로 기본 배송지가 된다',
  },
  update: {
    method: 'PUT',
    path: '/addresses/:addressId',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: addressBodySchema,
    responses: {
      200: addressDtoSchema,
      400: errorDtoSchema,
      401: errorDtoSchema,
      404: errorDtoSchema,
    },
    summary: '주소 수정',
  },
  remove: {
    method: 'DELETE',
    path: '/addresses/:addressId',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: c.noBody(),
    responses: { 204: c.noBody(), 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '주소 삭제',
  },
  setDefault: {
    method: 'POST',
    path: '/addresses/:addressId/default',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: c.noBody(),
    responses: { 204: c.noBody(), 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '기본 배송지 지정. 이전 기본은 자동으로 해제된다',
  },
});
