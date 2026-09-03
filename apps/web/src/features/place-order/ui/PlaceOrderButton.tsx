'use client';

import type { PlaceOrderResultDto } from '@commerce/contracts';
import { usePlaceOrder } from '../model/use-place-order';

/**
 * `addressId`가 없으면 버튼이 비활성이다 — 배송지를 고르지 않고 주문할 수 없다.
 * 서버도 400으로 막지만, 누를 수 있게 두면 사용자가 왜 실패했는지 모른다.
 */
export function PlaceOrderButton({
  addressId,
  onPlaced,
}: {
  addressId: string | null;
  onPlaced: (result: PlaceOrderResultDto) => void;
}) {
  const { placeOrder, pending, error } = usePlaceOrder();

  return (
    <div>
      <button
        type="button"
        disabled={pending || addressId === null}
        onClick={async () => {
          if (addressId === null) {
            return;
          }
          const result = await placeOrder(addressId);
          if (result !== null) {
            onPlaced(result);
          }
        }}
      >
        {pending ? '주문 중…' : '주문하기'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
