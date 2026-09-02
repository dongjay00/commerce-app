export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * 토큰이 사는 곳. 운영에서는 암호화 쿠키(`session.ts`), 테스트에서는 메모리다.
 *
 * 이 인터페이스가 BFF의 유일한 seam이다 (스펙 §8.1). 이것 없이는 401 재시도 로직을
 * 테스트하려면 Next의 `cookies()`가 필요하고, 그건 요청 컨텍스트 밖에서 동작하지 않는다.
 */
export interface TokenStore {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}
