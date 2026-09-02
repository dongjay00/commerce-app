/**
 * 해시가 비어 있을 때. `DomainError`가 아니다 — 여기 도달했다면 해셔가 빈 문자열을
 * 돌려줬거나 매퍼가 NULL 컬럼을 읽은 것이고, 둘 다 코드 버그다.
 */
export class InvalidCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCredentialError';
  }
}

/**
 * 저장된 비밀번호 해시 (스펙 §5.1의 `Credential` VO).
 *
 * 평문을 담는 `PlainPassword`와 타입이 갈라져 있어, 평문을 해시 자리에 넣는 실수가
 * 컴파일 단계에서 걸린다. 검증(평문 ↔ 해시 대조)은 이 VO가 하지 않는다 — 알고리즘을
 * 아는 것은 어댑터(`PasswordHasher`)이고, 도메인은 argon2를 몰라야 한다.
 */
export class Credential {
  private constructor(readonly hash: string) {}

  static fromHash(hash: string): Credential {
    if (hash.trim().length === 0) {
      throw new InvalidCredentialError('비어 있는 해시로 Credential을 만들 수 없습니다.');
    }
    return new Credential(hash);
  }

  equals(other: Credential): boolean {
    return this.hash === other.hash;
  }
}
