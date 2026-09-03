import 'server-only';
import {
  type AddressBody,
  type AddressDto,
  addressDtoSchema,
  ErrorCode,
} from '@commerce/contracts';
import { type ActionResult, MESSAGES, readActionResult } from '../shared/lib/api-error';
import { authedFetch } from './api-client';
import type { BffDeps } from './bff-deps';

export async function addAddressAction(
  input: AddressBody,
  deps: BffDeps,
): Promise<ActionResult<AddressDto>> {
  const response = await authedFetch(deps.baseUrl, deps.store)('/addresses', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  // `readActionResult`는 성공 경로에서 본문이 JSON이 아니면 `parse`에 `null`을
  // 그대로 넘긴다(가드 없음). `addressDtoSchema.parse`를 곧바로 넘기면 그 `null`이
  // 잡히지 않는 `ZodError`로 터진다 — `safeParse`를 넘겨 결과 자체를 감싸고,
  // 여기서 풀어내며 실패를 `ActionResult`로 변환한다.
  const result = await readActionResult(response, (body) => addressDtoSchema.safeParse(body));
  if (!result.ok) {
    return result;
  }
  if (!result.data.success) {
    return {
      ok: false,
      code: ErrorCode.INTERNAL_ERROR,
      message: MESSAGES[ErrorCode.INTERNAL_ERROR],
    };
  }
  return { ok: true, data: result.data.data };
}
