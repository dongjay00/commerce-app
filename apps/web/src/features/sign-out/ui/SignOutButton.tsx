'use client';

import { useRouter } from 'next/navigation';
import { useSignOut } from '../model/use-sign-out';

/**
 * **feature가 라우팅을 하는 유일한 자리다.** 나머지 네 feature는 결과만 돌려주고
 * 이동은 `app/`이 한다. 여기서 깨는 이유: 이 버튼을 그리는 `Header`를 `app/layout.tsx`가
 * 렌더하는데 그것은 서버 컴포넌트라 함수를 prop으로 내려보낼 수 없다. 대안은 레이아웃을
 * 클라이언트 컴포넌트로 만드는 것인데 그러면 트리 전체가 클라이언트가 된다 —
 * 헤더 한 줄을 갱신하려고 치를 값이 아니다.
 *
 * `router.refresh()`가 필요한 이유: `signedIn`은 서버가 쿠키를 읽어 만든 값이라
 * 다시 렌더하지 않으면 로그아웃한 뒤에도 헤더에 "로그아웃"이 남는다.
 *
 * **성공 여부를 보지 않는다.** 실패해도 로그아웃된 화면으로 보내는 것이 맞다 —
 * 이유는 `useSignOut` 주석에 있다.
 */
export function SignOutButton({ onSignedOut }: { onSignedOut?: () => void }) {
  const { signOut, pending } = useSignOut();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        await signOut();
        onSignedOut?.();
        router.refresh();
      }}
    >
      {pending ? '로그아웃 중…' : '로그아웃'}
    </button>
  );
}
