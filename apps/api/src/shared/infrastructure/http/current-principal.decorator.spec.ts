import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import { resolveCurrentPrincipal } from './current-principal.decorator';
import { UnauthenticatedError } from './unauthenticated.error';

const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0002'),
};

function contextWith(principal?: Principal): ExecutionContext {
  const request = { headers: {}, principal };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('resolveCurrentPrincipal', () => {
  it('가드가 principal을 채우지 않았으면 던진다', () => {
    // AccessTokenGuard 없이 @CurrentPrincipal()만 쓴 컨트롤러가 undefined principal로
    // 조용히 동작하는 것을 막는다.
    expect(() => resolveCurrentPrincipal(undefined, contextWith(undefined))).toThrow(
      UnauthenticatedError,
    );
  });

  it('가드가 채운 principal을 그대로 돌려준다', () => {
    expect(resolveCurrentPrincipal(undefined, contextWith(PRINCIPAL))).toEqual(PRINCIPAL);
  });
});
