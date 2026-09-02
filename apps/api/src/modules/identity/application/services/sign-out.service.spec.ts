import { describe, expect, it } from 'vitest';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { Session } from '../../domain/session';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { FIXED_NOW, REFRESH_TTL } from '../../testing/identity.fixtures';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { SignOutService } from './sign-out.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fa001');
const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fa002');

function build() {
  const sessions = new InMemorySessionRepository();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  return { service: new SignOutService(sessions, tokens, clock), sessions, clock };
}

async function seed(sessions: InMemorySessionRepository): Promise<void> {
  await sessions.save(
    Session.issue({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'h(token)',
      now: FIXED_NOW,
      ttl: REFRESH_TTL,
    }),
  );
}

describe('SignOutService', () => {
  it('세션을 폐기한다', async () => {
    const { service, sessions } = build();
    await seed(sessions);

    await service.execute({ refreshToken: 'token' });

    const session = await sessions.findByRefreshTokenHash('h(token)');
    expect(session?.revokedAt).toEqual(FIXED_NOW);
    expect(session?.isActive(FIXED_NOW)).toBe(false);
  });

  it('없는 토큰이어도 성공한다 (멱등)', async () => {
    const { service } = build();
    await expect(service.execute({ refreshToken: 'nope' })).resolves.toBeUndefined();
  });

  it('두 번 로그아웃해도 성공하고 첫 폐기 시각을 유지한다', async () => {
    const { service, sessions, clock } = build();
    await seed(sessions);

    await service.execute({ refreshToken: 'token' });
    clock.setTo(new Date(FIXED_NOW.getTime() + 60_000));
    await expect(service.execute({ refreshToken: 'token' })).resolves.toBeUndefined();

    expect((await sessions.findByRefreshTokenHash('h(token)'))?.revokedAt).toEqual(FIXED_NOW);
  });

  it('폐기 후에는 그 세션의 리프레시 토큰이 아무 데도 쓰이지 못한다', async () => {
    const { service, sessions } = build();
    await seed(sessions);
    await service.execute({ refreshToken: 'token' });

    const session = await sessions.findByRefreshTokenHash('h(token)');
    expect(() =>
      session?.rotate({ refreshTokenHash: 'h(new)', now: FIXED_NOW, ttl: REFRESH_TTL }),
    ).toThrow();
  });
});
