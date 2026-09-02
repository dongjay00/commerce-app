import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { SessionRepository } from '../../../application/ports/out/session.repository';
import type { Session } from '../../../domain/session';
import { toSessionDomain, toSessionRow } from './session.mapper';

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByRefreshTokenHash(hash: string, tx?: TransactionContext): Promise<Session | null> {
    const row = await this.client(tx).session.findUnique({ where: { refreshTokenHash: hash } });
    return row === null ? null : toSessionDomain(row);
  }

  async save(session: Session, tx?: TransactionContext): Promise<void> {
    const row = toSessionRow(session);
    await this.client(tx).session.upsert({
      where: { id: row.id },
      create: row,
      update: {
        refreshTokenHash: row.refreshTokenHash,
        expiresAt: row.expiresAt,
        rotatedAt: row.rotatedAt,
        revokedAt: row.revokedAt,
      },
    });
  }

  async revokeAllForAccount(
    accountId: AccountId,
    now: Date,
    tx?: TransactionContext,
  ): Promise<number> {
    // 애그리거트를 하나씩 불러와 revoke()를 부르지 않는다. 세션이 수십 개일 수 있고,
    // 그 전부를 왕복시키는 것은 이 연산의 성질(집합 갱신)과 맞지 않는다.
    // `revokedAt: null` 조건이 멱등성을 만든다 — 이미 폐기된 세션은 세지도, 시각을
    // 덮어쓰지도 않는다.
    const result = await this.client(tx).session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
