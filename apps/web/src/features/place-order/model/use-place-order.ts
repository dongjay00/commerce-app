'use client';

import { ErrorCode, type PlaceOrderResultDto, placeOrderResultSchema } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/**
 * [[use-add-address]]와 같은 골격. **결제 거절도 성공이다** — 계획 4의 결정대로
 * 주문은 만들어졌고 번호가 있다. 화면은 `data.status`로 분기해 "결제가
 * 거절되었습니다"를 그린다. 여기서 오류로 취급하면 사용자에게 주문 번호를
 * 주지 못한다(Step 4-a의 회귀 테스트가 이것을 고정한다).
 *
 * `readActionResult`가 성공 경로에서 본문을 가드 없이 넘기므로 `safeParse`로
 * 직접 검사한다 — [[use-add-address]]와 같은 이유.
 */
export function usePlaceOrder() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = useCallback(async (addressId: string): Promise<PlaceOrderResultDto | null> => {
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
        setError(result.message);
        return null;
      }
      const parsed = placeOrderResultSchema.safeParse(result.data);
      if (!parsed.success) {
        setError(MESSAGES[ErrorCode.INTERNAL_ERROR]);
        return null;
      }
      return parsed.data;
    } catch {
      setError(MESSAGES[ErrorCode.INTERNAL_ERROR]);
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  return { placeOrder, pending, error };
}
