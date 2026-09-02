import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { Duration } from '../../../shared/kernel/duration';
import type { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import { SessionExpiredError, SessionRevokedError } from './session.errors';

/**
 * 세션 애그리거트 루트.
 *
 * 리프레시 토큰의 **해시만** 들고 있다. 원본은 클라이언트에만 존재한다 — DB가 유출돼도
 * 그것만으로는 세션을 되살릴 수 없다. 해싱은 어댑터(`TokenIssuer.hashRefreshToken`)의
 * 몫이고 도메인은 알고리즘을 모른다.
 *
 * 회전은 제자리에서 한다: 같은 행의 해시를 갈아 끼우고 `rotatedAt`을 찍는다. 옛 토큰은
 * 어느 행과도 매치되지 않아 자동으로 거부된다.
 *
 * 이벤트를 발행하지 않는다. 세션 생명주기를 구독하는 곳이 없다 (YAGNI).
 */
export class Session extends AggregateRoot {
  private constructor(
    readonly id: SessionId,
    readonly accountId: AccountId,
    private refreshTokenHashValue: string,
    readonly issuedAt: Date,
    private expiresAtValue: Date,
    private rotatedAtValue: Date | null,
    private revokedAtValue: Date | null,
  ) {
    super();
  }

  static issue(params: {
    id: SessionId;
    accountId: AccountId;
    refreshTokenHash: string;
    now: Date;
    ttl: Duration;
  }): Session {
    return new Session(
      params.id,
      params.accountId,
      params.refreshTokenHash,
      params.now,
      new Date(params.now.getTime() + params.ttl.millis),
      null,
      null,
    );
  }

  /** 저장된 행에서 복원한다. 이벤트를 쌓지 않는다. */
  static rehydrate(params: {
    id: SessionId;
    accountId: AccountId;
    refreshTokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
    rotatedAt: Date | null;
    revokedAt: Date | null;
  }): Session {
    return new Session(
      params.id,
      params.accountId,
      params.refreshTokenHash,
      params.issuedAt,
      params.expiresAt,
      params.rotatedAt,
      params.revokedAt,
    );
  }

  get refreshTokenHash(): string {
    return this.refreshTokenHashValue;
  }

  get expiresAt(): Date {
    return this.expiresAtValue;
  }

  get rotatedAt(): Date | null {
    return this.rotatedAtValue;
  }

  get revokedAt(): Date | null {
    return this.revokedAtValue;
  }

  /**
   * 상태 변경 전에 전부 검사한다 — 중간에 던지면 해시만 바뀌고 만료는 그대로인
   * 반쯤 회전된 세션이 남는다.
   */
  rotate(params: { refreshTokenHash: string; now: Date; ttl: Duration }): void {
    this.assertUsable(params.now);
    this.refreshTokenHashValue = params.refreshTokenHash;
    this.expiresAtValue = new Date(params.now.getTime() + params.ttl.millis);
    this.rotatedAtValue = params.now;
  }

  /** 멱등하다. 이미 폐기됐으면 첫 폐기 시각을 유지한다. */
  revoke(now: Date): void {
    if (this.revokedAtValue !== null) {
      return;
    }
    this.revokedAtValue = now;
  }

  isActive(now: Date): boolean {
    return this.revokedAtValue === null && now.getTime() < this.expiresAtValue.getTime();
  }

  private assertUsable(now: Date): void {
    // 폐기를 먼저 본다. 둘 다 해당하면 폐기가 더 구체적인 정보다.
    if (this.revokedAtValue !== null) {
      throw new SessionRevokedError(this.id);
    }
    if (now.getTime() >= this.expiresAtValue.getTime()) {
      throw new SessionExpiredError(this.id);
    }
  }
}
