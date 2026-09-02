import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import type { AuthenticatedRequest } from './access-token.guard';
import { UnauthenticatedError } from './unauthenticated.error';

/**
 * 가드가 채운 principal을 꺼낸다. 가드 없이 이 데코레이터만 쓰면 던진다 —
 * `@UseGuards(AccessTokenGuard)`를 빠뜨린 컨트롤러가 `undefined` principal로
 * 조용히 동작하는 것을 막는다.
 *
 * `createParamDecorator`가 감싸기 전의 팩토리를 이름 붙여 내보낸다 — Nest가 돌려주는
 * 값은 데코레이터일 뿐 팩토리 자체가 아니라서, 이 함수를 따로 export하지 않으면
 * 실패 경로(가드를 빠뜨린 경우)를 단위 테스트에서 직접 부를 방법이 없다.
 */
export function resolveCurrentPrincipal(_data: unknown, context: ExecutionContext): Principal {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.principal === undefined) {
    throw new UnauthenticatedError('인증 정보가 없습니다.');
  }
  return request.principal;
}

export const CurrentPrincipal = createParamDecorator(resolveCurrentPrincipal);
