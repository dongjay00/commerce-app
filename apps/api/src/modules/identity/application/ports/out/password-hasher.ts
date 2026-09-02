import type { Credential } from '../../../domain/credential';
import type { PlainPassword } from '../../../domain/plain-password';

/**
 * 비밀번호 해싱 포트. 알고리즘(Argon2)은 어댑터만 안다.
 *
 * 평문과 해시를 서로 다른 VO로 받는 이유는 인자 순서를 바꿔 넣는 실수를 컴파일 단계에서
 * 막기 위해서다. `verify(hash, plain)`와 `verify(plain, hash)`는 문자열 두 개짜리
 * 시그니처에서는 구분되지 않고, 뒤집히면 **모든 로그인이 실패하는 대신 모든 로그인이
 * 성공할 수도 있다.**
 */
export interface PasswordHasher {
  hash(password: PlainPassword): Promise<Credential>;
  verify(credential: Credential, password: PlainPassword): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PasswordHasher');
