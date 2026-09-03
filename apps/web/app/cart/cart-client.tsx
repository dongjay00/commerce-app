'use client';

import type { AddressDto, CartDto } from '@commerce/contracts';
import { useRouter } from 'next/navigation';
import { CartView } from '@/views/cart';

/**
 * 주문이 끝나면 상세로 보낸다 — 결제가 거절돼도(`PAYMENT_FAILED`) 주문은 만들어졌고,
 * 그 사실을 보여주는 곳이 상세 화면이다(스펙 §9.10).
 */
export function CartClient({ cart, addresses }: { cart: CartDto; addresses: AddressDto[] }) {
  const router = useRouter();
  return (
    <CartView
      cart={cart}
      addresses={addresses}
      onPlaced={(result) => router.push(`/orders/${result.orderId}`)}
      onChanged={() => router.refresh()}
    />
  );
}
