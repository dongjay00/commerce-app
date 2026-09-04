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

  /**
   * 주문이 실패한 이유. **여기에 두는 이유**: 실패하면 서버 장바구니가 이미 비어
   * 있어 `onChanged`가 화면을 빈 장바구니로 다시 그리고, 그 과정에서
   * `PlaceOrderButton`이 자기 경고와 함께 사라진다. 이유를 여기 담아 두지 않으면
   * 사용자는 장바구니가 왜 비었는지 모른 채 남는다(최종 리뷰 I2).
   *
   * 아래 빈 장바구니 분기에서만 그린다 — 라인이 있는 분기에서는
   * `PlaceOrderButton`이 같은 문구를 그리므로, 두 곳이 동시에 켜지는 일은 없다.
   */
  const [orderError, setOrderError] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <>
        <h1>장바구니</h1>
        {orderError === null ? null : <p role="alert">{orderError}</p>}
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

      {/* 주문이 실패하면 서버 장바구니가 이미 비어 있다 — 이유를 붙잡고 다시 읽는다(최종 리뷰 I2). */}
      <PlaceOrderButton
        addressId={addressId}
        onPlaced={onPlaced}
        onFailed={(message) => {
          setOrderError(message);
          onChanged?.();
        }}
      />
    </>
  );
}
