import { Injectable, type PipeTransform } from '@nestjs/common';
import { DomainError } from '../../kernel/domain-error';

/**
 * 형식 검증 실패 (스펙 §8.4의 첫 번째 종류).
 *
 * `DomainError`를 상속하는 것은 배관이다 — 기존 예외 필터 하나가 모든 매핑을 담당하게
 * 하기 위해서다. 의미상 도메인 규칙 위반이 아니라는 점은 400 매핑이 표현한다.
 */
export class ValidationFailedError extends DomainError {
  static readonly CODE = 'VALIDATION_FAILED';
  readonly code = ValidationFailedError.CODE;

  constructor(message: string) {
    super(message);
  }
}

/**
 * 계약 스키마를 구조적 타입으로 받는다.
 *
 * `z.ZodType`을 쓰지 않는 이유: `apps/api`의 package.json에 `zod`가 없어 `'zod'`를
 * 값으로건 타입으로건 import하면 dependency-cruiser의 `not-to-unresolvable`에 걸린다.
 * 그리고 이 파이프가 실제로 필요로 하는 것은 `parse` 하나뿐이라, 구조적 타입이
 * 정확히 그만큼만 요구하는 더 정직한 시그니처이기도 하다.
 */
export interface SchemaParser<T> {
  parse(input: unknown): T;
}

interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
}

function formatIssues(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return null;
  }
  return (issues as ZodLikeIssue[])
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join(', ');
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: SchemaParser<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      const formatted = formatIssues(error);
      if (formatted === null) {
        // zod 오류가 아니다 — 파싱 중 발생한 진짜 버그다. 400으로 뭉개면 원인을 잃는다.
        throw error;
      }
      throw new ValidationFailedError(`요청 형식이 올바르지 않습니다 — ${formatted}`);
    }
  }
}
