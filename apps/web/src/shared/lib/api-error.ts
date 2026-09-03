import { ErrorCode, errorDtoSchema } from '@commerce/contracts';

export type ActionResult<T = void> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * 코드별 사용자 문구. **서버 메시지를 그대로 쓰지 않는다** — 서버 메시지에는
 * SKU id 같은 내부 식별자가 들어 있고(`재고가 부족합니다: 018f2b1c-...`),
 * 그것은 진단용이지 사용자에게 보일 것이 아니다.
 *
 * 모든 `ErrorCode`에 항목이 있어야 한다. 하나라도 빠지면 그 에러가 화면에
 * `undefined`로 나간다 — spec의 마지막 케이스가 그것을 고정한다.
 */
export const MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.VALIDATION_FAILED]: '입력값을 다시 확인해 주세요.',
  [ErrorCode.UNAUTHENTICATED]: '로그인이 필요합니다.',
  [ErrorCode.FORBIDDEN]: '접근 권한이 없습니다.',
  [ErrorCode.NOT_FOUND]: '찾을 수 없습니다.',
  [ErrorCode.DOMAIN_RULE_VIOLATED]: '요청을 처리할 수 없습니다.',
  [ErrorCode.QUANTITY_BELOW_MINIMUM]: '수량은 1개 이상이어야 합니다.',
  [ErrorCode.INSUFFICIENT_STOCK]: '재고가 부족합니다.',
  [ErrorCode.ORDER_NOT_CANCELLABLE]: '이 주문은 취소할 수 없습니다.',
  [ErrorCode.PAYMENT_DECLINED]: '결제가 거절되었습니다.',
  [ErrorCode.INTERNAL_ERROR]: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: '이미 가입된 이메일입니다.',
  [ErrorCode.INVALID_CREDENTIALS]: '이메일 또는 비밀번호가 올바르지 않습니다.',
  [ErrorCode.PASSWORD_POLICY_VIOLATED]: '비밀번호가 정책을 만족하지 않습니다.',
};

const failure = (code: ErrorCode): ActionResult<never> => ({
  ok: false,
  code,
  message: MESSAGES[code],
});

async function readJson(response: Response): Promise<unknown> {
  // 프록시의 HTML 502 같은 경우가 있다. 여기서 던지면 화면이 통째로 죽는다.
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * fetch 응답을 화면이 분기할 수 있는 값으로 바꾼다.
 *
 * **상태 코드로 분기하지 않는다** — 422 하나에 여러 원인이 들어가므로 `code`를 본다
 * (스펙 §8.6). 상태 코드는 성공/실패를 가르는 데만 쓴다.
 */
export async function readActionResult<T = void>(
  response: Response,
  parse?: (body: unknown) => T,
): Promise<ActionResult<T>> {
  if (response.ok) {
    if (parse === undefined) {
      return { ok: true, data: undefined as T };
    }
    return { ok: true, data: parse(await readJson(response)) };
  }

  const parsed = errorDtoSchema.safeParse(await readJson(response));
  return parsed.success ? failure(parsed.data.code) : failure(ErrorCode.INTERNAL_ERROR);
}
