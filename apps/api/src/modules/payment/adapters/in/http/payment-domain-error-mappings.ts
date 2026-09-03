import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import { PaymentConflictError, PaymentNotFoundError } from '../../../domain/payment.errors';

/**
 * 등록하지 않은 `DomainError`는 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.**
 *
 * `ErrorCode.PAYMENT_DECLINED`는 계획 1이 계약에 넣어뒀지만 **여기서 쓰지 않는다.**
 * 결제 거절은 예외가 아니라 결과이고(`AuthorizePaymentResult.ok === false`), HTTP로
 * 나가는 것은 주문 쪽의 `PAYMENT_FAILED` 상태다. 태스크 19가 그 코드의 실제 사용처를 만든다.
 */
export function registerPaymentDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(PaymentConflictError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(PaymentNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
}
