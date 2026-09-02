import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { SessionRepository } from '../application/ports/out/session.repository';
import { Session } from '../domain/session';

const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.hours(24 * 14);

function aSession(suffix: string, accountSuffix: string, hash: string): Session {
  return Session.issue({
    id: SessionId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e${accountSuffix}`),
    refreshTokenHash: hash,
    now: NOW,
    ttl: TTL,
  });
}

/**
 * `runInTransaction`은 실물 트랜잭션 매니저가 있을 때만 넘긴다. in-memory 호출부는
 * 이걸 생략한다 — `PassthroughTransactionManager`는 롤백을 흉내내지 않으므로, 거기서
 * 롤백 테스트를 돌리면 통과하는 무의미한 테스트가 되고, 그건 테스트가 없는 것보다 나쁘다.
 */
export function sessionRepositoryContract(
  name: string,
  createRepo: () => Promise<SessionRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  describe(`SessionRepository 계약 — ${name}`, () => {
    it('저장한 세션을 리프레시 토큰 해시로 찾는다', async () => {
      const repo = await createRepo();
      const session = aSession('1001', '1001', 'hash-a');
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-a');
      expect(found?.id).toBe(session.id);
      expect(found?.accountId).toBe(session.accountId);
      // 한 번도 회전하지 않은 세션은 rotatedAt이 null이어야 한다. 이 스위트의 다른
      // 테스트는 전부 rotate()를 먼저 부르고서 rotatedAt을 읽으므로, 매퍼가 이 컬럼을
      // null이 아닌 값으로 기본값 처리해도 여기 말고는 잡히지 않는다.
      expect(found?.rotatedAt).toBeNull();
    });

    it('없는 해시는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findByRefreshTokenHash('nope')).toBeNull();
    });

    it('회전한 세션은 새 해시로만 찾힌다', async () => {
      // 옛 토큰이 여전히 찾히면 회전이 아무 의미가 없다.
      const repo = await createRepo();
      const session = aSession('1002', '1002', 'hash-old');
      await repo.save(session);

      session.rotate({ refreshTokenHash: 'hash-new', now: NOW, ttl: TTL });
      await repo.save(session);

      expect(await repo.findByRefreshTokenHash('hash-old')).toBeNull();
      expect(await repo.findByRefreshTokenHash('hash-new')).not.toBeNull();
    });

    it('만료·회전·폐기 시각이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const session = aSession('1003', '1003', 'hash-b');
      const rotatedAt = new Date(NOW.getTime() + 1000);
      session.rotate({ refreshTokenHash: 'hash-b2', now: rotatedAt, ttl: TTL });
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-b2');
      expect(found?.issuedAt).toEqual(NOW);
      expect(found?.rotatedAt).toEqual(rotatedAt);
      expect(found?.expiresAt).toEqual(new Date(rotatedAt.getTime() + TTL.millis));
      expect(found?.revokedAt).toBeNull();
    });

    it('폐기된 세션은 복원해도 폐기 상태다', async () => {
      // 매퍼가 revoked_at을 흘리면 로그아웃한 세션이 되살아난다.
      const repo = await createRepo();
      const session = aSession('1004', '1004', 'hash-c');
      session.revoke(NOW);
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-c');
      expect(found?.revokedAt).toEqual(NOW);
      expect(found?.isActive(NOW)).toBe(false);
    });

    it('revokeAllForAccount가 그 계정의 살아 있는 세션만 폐기한다', async () => {
      const repo = await createRepo();
      await repo.save(aSession('1005', '2001', 'hash-d1'));
      await repo.save(aSession('1006', '2001', 'hash-d2'));
      await repo.save(aSession('1007', '2002', 'hash-e1'));

      const revokedAt = new Date(NOW.getTime() + 5000);
      const count = await repo.revokeAllForAccount(
        AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e2001'),
        revokedAt,
      );

      expect(count).toBe(2);
      expect((await repo.findByRefreshTokenHash('hash-d1'))?.revokedAt).toEqual(revokedAt);
      expect((await repo.findByRefreshTokenHash('hash-d2'))?.revokedAt).toEqual(revokedAt);
      // 다른 계정은 건드리지 않는다. 이 단언이 없으면 "전체 폐기" 버그가 통과한다.
      expect((await repo.findByRefreshTokenHash('hash-e1'))?.revokedAt).toBeNull();
    });

    it('이미 폐기된 세션은 다시 세지 않고 시각도 덮어쓰지 않는다', async () => {
      const repo = await createRepo();
      const session = aSession('1008', '2003', 'hash-f');
      session.revoke(NOW);
      await repo.save(session);

      const later = new Date(NOW.getTime() + 10_000);
      const count = await repo.revokeAllForAccount(
        AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e2003'),
        later,
      );

      expect(count).toBe(0);
      expect((await repo.findByRefreshTokenHash('hash-f'))?.revokedAt).toEqual(NOW);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const session = aSession('1009', '2004', 'hash-g');
      await repo.save(session);

      session.revoke(NOW);

      expect((await repo.findByRefreshTokenHash('hash-g'))?.revokedAt).toBeNull();
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 그 안에서 저장한 세션도 사라진다',
      async () => {
        const runner = runInTransaction;
        if (!runner) {
          // skipIf가 이미 이 케이스를 건너뛴다 — 타입만 좁힌다.
          return;
        }
        const repo = await createRepo();
        const session = aSession('1010', '2005', 'hash-h');

        await expect(
          runner(async (tx) => {
            await repo.save(session, tx);
            throw new Error('의도된 실패');
          }),
        ).rejects.toThrow('의도된 실패');

        expect(await repo.findByRefreshTokenHash('hash-h')).toBeNull();
      },
    );
  });
}
