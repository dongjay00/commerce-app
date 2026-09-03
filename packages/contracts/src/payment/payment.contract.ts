import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

/**
 * PG가 호출하는 콜백. **인증 가드를 걸지 않는다** — PG는 우리 액세스 토큰을 갖고 있지
 * 않다. 실서비스라면 PG가 준 서명 키로 본문 서명을 검증해야 하고, 그것이 없는 지금은
 * 이 엔드포인트가 공개돼 있다는 사실을 컨트롤러 주석과 백로그에 적는다.
 */
export const pgCallbackBodySchema = z
  .object({
    orderId: z.string().uuid(),
    pgTxId: z.string().min(1).max(100),
    result: z.enum(['APPROVED', 'DECLINED']),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const pgCallbackResultSchema = z
  .object({
    /** 처음 보는 콜백이면 true, 이미 처리된 pgTxId면 false. PG가 재시도를 멈출 근거다. */
    accepted: z.boolean(),
  })
  .strict();

export type PgCallbackBody = z.infer<typeof pgCallbackBodySchema>;
export type PgCallbackResult = z.infer<typeof pgCallbackResultSchema>;

export const pgWebhookContract = c.router({
  callback: {
    method: 'POST',
    path: '/payments/pg-callback',
    body: pgCallbackBodySchema,
    responses: {
      200: pgCallbackResultSchema,
      400: errorDtoSchema, // VALIDATION_FAILED
      404: errorDtoSchema, // PAYMENT_NOT_FOUND
    },
    summary: 'PG 결제 결과 콜백. 같은 pgTxId는 한 번만 처리된다',
  },
});
