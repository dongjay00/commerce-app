import { AccountId, SessionId } from '../../../../../shared/kernel/identifiers';
import { Session } from '../../../domain/session';

export interface SessionRow {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `SessionId.fromPersistence`/`AccountId.fromPersistence`를 쓴다. `of`를 쓰면 깨진
 * 행을 만났을 때 `InvalidIdError`(400)가 나가고, 클라이언트는 자기 요청이 잘못됐다고
 * 듣는다. 실제로는 우리 데이터가 깨진 것이므로 500이어야 한다 (M7).
 */
export function toSessionDomain(row: SessionRow): Session {
  return Session.rehydrate({
    id: SessionId.fromPersistence(row.id),
    accountId: AccountId.fromPersistence(row.accountId),
    refreshTokenHash: row.refreshTokenHash,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
  });
}

export function toSessionRow(session: Session): SessionRow {
  return {
    id: session.id,
    accountId: session.accountId,
    refreshTokenHash: session.refreshTokenHash,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    rotatedAt: session.rotatedAt,
    revokedAt: session.revokedAt,
  };
}
