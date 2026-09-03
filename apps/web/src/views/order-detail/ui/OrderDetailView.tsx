'use client';

import type { CancelOrderResultDto, OrderDto } from '@commerce/contracts';
import { isOrderCancellable } from '@/entities/order';
import { CancelOrderButton } from '@/features/cancel-order';
import { OrderSummary } from '@/widgets/order-summary';

/**
 * `'결제가 거절되었습니다.'`는 스펙 §9.10의 E2E 예시가 그대로 찾는 문구다 — 바꾸지 않는다.
 */
export function OrderDetailView({
  order,
  onCancelled,
}: {
  order: OrderDto;
  onCancelled: (result: CancelOrderResultDto) => void;
}) {
  return (
    <>
      {order.status === 'PAYMENT_FAILED' ? <p role="alert">결제가 거절되었습니다.</p> : null}
      <OrderSummary
        order={order}
        action={
          isOrderCancellable(order.status) ? (
            <CancelOrderButton orderId={order.id} onCancelled={onCancelled} />
          ) : null
        }
      />
    </>
  );
}
