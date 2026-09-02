import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { AccessTokenVerifier, Principal } from '../../kernel/ports/access-token-verifier';
import { AccessTokenGuard } from './access-token.guard';
import { UnauthenticatedError } from './unauthenticated.error';

const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0002'),
};

class FakeVerifier implements AccessTokenVerifier {
  readonly seen: string[] = [];

  constructor(private readonly result: Principal | Error = PRINCIPAL) {}

  async verify(token: string): Promise<Principal> {
    this.seen.push(token);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function contextWith(authorization?: string): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; principal?: Principal };
} {
  const request = {
    headers: authorization === undefined ? {} : { authorization },
  } as { headers: Record<string, string>; principal?: Principal };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AccessTokenGuard', () => {
  it('유효한 Bearer 토큰이면 통과시키고 principal을 채운다', async () => {
    const verifier = new FakeVerifier();
    const { context, request } = contextWith('Bearer valid-token');

    await expect(new AccessTokenGuard(verifier).canActivate(context)).resolves.toBe(true);
    expect(verifier.seen).toEqual(['valid-token']);
    expect(request.principal).toEqual(PRINCIPAL);
  });

  it('Authorization 헤더가 없으면 401이다', async () => {
    const { context } = contextWith();
    await expect(new AccessTokenGuard(new FakeVerifier()).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('Bearer가 아닌 스킴은 401이다', async () => {
    const { context } = contextWith('Basic dXNlcjpwYXNz');
    await expect(new AccessTokenGuard(new FakeVerifier()).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('Bearer 뒤가 비어 있으면 검증기를 부르지 않고 401이다', async () => {
    // 빈 문자열을 검증기에 넘기면 어댑터마다 다르게 실패한다. 여기서 막는다.
    const verifier = new FakeVerifier();
    const { context } = contextWith('Bearer ');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
    expect(verifier.seen).toEqual([]);
  });

  it('검증기가 던지면 그 예외가 그대로 나간다', async () => {
    const verifier = new FakeVerifier(new UnauthenticatedError('토큰이 유효하지 않습니다.'));
    const { context } = contextWith('Bearer bad');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow(
      '토큰이 유효하지 않습니다.',
    );
  });

  it('검증에 실패하면 principal을 채우지 않는다', async () => {
    const verifier = new FakeVerifier(new UnauthenticatedError());
    const { context, request } = contextWith('Bearer bad');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow();
    expect(request.principal).toBeUndefined();
  });
});
