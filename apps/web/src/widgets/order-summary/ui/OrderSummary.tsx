import type { OrderDto } from '@commerce/contracts';
import type { ReactNode } from 'react';
import { CartLineRow } from '@/entities/cart';
import { OrderStatusBadge } from '@/entities/order';
import { formatMoney } from '@/shared/lib/format-money';

/**
 * 주문 라인을 `CartLineRow`로 그리는 이유: 두 DTO의 표시 필드가 같고(이름·단가·수량·소계),
 * 표기를 두 벌 두면 장바구니와 주문서의 금액 표기가 갈라진다.
 *
 * 배송지는 `entities/address`의 `AddressLine`을 쓰지 않고 직접 그린다. 그쪽은
 * `AddressDto`(`line2?: string`)를 받아 `=== undefined`로 분기하는데, 주문의 배송지는
 * `line2: string | null`이다 — 넘기면 `null`이 문자열 "null"로 화면에 찍힌다.
 */
export function OrderSummary({ order, action }: { order: OrderDto; action?: ReactNode }) {
  return (
    <section>
      <h1>주문 {order.id}</h1>
      <p>
        상태: <OrderStatusBadge status={order.status} />
      </p>
      <h2>배송지</h2>
      <p>
        {order.shippingAddress.recipient} · {order.shippingAddress.phone}
        <br />[{order.shippingAddress.zip}] {order.shippingAddress.line1}
        {order.shippingAddress.line2 === null ? '' : ` ${order.shippingAddress.line2}`}
      </p>
      <h2>주문 상품</h2>
      <table>
        <thead>
          <tr>
            <th>상품</th>
            <th>단가</th>
            <th>수량</th>
            <th>소계</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <CartLineRow key={line.skuId} line={line} />
          ))}
        </tbody>
      </table>
      <p>총 {formatMoney(order.total)}</p>
      {action}
    </section>
  );
}
