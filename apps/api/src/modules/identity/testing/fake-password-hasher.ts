import type { PasswordHasher } from '../application/ports/out/password-hasher';
import { Credential } from '../domain/credential';
import type { PlainPassword } from '../domain/plain-password';

const PREFIX = 'fake-hash:';

/**
 * 단위 테스트용 해셔. Argon2는 한 번에 100ms 안팎이 걸려 유스케이스 테스트 수십 개를
 * 돌리면 그것만으로 수 초가 된다.
 *
 * **되돌릴 수 있는 변환을 쓴다.** 테스트가 "이 계정의 비밀번호가 무엇인지"를 해시에서
 * 읽어야 할 때가 있고, 실물 해셔로는 불가능하다. 운영 코드는 이 클래스를 import할 수
 * 없다 (`no-test-doubles-in-production`).
 */
export class FakePasswordHasher implements PasswordHasher {
  async hash(password: PlainPassword): Promise<Credential> {
    return Credential.fromHash(`${PREFIX}${password.reveal()}`);
  }

  async verify(credential: Credential, password: PlainPassword): Promise<boolean> {
    return credential.hash === `${PREFIX}${password.reveal()}`;
  }
}
