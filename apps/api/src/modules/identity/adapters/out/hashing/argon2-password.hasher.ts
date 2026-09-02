import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../../../application/ports/out/password-hasher';
import { Credential } from '../../../domain/credential';
import type { PlainPassword } from '../../../domain/plain-password';

/**
 * Argon2id 해셔. 파라미터는 라이브러리 기본값(OWASP 권고에 맞춰진 값)을 쓴다.
 * 값을 직접 적어 넣지 않는 이유는, 여기 박아두면 권고가 바뀌어도 아무도 고치지
 * 않기 때문이다. 튜닝이 필요해지면 그때 벤치마크와 함께 명시한다.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: PlainPassword): Promise<Credential> {
    return Credential.fromHash(await hash(password.reveal()));
  }

  async verify(credential: Credential, password: PlainPassword): Promise<boolean> {
    try {
      return await verify(credential.hash, password.reveal());
    } catch {
      // 저장된 해시가 망가졌다. 던지면 그 계정의 로그인이 영구히 500이 된다.
      return false;
    }
  }
}
