import { redirect } from 'next/navigation';
import { apiBaseUrl, createApiClient, SessionExpiredError } from '@/server/api-client';
import { cookieTokenStore } from '@/server/session';
import { CartClient } from './cart-client';

/**
 * 페치만 여기서 한다. `SessionExpiredError`는 세션이 없거나 갱신에 실패했다는 뜻이라
 * 로그인으로 보낸다 — `redirect`는 NEXT_REDIRECT를 던져 프레임워크가 처리하므로
 * 이 함수는 그 경로에서 값을 돌려주지 않는다.
 */
async function fetchCartPage() {
  const client = createApiClient(apiBaseUrl(), await cookieTokenStore());
  try {
    return await Promise.all([client.cart.get(), client.address.list()]);
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      redirect('/sign-in');
    }
    throw error;
  }
}

export default async function CartPage() {
  const [cart, addresses] = await fetchCartPage();
  if (cart.status !== 200 || addresses.status !== 200) {
    return <p role="alert">장바구니를 불러오지 못했습니다.</p>;
  }
  return <CartClient cart={cart.body} addresses={addresses.body.addresses} />;
}
