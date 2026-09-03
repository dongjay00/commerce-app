import type { MoneyView } from '../../out/order.query';

export interface CartLineView {
  readonly skuId: string;
  readonly nameSnapshot: string;
  readonly unitPrice: MoneyView;
  readonly quantity: number;
  readonly subtotal: MoneyView;
}

export interface CartView {
  /** 장바구니가 아직 없으면 `null`. 빈 장바구니와 없는 장바구니를 구분한다. */
  readonly cartId: string | null;
  readonly lines: CartLineView[];
  readonly total: MoneyView;
  /** Catalog가 더 이상 팔지 않는 SKU. 클라이언트가 그 줄을 안내와 함께 표시한다. */
  readonly unavailableSkuIds: string[];
}

export interface GetCartQuery {
  execute(params: { customerId: string }): Promise<CartView>;
}

export const GET_CART_QUERY = Symbol('GetCartQuery');
