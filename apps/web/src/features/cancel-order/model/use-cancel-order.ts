'use client';

import { type CancelOrderResultDto, cancelOrderResultSchema, ErrorCode } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/**
 * [[use-place-order]]와 같은 골격. `status`가 `CANCELLED`와 `REFUND_PENDING`을
 * 가른다 — 화면이 "취소되었습니다"와 "환불 처리 중입니다"를 고를 재료다.
 * 도메인 실패는 `ORDER_NOT_CANCELLABLE`(409)과 `FORBIDDEN`(403)이다.
 */
export function useCancelOrder() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelOrder = useCallback(async (orderId: string): Promise<CancelOrderResultDto | null> => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      const result = await readActionResult<unknown>(response, (body) => body);
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      const parsed = cancelOrderResultSchema.safeParse(result.data);
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

  return { cancelOrder, pending, error };
}
