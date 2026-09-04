'use client';

import { ErrorCode, type PlaceOrderResultDto, placeOrderResultSchema } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/**
 * `placeOrder`의 결과. 다섯 형제 훅은 실패를 `null`로만 알리고 이유는 `error`에
 * 담아 두지만, 이 훅만 이유를 **돌려준다.** 이유가 있다: 서버는 주문 시도의 첫
 * 트랜잭션에서 장바구니를 비운 뒤 재고를 예약하므로, 재고 부족으로 실패하면
 * 화면이 빈 장바구니로 다시 그려지고 `PlaceOrderButton`은 그 안의 경고와 함께
 * 언마운트된다. 부모가 실패 이유를 계속 보여주려면 이유를 손에 쥐고 있어야
 * 한다(최종 리뷰 I2). 형태는 `readActionResult`의 `ok`와 같다 — 새 개념이 아니다.
 */
export type PlaceOrderOutcome =
  | { readonly ok: true; readonly result: PlaceOrderResultDto }
  | { readonly ok: false; readonly message: string };

/**
 * [[use-add-address]]와 같은 골격. **결제 거절도 성공이다** — 계획 4의 결정대로
 * 주문은 만들어졌고 번호가 있다. 화면은 `data.status`로 분기해 "결제가
 * 거절되었습니다"를 그린다. 여기서 오류로 취급하면 사용자에게 주문 번호를
 * 주지 못한다(Step 4-a의 회귀 테스트가 이것을 고정한다).
 *
 * `readActionResult`가 성공 경로에서 본문을 가드 없이 넘기므로 `safeParse`로
 * 직접 검사한다 — [[use-add-address]]와 같은 이유.
 *
 * `error`와 반환값의 `message`는 같은 문구다. `error`는 버튼이 스스로 그리는
 * 것이고, `message`는 버튼이 사라진 뒤에도 부모가 그릴 수 있게 하는 것이다.
 */
export function usePlaceOrder() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = useCallback(async (addressId: string): Promise<PlaceOrderOutcome> => {
    const fail = (message: string): PlaceOrderOutcome => {
      setError(message);
      return { ok: false, message };
    };

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressId }),
      });
      const result = await readActionResult<unknown>(response, (body) => body);
      if (!result.ok) {
        return fail(result.message);
      }
      const parsed = placeOrderResultSchema.safeParse(result.data);
      if (!parsed.success) {
        return fail(MESSAGES[ErrorCode.INTERNAL_ERROR]);
      }
      return { ok: true, result: parsed.data };
    } catch {
      return fail(MESSAGES[ErrorCode.INTERNAL_ERROR]);
    } finally {
      setPending(false);
    }
  }, []);

  return { placeOrder, pending, error };
}
