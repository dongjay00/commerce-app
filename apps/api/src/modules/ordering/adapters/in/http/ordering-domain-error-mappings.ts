import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import {
  CartLineLimitExceededError,
  CartLineNotFoundError,
  CartNotFoundError,
} from '../../../domain/cart/cart.errors';
import {
  EmptyCartError,
  EmptyOrderError,
  InvalidShippingAddressError,
  MixedCurrencyOrderError,
  OrderConflictError,
  OrderNotFoundError,
  OrderNotOwnedError,
  OutOfStockError,
  ShippingAddressNotFoundError,
  UnknownSkuError,
} from '../../../domain/order/order.errors';

/**
 * 등록하지 않은 `DomainError`는 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.**
 *
 * 계획 1이 계약에 넣어둔 두 코드가 여기서 사용처를 얻는다:
 * `INSUFFICIENT_STOCK`(두 번째)과 `ORDER_NOT_CANCELLABLE`(첫 번째).
 */
export function registerOrderingDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(CartLineNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(CartNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(CartLineLimitExceededError.CODE, {
    status: 422,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(EmptyCartError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(EmptyOrderError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(MixedCurrencyOrderError.CODE, {
    status: 422,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(UnknownSkuError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(OutOfStockError.CODE, { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });
  registry.register(OrderConflictError.CODE, {
    status: 409,
    code: ErrorCode.ORDER_NOT_CANCELLABLE,
  });
  registry.register(OrderNotOwnedError.CODE, { status: 403, code: ErrorCode.FORBIDDEN });
  registry.register(OrderNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(ShippingAddressNotFoundError.CODE, {
    status: 404,
    code: ErrorCode.NOT_FOUND,
  });
  registry.register(InvalidShippingAddressError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
}
