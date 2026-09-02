import { signUpBodySchema } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../kernel/domain-error';
import { ValidationFailedError, ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(signUpBodySchema);

  it('유효한 입력을 파싱해 돌려준다', () => {
    const body = { email: 'user@example.com', password: 'correct horse battery' };
    expect(pipe.transform(body)).toEqual(body);
  });

  it('스키마가 값을 정규화하면 정규화된 값이 나온다', () => {
    // 파이프가 입력을 그대로 반환하면(파싱 결과를 버리면) 이 단언이 깨진다.
    const strict = new ZodValidationPipe({
      parse: (input: unknown) => ({ normalized: String(input).trim() }),
    });
    expect(strict.transform('  x  ')).toEqual({ normalized: 'x' });
  });

  it('잘못된 입력은 ValidationFailedError다', () => {
    expect(() => pipe.transform({ email: 'nope', password: 'x' })).toThrow(ValidationFailedError);
  });

  it('실패는 DomainError라 예외 필터가 400으로 옮긴다', () => {
    // `toThrow(DomainError)`는 쓸 수 없다 — DomainError는 abstract 클래스라 vitest의
    // `Constructable` 타입(추상이 아닌 생성자)에 대입할 수 없어 타입체크가 깨진다.
    let caught: unknown;
    try {
      pipe.transform({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
  });

  it('메시지에 어느 필드가 문제인지 담는다', () => {
    // "요청이 잘못됐습니다"만 돌려주면 클라이언트가 고칠 수 없다.
    const error = (() => {
      try {
        pipe.transform({ email: 'nope', password: 'x' });
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).toContain('email');
  });

  it('계약에 없는 필드가 있으면 거부한다', () => {
    expect(() =>
      pipe.transform({ email: 'a@b.com', password: 'x'.repeat(12), role: 'admin' }),
    ).toThrow(ValidationFailedError);
  });

  it('zod가 아닌 예외는 그대로 통과시킨다', () => {
    // 파싱 중 발생한 진짜 버그(TypeError 등)를 400으로 뭉개면 원인을 잃는다.
    const exploding = new ZodValidationPipe({
      parse: () => {
        throw new RangeError('내부 버그');
      },
    });
    expect(() => exploding.transform({})).toThrow(RangeError);
  });
});
