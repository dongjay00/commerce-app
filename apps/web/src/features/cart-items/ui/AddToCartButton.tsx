'use client';

import { useState } from 'react';
import { useAddToCart } from '../model/use-add-to-cart';

/**
 * 라우팅·새로고침을 하지 않는다 — `onAdded`로 알리고 `app/`이 결정한다.
 * 태스크 6이 `SignInForm`에 세운 규칙과 같다.
 */
export function AddToCartButton({ skuId, onAdded }: { skuId: string; onAdded?: () => void }) {
  const { addToCart, pending, error } = useAddToCart();
  const [quantity, setQuantity] = useState(1);

  return (
    <div>
      <label>
        수량
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (await addToCart(skuId, quantity)) {
            onAdded?.();
          }
        }}
      >
        {pending ? '담는 중…' : '장바구니에 담기'}
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
