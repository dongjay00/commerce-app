import { ErrorCode } from '@commerce/contracts';
import { Injectable } from '@nestjs/common';

export interface DomainErrorMapping {
  status: number;
  code: ErrorCode;
}

const FALLBACK: DomainErrorMapping = {
  status: 422,
  code: ErrorCode.DOMAIN_RULE_VIOLATED,
};

/**
 * 도메인 예외의 `code` → HTTP 상태 + 에러 코드 매핑.
 * 각 모듈이 자기 예외를 등록한다. 도메인 예외 자체에는 상태 코드가 없으므로
 * 이 레지스트리가 유일한 매핑 지점이다.
 *
 * 클래스 이름이 아니라 `DomainError.code`로 키를 잡는다 — 클래스 이름은 minify나
 * 리팩터링으로 바뀔 수 있는 문자열이라 그걸로 매핑하면 조용히 어긋날 수 있다.
 * `code`는 각 예외 클래스가 명시적으로 선언하는 안정적인 식별자다.
 */
@Injectable()
export class DomainErrorRegistry {
  private readonly mappings = new Map<string, DomainErrorMapping>();

  register(errorCode: string, mapping: DomainErrorMapping): void {
    if (this.mappings.has(errorCode)) {
      throw new Error(`도메인 예외 매핑이 이미 등록되어 있습니다: ${errorCode}`);
    }
    this.mappings.set(errorCode, mapping);
  }

  resolve(errorCode: string): DomainErrorMapping {
    return this.mappings.get(errorCode) ?? FALLBACK;
  }
}
