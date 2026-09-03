import type { CartLineDto } from '@commerce/contracts';
import type { ReactNode } from 'react';
import { formatMoney } from '@/shared/lib/format-money';

/**
 * `action` 슬롯이 있는 이유: 장바구니 화면은 "빼기" 버튼을, 주문 요약은 아무것도
 * 넣지 않는다. 슬롯이 없으면 두 줄 컴포넌트가 생기고 표기가 갈라진다.
 */
export function CartLineRow({ line, action }: { line: CartLineDto; action?: ReactNode }) {
  return (
    <tr>
      <td>{line.nameSnapshot}</td>
      <td>{formatMoney(line.unitPrice)}</td>
      <td>{line.quantity}개</td>
      <td>{formatMoney(line.subtotal)}</td>
      {action === undefined ? null : <td>{action}</td>}
    </tr>
  );
}
