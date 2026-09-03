import { notFound, redirect } from 'next/navigation';
import { apiBaseUrl, createApiClient, SessionExpiredError } from '@/server/api-client';
import { cookieTokenStore } from '@/server/session';
import { OrderDetailClient } from './order-detail-client';

/** `app/cart/page.tsx`와 같은 이유로 세션이 끊기면 로그인으로 보낸다. */
async function fetchOrder(orderId: string) {
  const client = createApiClient(apiBaseUrl(), await cookieTokenStore());
  try {
    return await client.order.get({ params: { orderId } });
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      redirect('/sign-in');
    }
    throw error;
  }
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const result = await fetchOrder(orderId);
  // 403(남의 주문)도 404로 덮는다 — 존재 여부를 알려줄 이유가 없다.
  if (result.status !== 200) {
    notFound();
  }
  return <OrderDetailClient order={result.body} />;
}
