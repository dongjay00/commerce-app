import { cookieTokenStore } from '@/server/session';
import { Header } from '@/widgets/header';
import './globals.css';

export const metadata = { title: 'Commerce' };

/**
 * `app/`이 세션을 읽어 `Header`에 넘긴다. FSD 레이어는 `src/server/`를 볼 수 없으므로
 * 이 한 줄이 그 경계를 넘는 유일한 지점이다(편차 1).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await (await cookieTokenStore()).read()) !== null;

  return (
    <html lang="ko">
      <body>
        <Header signedIn={signedIn} />
        <main>{children}</main>
      </body>
    </html>
  );
}
