import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../shared/kernel/identifiers';
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

export function sessionRepositoryContract(
  name: string,
  createRepo: () => Promise<SessionRepository>,
): void {
  describe(`SessionRepository 계약 — ${name}`, () => {
    it('저장한 세션을 리프레시 토큰 해시로 찾는다', async () => {
      const repo = await createRepo();
      const session = aSession('1001', '1001', 'hash-a');
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-a');
      expect(found?.id).toBe(session.id);
      expect(found?.accountId).toBe(session.accountId);
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
  });
}
