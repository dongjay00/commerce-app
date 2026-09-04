'use client';

import type { CancelOrderResultDto } from '@commerce/contracts';
import { useCancelOrder } from '../model/use-cancel-order';

/**
 * 확인 절차 없이 바로 취소를 보낸다. `window.confirm`을 쓰면 테스트에서
 * 그것을 목해야 하는데(금지 — 스펙 §9.1) 취소는 되돌릴 수 있는 작업이다
 * (결제 후라면 환불이 시작될 뿐 주문 자체가 사라지지 않는다) — 위험이
 * 낮으므로 확인 없이 진행한다.
 */
export function CancelOrderButton({
  orderId,
  onCancelled,
}: {
  orderId: string;
  onCancelled: (result: CancelOrderResultDto) => void;
}) {
  const { cancelOrder, pending, error } = useCancelOrder();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          const result = await cancelOrder(orderId);
          if (result !== null) {
            onCancelled(result);
          }
        }}
      >
        {pending ? '취소 중…' : '주문 취소'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
