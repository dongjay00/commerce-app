import { ErrorCode } from '@commerce/contracts';
import { InvalidIdError } from '../../kernel/identifiers';
import {
  NegativeQuantityError,
  NonIntegerQuantityError,
  QuantityBelowMinimumError,
} from '../../kernel/quantity';
import type { DomainErrorRegistry } from './domain-error.registry';

/**
 * 커널 값 객체가 던지는 DomainError 하위 클래스를 HTTP 상태/에러 코드로 등록한다.
 *
 * 커널(apps/api/src/shared/kernel)은 @commerce/contracts를 import할 수 없다
 * (kernel-is-pure, 아키텍처 규칙) — 그래서 `ErrorCode`를 커널 예외에 직접 붙일 수
 * 없다. 대신 각 커널 예외 클래스가 `code`(문자열 하나)만 노출하고, 그 문자열을
 * `ErrorCode`로 번역하는 건 이 어댑터 계층에만 존재한다.
 *
 * 문자열을 여기서 다시 타이핑하지 않고 각 클래스의 정적 `CODE` 상수를 그대로
 * import해서 쓴다 — 코드가 바뀌면 여기도 컴파일 타임에 같이 깨진다. 클래스 이름
 * 문자열로 매핑하던 예전 방식과 같은 종류의 드리프트를 code 문자열 자체를 두 번
 * 타이핑해서 재현하지 않기 위해서다.
 */
export function registerKernelDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(InvalidIdError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });

  registry.register(QuantityBelowMinimumError.CODE, {
    status: 422,
    code: ErrorCode.QUANTITY_BELOW_MINIMUM,
  });

  registry.register(NegativeQuantityError.CODE, {
    status: 409,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });

  registry.register(NonIntegerQuantityError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
}
