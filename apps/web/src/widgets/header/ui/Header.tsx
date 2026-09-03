import Link from 'next/link';
import { SignOutButton } from '@/features/sign-out';

/**
 * `signedIn`을 prop으로 받는다 — 세션은 `src/server/`에만 있고 FSD 레이어는
 * 그것을 import할 수 없다(`no-server-code-in-fsd`). `app/layout.tsx`가 쿠키를
 * 읽어 넘긴다.
 *
 * `onSignedOut` 같은 콜백 prop은 두지 않는다. 이 위젯을 렌더하는 것은 서버
 * 컴포넌트인 `app/layout.tsx`라 함수를 내려보낼 수 없고, 로그아웃 뒤의 갱신은
 * `SignOutButton`이 스스로 한다.
 */
export function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header>
      <nav>
        <Link href="/">상품</Link>
        <Link href="/cart">장바구니</Link>
        {signedIn ? <SignOutButton /> : <Link href="/sign-in">로그인</Link>}
      </nav>
    </header>
  );
}
