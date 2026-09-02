import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import type { AuthenticatedRequest } from './access-token.guard';
import { UnauthenticatedError } from './unauthenticated.error';

/**
 * 가드가 채운 principal을 꺼낸다. 가드 없이 이 데코레이터만 쓰면 던진다 —
 * `@UseGuards(AccessTokenGuard)`를 빠뜨린 컨트롤러가 `undefined` principal로
 * 조용히 동작하는 것을 막는다.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new UnauthenticatedError('인증 정보가 없습니다.');
    }
    return request.principal;
  },
);
