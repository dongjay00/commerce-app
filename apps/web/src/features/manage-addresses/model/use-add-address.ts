'use client';

import {
  type AddressBody,
  type AddressDto,
  addressDtoSchema,
  ErrorCode,
} from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

/**
 * [[use-sign-in]]과 같은 골격이되 성공 시 `AddressDto`를 돌려준다 — 방금 만든
 * 주소를 `AddressPicker`가 바로 선택해야 하기 때문이다.
 *
 * `readActionResult`는 성공 경로에서 본문이 계약 형태가 아니어도 `parse`에
 * 그대로 넘긴다(가드 없음, [[api-error]] 참고). `safeParse`로 감싸 여기서
 * 직접 검사한다 — `apps/web/src/server/address-actions.ts`와 같은 이유다.
 */
export function useAddAddress() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAddress = useCallback(async (input: AddressBody): Promise<AddressDto | null> => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const result = await readActionResult<unknown>(response, (body) => body);
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      const parsed = addressDtoSchema.safeParse(result.data);
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

  return { addAddress, pending, error };
}
