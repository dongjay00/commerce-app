'use client';

import { ErrorCode } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/**
 * 태스크 6이 세운 골격([[use-sign-in]])을 그대로 따른다: 던지지 않는다,
 * `pending`은 `finally`에서 끈다, `error`는 매 시도 시작 시 지운다.
 */
export function useAddToCart() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addToCart = useCallback(async (skuId: string, quantity: number): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuId, quantity }),
      });
      const result = await readActionResult(response);
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      return true;
    } catch {
      setError(MESSAGES[ErrorCode.INTERNAL_ERROR]);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { addToCart, pending, error };
}
