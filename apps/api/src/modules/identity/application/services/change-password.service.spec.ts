import { describe, expect, it } from 'vitest';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { Account } from '../../domain/account';
import { InvalidCredentialsError, SamePasswordError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PasswordPolicyViolationError, PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import {
  FIXED_NOW,
  OTHER_PASSWORD,
  REFRESH_TTL,
  VALID_PASSWORD,
} from '../../testing/identity.fixtures';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { ChangePasswordService } from './change-password.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fb001');
const OTHER_ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fb009');

async function build() {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakePasswordHasher();
  const transactions = new PassthroughTransactionManager();
  const clock = new MutableClock(FIXED_NOW);
  const service = new ChangePasswordService(accounts, sessions, hasher, transactions, clock);

  const account = Account.register({
    id: ACCOUNT_ID,
    email: Email.of('user@example.com'),
    credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
    now: FIXED_NOW,
  });
  account.pullEvents();
  await accounts.save(account);

  return { service, accounts, sessions, hasher, clock };
}

async function seedSessions(sessions: InMemorySessionRepository): Promise<void> {
  for (const [index, accountId] of [ACCOUNT_ID, ACCOUNT_ID, OTHER_ACCOUNT_ID].entries()) {
    await sessions.save(
      Session.issue({
        id: SessionId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fc00${index}`),
        accountId,
        refreshTokenHash: `h(token-${index})`,
        now: FIXED_NOW,
        ttl: REFRESH_TTL,
      }),
    );
  }
}

describe('ChangePasswordService', () => {
  it('비밀번호를 바꾸고 갱신 시각을 찍는다', async () => {
    const { service, accounts, clock } = await build();
    clock.setTo(new Date('2026-04-01T00:00:00.000Z'));

    await service.execute({
      accountId: ACCOUNT_ID,
      currentPassword: VALID_PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    const account = await accounts.findById(ACCOUNT_ID);
    expect(account?.credential.hash).toBe(`fake-hash:${OTHER_PASSWORD}`);
    expect(account?.updatedAt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
  });

  it('그 계정의 모든 세션을 폐기한다 — 현재 세션도 포함한다', async () => {
    // 비밀번호를 바꾸는 이유의 절반은 "누가 내 계정에 들어와 있다"이다. 현재 세션만
    // 남기면 공격자의 세션이 어느 쪽인지 알 수 없으므로 전부 끊는 편이 정직하다.
    const { service, sessions } = await build();
    await seedSessions(sessions);

    await service.execute({
      accountId: ACCOUNT_ID,
      currentPassword: VALID_PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    expect((await sessions.findByRefreshTokenHash('h(token-0)'))?.revokedAt).toEqual(FIXED_NOW);
    expect((await sessions.findByRefreshTokenHash('h(token-1)'))?.revokedAt).toEqual(FIXED_NOW);
    // 다른 계정의 세션은 건드리지 않는다.
    expect((await sessions.findByRefreshTokenHash('h(token-2)'))?.revokedAt).toBeNull();
  });

  it('현재 비밀번호가 틀리면 InvalidCredentialsError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: 'wrong password here',
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('현재 비밀번호가 틀리면 세션도 비밀번호도 그대로다', async () => {
    const { service, accounts, sessions } = await build();
    await seedSessions(sessions);

    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: 'wrong password here',
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow();

    expect((await accounts.findById(ACCOUNT_ID))?.credential.hash).toBe(
      `fake-hash:${VALID_PASSWORD}`,
    );
    expect((await sessions.findByRefreshTokenHash('h(token-0)'))?.revokedAt).toBeNull();
  });

  it('새 비밀번호가 정책을 어기면 PasswordPolicyViolationError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: 'short',
      }),
    ).rejects.toThrow(PasswordPolicyViolationError);
  });

  it('새 비밀번호가 현재와 같으면 SamePasswordError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: VALID_PASSWORD,
      }),
    ).rejects.toThrow(SamePasswordError);
  });

  it('없는 계정이면 InvalidCredentialsError다', async () => {
    // 토큰은 유효한데 계정이 사라진 경우. 404로 답하면 "이 계정 ID는 존재하지 않는다"를
    // 알려주는 셈이고, 어차피 사용자가 할 일은 재로그인이다.
    const { service } = await build();
    await expect(
      service.execute({
        accountId: OTHER_ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });
});
