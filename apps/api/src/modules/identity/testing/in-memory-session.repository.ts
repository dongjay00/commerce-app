import type { AccountId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { SessionRepository } from '../application/ports/out/session.repository';
import { Session } from '../domain/session';

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();

  async findByRefreshTokenHash(hash: string, _tx?: TransactionContext): Promise<Session | null> {
    for (const stored of this.byId.values()) {
      if (stored.refreshTokenHash === hash) {
        return InMemorySessionRepository.copy(stored);
      }
    }
    return null;
  }

  async save(session: Session, _tx?: TransactionContext): Promise<void> {
    this.byId.set(session.id, InMemorySessionRepository.copy(session));
  }

  async revokeAllForAccount(
    accountId: AccountId,
    now: Date,
    _tx?: TransactionContext,
  ): Promise<number> {
    let revoked = 0;
    for (const [id, stored] of this.byId) {
      if (stored.accountId !== accountId || stored.revokedAt !== null) {
        continue;
      }
      const copy = InMemorySessionRepository.copy(stored);
      copy.revoke(now);
      this.byId.set(id, copy);
      revoked += 1;
    }
    return revoked;
  }

  private static copy(session: Session): Session {
    return Session.rehydrate({
      id: session.id,
      accountId: session.accountId,
      refreshTokenHash: session.refreshTokenHash,
      issuedAt: new Date(session.issuedAt.getTime()),
      expiresAt: new Date(session.expiresAt.getTime()),
      rotatedAt: session.rotatedAt === null ? null : new Date(session.rotatedAt.getTime()),
      revokedAt: session.revokedAt === null ? null : new Date(session.revokedAt.getTime()),
    });
  }
}
