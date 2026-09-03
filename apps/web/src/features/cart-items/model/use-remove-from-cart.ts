'use client';

import { ErrorCode } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/** [[use-add-to-cart]]와 같은 골격 — 담기·빼기는 하나의 슬라이스가 나눠 갖는다. */
export function useRemoveFromCart() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeFromCart = useCallback(async (skuId: string): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/cart/items/${skuId}`, { method: 'DELETE' });
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

  return { removeFromCart, pending, error };
}
