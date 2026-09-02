export interface SignOutCommand {
  readonly refreshToken: string;
}

/**
 * 멱등하다. 이미 없는 토큰이나 이미 폐기된 세션에도 성공으로 답한다 — 로그아웃 요청을
 * 재시도하는 클라이언트에게 실패를 돌려줄 이유가 없고, "그 토큰은 존재한다"는 정보를
 * 흘릴 이유도 없다.
 */
export interface SignOutUseCase {
  execute(command: SignOutCommand): Promise<void>;
}

export const SIGN_OUT_USECASE = Symbol('SignOutUseCase');
