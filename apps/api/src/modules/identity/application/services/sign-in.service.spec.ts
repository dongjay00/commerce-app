import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { Account } from '../../domain/account';
import { InvalidCredentialsError } from '../../domain/account.errors';
import type { Credential } from '../../domain/credential';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import {
  FIXED_NOW,
  OTHER_PASSWORD,
  REFRESH_TTL,
  VALID_PASSWORD,
} from '../../testing/identity.fixtures';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import { SignInService } from './sign-in.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f7001');

/**
 * 해싱 검증 호출 횟수를 세는 fake. `vi.spyOn` 대신 상속으로 만든다 — 목 라이브러리
 * 금지 규칙을 지키면서 "언제 verify를 호출했는가"를 상태로 검증하는 방법이다.
 * (sign-up.service.spec.ts의 CountingPasswordHasher와 같은 패턴, hash 대신 verify를 센다.)
 */
class CountingPasswordHasher extends FakePasswordHasher {
  verifyCalls = 0;

  override async verify(credential: Credential, password: PlainPassword): Promise<boolean> {
    this.verifyCalls += 1;
    return super.verify(credential, password);
  }
}

async function build(overrides: { hasher?: FakePasswordHasher } = {}) {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const hasher = overrides.hasher ?? new FakePasswordHasher();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();

  const service = new SignInService(
    accounts,
    sessions,
    customers,
    hasher,
    tokens,
    clock,
    ids,
    REFRESH_TTL,
  );

  return { service, accounts, sessions, customers, hasher, tokens, clock, ids };
}

async function seedAccount(
  accounts: InMemoryAccountRepository,
  hasher: FakePasswordHasher,
  customers: StubCustomerDirectory,
): Promise<void> {
  const account = Account.register({
    id: ACCOUNT_ID,
    email: Email.of('user@example.com'),
    credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
    now: FIXED_NOW,
  });
  account.pullEvents();
  await accounts.save(account);
  await customers.provision(ACCOUNT_ID, {} as never);
}

describe('SignInService', () => {
  it('올바른 자격증명으로 세션을 발급한다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    const result = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    const customerId = await customers.findByAccount(ACCOUNT_ID);
    expect(result.accessToken).toBe(`access:${ACCOUNT_ID}:${customerId}`);
    expect(result.expiresInSeconds).toBe(900);
  });

  it('대소문자가 달라도 로그인된다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'USER@Example.com', password: VALID_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('세션에는 리프레시 토큰의 해시만 저장한다', async () => {
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    const result = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    expect(await sessions.findByRefreshTokenHash(result.refreshToken)).toBeNull();
    const session = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(session?.accountId).toBe(ACCOUNT_ID);
    expect(session?.issuedAt).toEqual(FIXED_NOW);
  });

  it('로그인할 때마다 새 세션이 생긴다 — 기존 세션을 끊지 않는다', async () => {
    // 여러 기기에서 동시에 로그인할 수 있어야 한다.
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    const first = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });
    const second = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(await sessions.findByRefreshTokenHash(`h(${first.refreshToken})`)).not.toBeNull();
    expect(await sessions.findByRefreshTokenHash(`h(${second.refreshToken})`)).not.toBeNull();
  });

  it('비밀번호가 틀리면 InvalidCredentialsError를 던진다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'user@example.com', password: OTHER_PASSWORD }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('없는 이메일도 같은 예외와 같은 메시지를 낸다', async () => {
    // 메시지가 갈리면 "이 이메일은 가입돼 있다"는 사실이 새어 계정 열거 공격의 재료가
    // 된다. 두 경로가 문자열까지 같아야 한다.
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    const wrongPassword = await service
      .execute({ email: 'user@example.com', password: OTHER_PASSWORD })
      .catch((error: Error) => error);
    const unknownEmail = await service
      .execute({ email: 'nobody@example.com', password: VALID_PASSWORD })
      .catch((error: Error) => error);

    expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);
    expect((unknownEmail as Error).message).toBe((wrongPassword as Error).message);
  });

  it('없는 이메일이어도 해셔를 호출한다 — 계정 존재 여부가 응답 시간으로 새지 않는다', async () => {
    // I1: 이메일이 없다고 바로 리턴하면, 해싱 비용(~100ms)을 치르는 "비밀번호가 틀림"
    // 경로와 시간 차가 나서 그 자체가 계정 존재 여부를 알려주는 오라클이 된다.
    // 존재하지 않는 계정에도 (더미 자격증명에 대해) verify를 호출해야 두 경로의
    // 작업량이 같아진다.
    const hasher = new CountingPasswordHasher();
    const { service } = await build({ hasher });

    await expect(
      service.execute({ email: 'nobody@example.com', password: VALID_PASSWORD }),
    ).rejects.toThrow(InvalidCredentialsError);

    expect(hasher.verifyCalls).toBe(1);
  });

  it('로그인 실패는 세션을 만들지 않는다', async () => {
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'user@example.com', password: OTHER_PASSWORD }),
    ).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash('h(refresh-1)')).toBeNull();
  });

  it('비밀번호 정책 위반은 로그인에서 InvalidCredentialsError가 된다', async () => {
    // 로그인 입력은 "정책을 만족하는 새 비밀번호"가 아니라 "예전에 정한 비밀번호"다.
    // 정책이 나중에 강화되면 기존 사용자의 비밀번호가 정책을 만족하지 않을 수 있고,
    // 그때 422 PASSWORD_POLICY_VIOLATED를 돌려주면 "당신의 비밀번호는 10자 미만이군요"를
    // 알려주는 꼴이 된다.
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(service.execute({ email: 'user@example.com', password: 'short' })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('잘못된 형식의 이메일도 InvalidCredentialsError가 된다', async () => {
    const { service } = await build();
    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('계정은 있는데 고객이 없으면 500 계열 예외를 던진다', async () => {
    const { service, accounts, hasher } = await build();
    const account = Account.register({
      id: ACCOUNT_ID,
      email: Email.of('orphan@example.com'),
      credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
      now: FIXED_NOW,
    });
    account.pullEvents();
    await accounts.save(account);
    // customers.provision을 부르지 않았다 — 데이터가 깨진 상태.

    await expect(
      service.execute({ email: 'orphan@example.com', password: VALID_PASSWORD }),
    ).rejects.toThrow(CustomerNotProvisionedError);
  });
});
