import type { OrderDto } from '@commerce/contracts';
import { orderStatusLabel } from '../model/order-status';

export function OrderStatusBadge({ status }: { status: OrderDto['status'] }) {
  // data-status는 E2E와 컴포넌트 테스트가 라벨 문구에 묶이지 않게 하는 고리다.
  return <span data-status={status}>{orderStatusLabel(status)}</span>;
}
