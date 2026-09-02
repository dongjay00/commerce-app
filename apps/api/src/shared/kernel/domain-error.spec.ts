import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';

class SampleDomainError extends DomainError {
  readonly code = 'SAMPLE_FAILURE';
  constructor(readonly detail: string) {
    super(`샘플 실패: ${detail}`);
  }
}

describe('DomainError', () => {
  it('Error를 상속한다', () => {
    expect(new SampleDomainError('x')).toBeInstanceOf(Error);
  });

  it('name이 구체 클래스 이름으로 설정된다 — 스택 트레이스 등 디버깅용이다', () => {
    expect(new SampleDomainError('x').name).toBe('SampleDomainError');
  });

  it('code를 노출한다', () => {
    expect(new SampleDomainError('x').code).toBe('SAMPLE_FAILURE');
  });

  it('메시지를 보존한다', () => {
    expect(new SampleDomainError('재고 부족').message).toBe('샘플 실패: 재고 부족');
  });

  it('HTTP 상태 코드를 담지 않는다 — 매핑은 어댑터의 책임이다', () => {
    const error = new SampleDomainError('x') as unknown as Record<string, unknown>;
    expect('status' in error).toBe(false);
    expect('statusCode' in error).toBe(false);
    expect('httpStatus' in error).toBe(false);
  });

  it('스택 트레이스를 가진다', () => {
    expect(new SampleDomainError('x').stack).toBeDefined();
  });
});
