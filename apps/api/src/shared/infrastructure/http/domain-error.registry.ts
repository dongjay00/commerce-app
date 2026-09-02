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
 * 도메인 예외 이름 → HTTP 상태 + 에러 코드 매핑.
 * 각 모듈이 자기 예외를 등록한다. 도메인 예외 자체에는 상태 코드가 없으므로
 * 이 레지스트리가 유일한 매핑 지점이다.
 */
@Injectable()
export class DomainErrorRegistry {
  private readonly mappings = new Map<string, DomainErrorMapping>();

  register(errorName: string, mapping: DomainErrorMapping): void {
    if (this.mappings.has(errorName)) {
      throw new Error(`도메인 예외 매핑이 이미 등록되어 있습니다: ${errorName}`);
    }
    this.mappings.set(errorName, mapping);
  }

  resolve(errorName: string): DomainErrorMapping {
    return this.mappings.get(errorName) ?? FALLBACK;
  }
}
