import { describe, expect, it } from 'vitest';
import { Duration } from '../../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { Session } from '../../domain/session';
import {
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../../domain/session.errors';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { FIXED_NOW, REFRESH_TTL } from '../../testing/identity.fixtures';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { RefreshSessionService } from './refresh-session.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f8001');
const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f8002');

async function build() {
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  const service = new RefreshSessionService(sessions, customers, tokens, clock, REFRESH_TTL);
  await customers.provision(ACCOUNT_ID, {} as never);
  return { service, sessions, customers, tokens, clock };
}

async function seedSession(sessions: InMemorySessionRepository, hash: string): Promise<Session> {
  const session = Session.issue({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    refreshTokenHash: hash,
    now: FIXED_NOW,
    ttl: REFRESH_TTL,
  });
  await sessions.save(session);
  return session;
}

describe('RefreshSessionService', () => {
  it('새 액세스 토큰과 새 리프레시 토큰을 낸다', async () => {
    const { service, sessions, customers } = await build();
    await seedSession(sessions, 'h(old-token)');

    const result = await service.execute({ refreshToken: 'old-token' });

    const customerId = await customers.findByAccount(ACCOUNT_ID);
    expect(result.accessToken).toBe(`access:${ACCOUNT_ID}:${customerId}`);
    expect(result.refreshToken).not.toBe('old-token');
  });

  it('회전 후 옛 리프레시 토큰은 더 이상 쓸 수 없다', async () => {
    // 회전의 존재 이유다. 옛 토큰이 계속 통하면 유출된 토큰을 회수할 방법이 없다.
    const { service, sessions } = await build();
    await seedSession(sessions, 'h(old-token)');

    await service.execute({ refreshToken: 'old-token' });

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it('회전된 세션은 같은 행을 유지한다 — 세션이 늘지 않는다', async () => {
    const { service, sessions } = await build();
    await seedSession(sessions, 'h(old-token)');

    const result = await service.execute({ refreshToken: 'old-token' });

    const rotated = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(rotated?.id).toBe(SESSION_ID);
    expect(rotated?.issuedAt).toEqual(FIXED_NOW);
  });

  it('만료 시각을 현재 시각 기준으로 다시 잡는다', async () => {
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');

    clock.advanceBy(Duration.hours(24 * 7));
    const later = clock.now();
    const result = await service.execute({ refreshToken: 'old-token' });

    const rotated = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(rotated?.expiresAt).toEqual(new Date(later.getTime() + REFRESH_TTL.millis));
    expect(rotated?.rotatedAt).toEqual(later);
  });

  it('없는 토큰은 SessionNotFoundError다', async () => {
    const { service } = await build();
    await expect(service.execute({ refreshToken: 'nope' })).rejects.toThrow(SessionNotFoundError);
  });

  it('만료된 세션은 SessionExpiredError다', async () => {
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');

    clock.advanceBy(Duration.hours(24 * 15));

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionExpiredError,
    );
  });

  it('폐기된 세션은 SessionRevokedError다', async () => {
    const { service, sessions } = await build();
    const session = await seedSession(sessions, 'h(old-token)');
    session.revoke(FIXED_NOW);
    await sessions.save(session);

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionRevokedError,
    );
  });

  it('회전 실패는 세션을 바꾸지 않는다', async () => {
    // 만료 확인 전에 해시부터 갈아 끼우면, 실패한 갱신이 멀쩡한 세션을 망가뜨린다.
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');
    clock.advanceBy(Duration.hours(24 * 15));

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash('h(old-token)')).not.toBeNull();
  });

  it('고객이 없으면 500 계열 예외를 던진다', async () => {
    const { service, sessions, customers } = await build();
    const orphanAccount = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9001');
    await sessions.save(
      Session.issue({
        id: SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9002'),
        accountId: orphanAccount,
        refreshTokenHash: 'h(orphan-token)',
        now: FIXED_NOW,
        ttl: REFRESH_TTL,
      }),
    );
    expect(await customers.findByAccount(orphanAccount)).toBeNull();

    await expect(service.execute({ refreshToken: 'orphan-token' })).rejects.toThrow(
      /고객이 없습니다/,
    );
  });
});
