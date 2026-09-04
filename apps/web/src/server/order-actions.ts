import 'server-only';
import {
  type CancelOrderResultDto,
  cancelOrderResultSchema,
  ErrorCode,
  type PlaceOrderBody,
  type PlaceOrderResultDto,
  placeOrderResultSchema,
} from '@commerce/contracts';
import { type ActionResult, MESSAGES, readActionResult } from '../shared/lib/api-error';
import { authedFetch } from './api-client';
import type { BffDeps } from './bff-deps';

const shapeMismatch = (): ActionResult<never> => ({
  ok: false,
  code: ErrorCode.INTERNAL_ERROR,
  message: MESSAGES[ErrorCode.INTERNAL_ERROR],
});

/**
 * 주문한다. **거절도 성공 응답이다** — 계획 4의 결정: 주문은 만들어졌고 번호가 있다.
 * 화면이 `data.status`로 분기해 "결제가 거절되었습니다"를 그린다.
 *
 * 응답을 계약 스키마로 파싱한다. 서버가 형태를 바꾸면 여기서 즉시 드러난다 —
 * `undefined` orderId로 라우팅하는 것보다 낫다.
 */
export async function placeOrderAction(
  input: PlaceOrderBody,
  deps: BffDeps,
): Promise<ActionResult<PlaceOrderResultDto>> {
  const response = await authedFetch(deps.baseUrl, deps.store)('/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const result = await readActionResult<unknown>(response, (body) => body);
  if (!result.ok) {
    return result;
  }
  const parsed = placeOrderResultSchema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data } : shapeMismatch();
}

export async function cancelOrderAction(
  orderId: string,
  deps: BffDeps,
): Promise<ActionResult<CancelOrderResultDto>> {
  const response = await authedFetch(deps.baseUrl, deps.store)(`/orders/${orderId}/cancel`, {
    method: 'POST',
  });
  const result = await readActionResult<unknown>(response, (body) => body);
  if (!result.ok) {
    return result;
  }
  const parsed = cancelOrderResultSchema.safeParse(result.data);
  return parsed.success ? { ok: true, data: parsed.data } : shapeMismatch();
}
