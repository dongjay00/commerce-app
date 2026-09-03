import 'server-only';
import { ErrorCode } from '@commerce/contracts';
import type { ActionResult } from '../shared/lib/api-error';
import { SessionExpiredError } from './api-client';

/**
 * `ActionResult`를 HTTP 응답으로 바꾼다. 코드→상태 매핑이 여기 한 곳에 산다.
 *
 * **BFF는 계산하지 않는다**(스펙 §8.1) — 이 매핑은 계산이 아니라 형태 변환이다.
 * 어느 코드가 어느 상태인지는 이미 Nest가 정했고, 여기서는 그것을 브라우저가
 * 이해하는 모양으로 옮길 뿐이다.
 */
const STATUS: Partial<Record<ErrorCode, number>> = {
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.INSUFFICIENT_STOCK]: 409,
  [ErrorCode.ORDER_NOT_CANCELLABLE]: 409,
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: 409,
  [ErrorCode.DOMAIN_RULE_VIOLATED]: 422,
  [ErrorCode.QUANTITY_BELOW_MINIMUM]: 422,
  [ErrorCode.PASSWORD_POLICY_VIOLATED]: 422,
  [ErrorCode.PAYMENT_DECLINED]: 422,
};

export function toResponse(result: ActionResult<unknown>): Response {
  if (result.ok) {
    return result.data === undefined
      ? new Response(null, { status: 204 })
      : Response.json(result.data, { status: 200 });
  }
  return Response.json(
    { code: result.code, message: result.message },
    { status: STATUS[result.code] ?? 500 },
  );
}

/**
 * 세션 만료를 401로 바꾼다. 각 Route Handler가 `try`/`catch`를 쓰는 대신
 * 이 래퍼를 통과시킨다 — 여덟 곳에 같은 `catch`를 쓰면 하나를 빠뜨린다.
 */
export async function handleBff(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      return Response.json(
        { code: ErrorCode.UNAUTHENTICATED, message: '로그인이 필요합니다.' },
        { status: 401 },
      );
    }
    throw error;
  }
}
