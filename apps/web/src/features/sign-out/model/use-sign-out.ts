'use client';

import { useCallback, useState } from 'react';
import { readActionResult } from '@/shared/lib/api-error';

export const SIGN_OUT_PATH = '/api/auth/sign-out';

/**
 * [[use-sign-in]]과 같은 골격이되 **`error`가 없다.**
 *
 * 로그아웃 실패에는 문구를 띄우지 않는다 — 실패해도 사용자를 로그아웃된 화면으로
 * 보내는 것이 맞다. 쿠키는 이미 지워졌을 수 있고, 설령 남아 있어도 다음 요청이
 * 401을 받아 어차피 로그인 화면으로 간다. "로그아웃에 실패했습니다"를 띄우면
 * 사용자는 로그인 상태인지 아닌지 알 수 없는 자리에 갇힌다. 그래서 `SignOutButton`은
 * 성공 여부와 무관하게 `onSignedOut`을 부르고, 이 훅은 `boolean`만 돌려준다.
 *
 * **던지지 않는다.** 훅이 던지면 React 트리가 통째로 죽는다 — 네트워크 오류까지
 * `false`로 흡수한다.
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);

  const signOut = useCallback(async (): Promise<boolean> => {
    setPending(true);
    try {
      const response = await fetch(SIGN_OUT_PATH, { method: 'POST' });
      return (await readActionResult(response)).ok;
    } catch {
      // fetch 자체가 거부된 경우(오프라인, DNS 실패). readActionResult는
      // 응답이 있어야 동작하므로 여기서만 잡을 수 있다.
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { signOut, pending };
}
