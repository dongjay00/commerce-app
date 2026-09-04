import type { TokenStore } from './token-store';

/**
 * 장바구니·배송지·주문 action이 공유하는 의존성. `cart-actions.ts`가 아니라
 * 이 파일에 두는 이유는 `order-actions.ts`(계획 5)가 이 타입만 필요할 뿐
 * `cart-actions.ts`를 통째로 import할 이유가 없기 때문이다.
 */
export interface BffDeps {
  readonly baseUrl: string;
  readonly store: TokenStore;
}
