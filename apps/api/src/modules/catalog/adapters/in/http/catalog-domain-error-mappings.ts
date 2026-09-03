import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import {
  DuplicateSkuCodeError,
  InvalidPriceError,
  InvalidProductError,
  ProductNotFoundError,
  SkuNotFoundError,
} from '../../../domain/catalog.errors';

/**
 * 등록하지 않으면 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.** `register`는 중복 등록에 던지므로
 * 모듈이 두 번 초기화되면 그건 소리 나게 실패한다.
 */
export function registerCatalogDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(InvalidPriceError.CODE, { status: 400, code: ErrorCode.VALIDATION_FAILED });
  registry.register(InvalidProductError.CODE, { status: 400, code: ErrorCode.VALIDATION_FAILED });
  registry.register(DuplicateSkuCodeError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(SkuNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(ProductNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
}
