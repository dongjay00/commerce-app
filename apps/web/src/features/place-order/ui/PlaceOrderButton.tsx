'use client';

import type { PlaceOrderResultDto } from '@commerce/contracts';
import { usePlaceOrder } from '../model/use-place-order';

/**
 * `addressId`가 없으면 버튼이 비활성이다 — 배송지를 고르지 않고 주문할 수 없다.
 * 서버도 400으로 막지만, 누를 수 있게 두면 사용자가 왜 실패했는지 모른다.
 *
 * **실패해도 화면을 다시 읽어야 한다.** 서버는 첫 트랜잭션에서 장바구니를 비운 뒤
 * 재고를 예약하므로, 재고 부족(409)으로 주문이 실패한 시점에 장바구니는 이미
 * 비어 있다. `onFailed`를 부르지 않으면 화면은 사라진 라인과 옛 총액을 계속
 * 그리고, 사용자가 다시 누르면 이번엔 빈 장바구니 오류가 난다(최종 리뷰 I2).
 *
 * `onFailed`가 **이유를 함께 넘기는** 이유: 그 새로고침이 이 컴포넌트를 언마운트해
 * 아래 경고를 지운다. 부모가 이유를 받아 두지 않으면 사용자는 장바구니가 왜
 * 비었는지 알 수 없다. 아래 경고는 부모 없이 이 버튼만 쓸 때의 기본 동작이다.
 */
export function PlaceOrderButton({
  addressId,
  onPlaced,
  onFailed,
}: {
  addressId: string | null;
  onPlaced: (result: PlaceOrderResultDto) => void;
  onFailed?: (message: string) => void;
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
          const outcome = await placeOrder(addressId);
          if (!outcome.ok) {
            onFailed?.(outcome.message);
            return;
          }
          onPlaced(outcome.result);
        }}
      >
        {pending ? '주문 중…' : '주문하기'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
