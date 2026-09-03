'use client';

import { ErrorCode, type SignInBody } from '@commerce/contracts';
import { useCallback, useState } from 'react';
import { MESSAGES, readActionResult } from '@/shared/lib/api-error';

export const SIGN_IN_PATH = '/api/auth/sign-in';

/**
 * 다섯 feature 훅이 공유하는 골격: 요청 → `pending` → 실패면 `error` 문구.
 *
 * **던지지 않는다.** 훅이 던지면 React 트리가 통째로 죽는다 — 네트워크 오류까지
 * `error` 상태로 흡수하고 호출자에게는 `boolean`으로 알린다.
 *
 * `error`를 요청 시작 시 지우는 이유: 지우지 않으면 성공한 뒤에도 빨간 문구가 남는다.
 */
export function useSignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (input: SignInBody): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(SIGN_IN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const result = await readActionResult(response);
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      return true;
    } catch {
      // fetch 자체가 거부된 경우(오프라인, DNS 실패). readActionResult는
      // 응답이 있어야 동작하므로 여기서만 잡을 수 있다.
      setError(MESSAGES[ErrorCode.INTERNAL_ERROR]);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { signIn, pending, error };
}
