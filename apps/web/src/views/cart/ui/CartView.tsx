'use client';

import type { AddressDto, CartDto, PlaceOrderResultDto } from '@commerce/contracts';
import { useState } from 'react';
import { CartLineRow } from '@/entities/cart';
import { RemoveFromCartButton } from '@/features/cart-items';
import { AddressPicker } from '@/features/manage-addresses';
import { PlaceOrderButton } from '@/features/place-order';
import { formatMoney } from '@/shared/lib/format-money';

/**
 * 선택된 배송지 id를 여기서 들고 있다 — `app/cart/page.tsx`로 올리면 그 페이지가
 * 클라이언트 컴포넌트가 되고 페치를 못 한다(편차 1).
 */
export function CartView({
  cart,
  addresses,
  onPlaced,
  onChanged,
}: {
  cart: CartDto;
  addresses: AddressDto[];
  onPlaced: (result: PlaceOrderResultDto) => void;
  onChanged?: () => void;
}) {
  const [addressId, setAddressId] = useState<string | null>(
    addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? null,
  );

  if (cart.lines.length === 0) {
    return (
      <>
        <h1>장바구니</h1>
        <p>장바구니가 비어 있습니다.</p>
      </>
    );
  }

  return (
    <>
      <h1>장바구니</h1>
      {cart.unavailableSkuIds.length === 0 ? null : (
        <p role="alert">
          판매가 중지된 상품 {cart.unavailableSkuIds.length}개는 주문에서 제외됩니다.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>상품</th>
            <th>단가</th>
            <th>수량</th>
            <th>소계</th>
            <th>{''}</th>
          </tr>
        </thead>
        <tbody>
          {cart.lines.map((line) => (
            <CartLineRow
              key={line.skuId}
              line={line}
              action={<RemoveFromCartButton skuId={line.skuId} onRemoved={onChanged} />}
            />
          ))}
        </tbody>
      </table>
      <p>총 {formatMoney(cart.total)}</p>

      <h2>배송지</h2>
      <AddressPicker
        addresses={addresses}
        selectedId={addressId}
        onSelect={setAddressId}
        onAdded={onChanged}
      />

      <PlaceOrderButton addressId={addressId} onPlaced={onPlaced} />
    </>
  );
}
