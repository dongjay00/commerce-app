import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import {
  InsufficientStockError,
  ReservationConflictError,
  ReservationNotFoundError,
  StockAlreadyExistsError,
  StockContentionError,
  StockNotFoundError,
} from '../../../domain/stock.errors';

/**
 * 등록하지 않은 `DomainError`는 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.** `app.module.spec.ts`가 조립된
 * 레지스트리를 직접 resolve해 여기 등록한 매핑을 확인한다.
 *
 * `ErrorCode.INSUFFICIENT_STOCK`은 계획 1이 계약에 넣어뒀고 **여기서 처음으로
 * 실제 사용처가 생긴다.**
 *
 * `StockContentionError`가 409인 이유: 다시 시도하면 성공할 수 있는 일시적 경합이다.
 * 낙관적 어댑터를 쓸 때만 나오고 비관적 어댑터에서는 영원히 나오지 않는다 —
 * 두 전략의 차이가 HTTP 표면까지 새어 나오는 유일한 자리다.
 */
export function registerInventoryDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(InsufficientStockError.CODE, {
    status: 409,
    code: ErrorCode.INSUFFICIENT_STOCK,
  });
  registry.register(StockNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(StockContentionError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(StockAlreadyExistsError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(ReservationConflictError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(ReservationNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
}
