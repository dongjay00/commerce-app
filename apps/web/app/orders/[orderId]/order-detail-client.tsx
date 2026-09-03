'use client';

import type { OrderDto } from '@commerce/contracts';
import { useRouter } from 'next/navigation';
import { OrderDetailView } from '@/views/order-detail';

/**
 * 취소 결과(`CANCELLED`·`REFUND_PENDING`)는 서버가 정하므로 화면을 다시 그린다 —
 * 응답의 status를 클라이언트가 들고 있으면 서버의 진짜 상태와 갈라진다.
 */
export function OrderDetailClient({ order }: { order: OrderDto }) {
  const router = useRouter();
  return <OrderDetailView order={order} onCancelled={() => router.refresh()} />;
}
