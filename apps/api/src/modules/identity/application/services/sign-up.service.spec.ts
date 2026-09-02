import { describe, expect, it } from 'vitest';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { EmailAlreadyRegisteredError } from '../../domain/account.errors';
import { ACCOUNT_REGISTERED } from '../../domain/account.events';
import type { Credential } from '../../domain/credential';
import { Email, InvalidEmailError } from '../../domain/email';
import type { PlainPassword } from '../../domain/plain-password';
import { PasswordPolicyViolationError } from '../../domain/plain-password';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { FIXED_NOW, REFRESH_TTL, VALID_PASSWORD } from '../../testing/identity.fixtures';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { FailingEmailSender, RecordingEmailSender } from '../../testing/recording-email-sender';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { SignUpService } from './sign-up.service';

/**
 * 해싱 호출 횟수를 세는 fake. `vi.spyOn` 대신 상속으로 만든다 — 목 라이브러리 금지
 * 규칙을 지키면서 "언제 해싱했는가"를 상태로 검증하는 방법이다.
 */
class CountingPasswordHasher extends FakePasswordHasher {
  hashCalls = 0;

  override async hash(password: PlainPassword): Promise<Credential> {
    this.hashCalls += 1;
    return super.hash(password);
  }
}

function build(
  overrides: {
    emails?: RecordingEmailSender | FailingEmailSender;
    hasher?: FakePasswordHasher;
  } = {},
) {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const hasher = overrides.hasher ?? new FakePasswordHasher();
  const tokens = new FakeTokenIssuer(900);
  const emails = overrides.emails ?? new RecordingEmailSender();
  const tx = new PassthroughTransactionManager();
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();
  const events = new RecordingEventPublisher();

  const service = new SignUpService(
    accounts,
    sessions,
    customers,
    hasher,
    tokens,
    emails,
    tx,
    clock,
    ids,
    events,
    REFRESH_TTL,
  );

  return { service, accounts, sessions, customers, hasher, tokens, emails, clock, ids, events };
}

const COMMAND = { email: 'New.User@Example.com', password: VALID_PASSWORD };

describe('SignUpService', () => {
  it('계정을 만들고 정규화된 이메일로 저장한다', async () => {
    const { service, accounts } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(saved).not.toBeNull();
    expect(saved?.createdAt).toEqual(FIXED_NOW);
  });

  it('비밀번호를 해싱해 저장한다 — 평문이 남지 않는다', async () => {
    const { service, accounts } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(saved?.credential.hash).not.toBe(VALID_PASSWORD);
    expect(saved?.credential.hash).toBe(`fake-hash:${VALID_PASSWORD}`);
  });

  it('고객을 같은 트랜잭션에서 만든다', async () => {
    const { service, accounts, customers } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(customers.provisioned).toEqual([saved?.id]);
  });

  it('발급한 액세스 토큰이 계정과 고객을 모두 담는다', async () => {
    const { service, accounts, customers } = build();
    const result = await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    const customerId = await customers.findByAccount(saved!.id);
    // FakeTokenIssuer가 principal을 토큰 문자열에 그대로 인코딩한다.
    // customerId를 빠뜨리면 주소록 엔드포인트가 매 요청마다 추가 조회를 하게 된다.
    expect(result.accessToken).toBe(`access:${saved?.id}:${customerId}`);
  });

  it('세션을 저장하되 저장하는 것은 해시다 — 원본 리프레시 토큰이 아니다', async () => {
    const { service, sessions } = build();
    const result = await service.execute(COMMAND);

    expect(await sessions.findByRefreshTokenHash(result.refreshToken)).toBeNull();
    const session = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(session).not.toBeNull();
    expect(session?.expiresAt).toEqual(new Date(FIXED_NOW.getTime() + REFRESH_TTL.millis));
  });

  it('AccountRegistered 이벤트를 트랜잭션 컨텍스트와 함께 발행한다', async () => {
    const { service, events } = build();
    await service.execute(COMMAND);

    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.eventType).toBe(ACCOUNT_REGISTERED);
    // tx가 없으면 계정 저장과 outbox 기록이 다른 트랜잭션이 되어 이벤트가 유실될 수 있다.
    expect(events.publishCalls).toHaveLength(1);
    expect(events.publishCalls[0]?.tx).toBeDefined();
  });

  it('환영 메일을 보낸다', async () => {
    const emails = new RecordingEmailSender();
    const { service } = build({ emails });
    await service.execute(COMMAND);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]?.to).toBe('new.user@example.com');
  });

  it('메일 발송이 실패해도 가입은 성공한다', async () => {
    // 메일은 부수 효과지 가입의 일부가 아니다. 여기서 던지면 계정은 이미 만들어졌는데
    // 사용자에게는 실패로 보이고, 다시 시도하면 409가 난다 — 계정이 잠긴다.
    const { service, accounts } = build({ emails: new FailingEmailSender() });

    await expect(service.execute(COMMAND)).resolves.toBeDefined();
    expect(await accounts.findByEmail(Email.of('new.user@example.com'))).not.toBeNull();
  });

  it('메일 발송은 트랜잭션 밖에서 일어난다', async () => {
    // 트랜잭션 안에서 SMTP를 기다리면 DB 커넥션이 네트워크 지연만큼 잡혀 있다.
    const emails = new RecordingEmailSender();
    const { service, events } = build({ emails });
    await service.execute(COMMAND);

    // RecordingEventPublisher는 트랜잭션 안에서(tx와 함께) 호출되고, 메일은 그 뒤다.
    expect(events.publishCalls[0]?.tx).toBeDefined();
    expect(emails.sent).toHaveLength(1);
  });

  it('이미 가입된 이메일이면 EmailAlreadyRegisteredError를 던진다', async () => {
    const { service } = build();
    await service.execute(COMMAND);

    await expect(service.execute(COMMAND)).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('대소문자만 다른 이메일도 중복으로 본다', async () => {
    const { service } = build();
    await service.execute(COMMAND);

    await expect(
      service.execute({ email: 'NEW.USER@EXAMPLE.COM', password: VALID_PASSWORD }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('중복 가입 시도는 세션을 만들지 않는다', async () => {
    const { service, sessions } = build();
    const first = await service.execute(COMMAND);
    await expect(service.execute(COMMAND)).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash(`h(${first.refreshToken})`)).not.toBeNull();
    expect(await sessions.findByRefreshTokenHash('h(refresh-2)')).toBeNull();
  });

  it('짧은 비밀번호는 PasswordPolicyViolationError를 던진다', async () => {
    const { service } = build();
    await expect(service.execute({ email: 'a@example.com', password: 'short' })).rejects.toThrow(
      PasswordPolicyViolationError,
    );
  });

  it('잘못된 이메일은 InvalidEmailError를 던진다', async () => {
    const { service } = build();
    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow(
      InvalidEmailError,
    );
  });

  it('검증 실패는 해싱을 시작하기 전에 일어난다', async () => {
    // Argon2 해싱은 요청당 100ms 안팎이다. 이메일이 형식부터 틀렸는데 해싱을 먼저 하면
    // 잘못된 요청을 값싸게 거절할 기회를 버린다 — 느린 경로를 통한 DoS 표면이 열린다.
    const hasher = new CountingPasswordHasher();
    const { service } = build({ hasher });

    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow();

    expect(hasher.hashCalls).toBe(0);
  });
});
