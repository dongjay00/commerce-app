import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';

/**
 * `useRouter()`는 App Router 컨텍스트가 없으면 렌더 시점에 곧바로 던진다. 목
 * 라이브러리는 금지이므로(스펙 §9.1) **진짜 컨텍스트에 아무 일도 하지 않는 라우터를
 * 넣어준다** — 이것은 목이 아니라 React가 원래 제공하는 주입 지점이다.
 *
 * `SignOutButton`(그리고 그것을 그리는 `Header`)만 이것을 쓴다. feature가 라우팅을
 * 하는 자리는 거기 하나뿐이고, 그 예외의 이유는 `SignOutButton` 주석에 있다.
 */
export function stubRouter(overrides: Partial<AppRouterInstance> = {}): AppRouterInstance {
  return {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
    bfcacheId: 'test',
    ...overrides,
  };
}

export function WithAppRouter({
  children,
  router = stubRouter(),
}: {
  children: ReactNode;
  router?: AppRouterInstance;
}) {
  return <AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider>;
}
