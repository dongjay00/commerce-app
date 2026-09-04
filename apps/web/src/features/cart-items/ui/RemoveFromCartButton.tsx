'use client';

import { useRemoveFromCart } from '../model/use-remove-from-cart';

/**
 * 라벨 `빼기`는 태스크 14의 Playwright E2E가
 * `getByRole('button', { name: '빼기' })`로 그대로 찾는다 — 바꾸지 않는다.
 */
export function RemoveFromCartButton({
  skuId,
  onRemoved,
}: {
  skuId: string;
  onRemoved?: () => void;
}) {
  const { removeFromCart, pending, error } = useRemoveFromCart();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (await removeFromCart(skuId)) {
            onRemoved?.();
          }
        }}
      >
        빼기
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
