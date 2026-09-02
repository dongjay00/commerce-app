/**
 * 발급된 세션. 액세스 토큰과 리프레시 토큰이 함께 나가고, 이후 이 둘은 BFF의
 * 암호화 쿠키 안에서만 산다 (스펙 §8.5). 브라우저 자바스크립트는 둘 다 보지 못한다.
 */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface SignUpCommand {
  readonly email: string;
  readonly password: string;
}

/**
 * 가입은 성공 시 곧바로 세션을 발급한다. 가입 직후 로그인 화면으로 보내는 흐름을
 * 만들지 않기 위해서다 — 사용자가 방금 입력한 비밀번호를 한 번 더 입력할 이유가 없다.
 */
export interface SignUpUseCase {
  execute(command: SignUpCommand): Promise<SessionTokens>;
}

export const SIGN_UP_USECASE = Symbol('SignUpUseCase');
