import { DomainError } from '../../../../shared/kernel/domain-error';

/** 장바구니에 없는 SKU를 빼거나 수량을 바꾸려 했다. 404다. */
export class CartLineNotFoundError extends DomainError {
  static readonly CODE = 'CART_LINE_NOT_FOUND';
  readonly code = CartLineNotFoundError.CODE;

  constructor(skuId: string) {
    super(`장바구니에 없는 상품입니다: ${skuId}`);
  }
}

/**
 * 장바구니 줄 수 상한. 상한이 없으면 한 요청이 수천 줄을 만들고, 주문 시점에
 * 그 수만큼 재고 예약 트랜잭션이 열린다(태스크 12). 사가의 비용이 입력에 비례해
 * 무한히 커지는 것을 여기서 막는다.
 */
export class CartLineLimitExceededError extends DomainError {
  static readonly CODE = 'CART_LINE_LIMIT_EXCEEDED';
  readonly code = CartLineLimitExceededError.CODE;

  constructor(limit: number) {
    super(`장바구니에는 최대 ${limit}종류까지 담을 수 있습니다.`);
  }
}

/** 없는 장바구니에서 무언가를 빼려 했다. 클라이언트가 상태를 잘못 알고 있다는 신호다. */
export class CartNotFoundError extends DomainError {
  static readonly CODE = 'CART_NOT_FOUND';
  readonly code = CartNotFoundError.CODE;

  constructor(customerId: string) {
    super(`장바구니가 없습니다: ${customerId}`);
  }
}
