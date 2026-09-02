import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../shared/kernel/identifiers';
import { Account } from './account';
import { ACCOUNT_REGISTERED } from './account.events';
import { Credential } from './credential';
import { Email } from './email';

const ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b');
const EMAIL = Email.of('user@example.com');
const CREDENTIAL = Credential.fromHash('$argon2id$hash-one');
const NOW = new Date('2026-03-01T10:00:00.000Z');

describe('Account.register', () => {
  it('전달된 값으로 계정을 만든다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.id).toBe(ID);
    expect(account.email.equals(EMAIL)).toBe(true);
    expect(account.credential.equals(CREDENTIAL)).toBe(true);
  });

  it('생성 시각을 주입된 시각으로 쓴다 — new Date()를 부르지 않는다', () => {
    // Clock 포트를 우회해 `new Date()`를 쓰면 이 단언이 깨진다. 시간 의존 테스트가
    // 전부 불안정해지는 종류의 회귀라 여기서 못박는다.
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.createdAt).toEqual(NOW);
    expect(account.updatedAt).toEqual(NOW);
  });

  it('AccountRegistered 이벤트를 쌓는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.hasUncommittedEvents).toBe(true);

    const [event, ...rest] = account.pullEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      eventType: ACCOUNT_REGISTERED,
      aggregateType: 'Account',
      aggregateId: ID,
      occurredAt: NOW,
    });
  });

  it('이벤트 payload는 JSON 직렬화 가능한 값만 담는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    const [event] = account.pullEvents();
    // outbox의 payload 컬럼이 JsonB다. VO를 그대로 넣으면 직렬화가 조용히 {}가 된다.
    expect(event?.payload).toEqual({ accountId: ID, email: 'user@example.com' });
    expect(JSON.parse(JSON.stringify(event?.payload))).toEqual(event?.payload);
  });

  it('이벤트 payload에 비밀번호 해시를 담지 않는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    const [event] = account.pullEvents();
    // outbox 행은 사실상 영구 보존되는 로그다. 해시를 담으면 오프라인 크래킹 대상이
    // 하나 더 늘어난다.
    expect(JSON.stringify(event?.payload)).not.toContain('argon2');
  });
});

describe('Account.rehydrate', () => {
  it('저장된 상태를 복원한다', () => {
    const later = new Date('2026-04-01T00:00:00.000Z');
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: later,
    });
    expect(account.createdAt).toEqual(NOW);
    expect(account.updatedAt).toEqual(later);
  });

  it('이벤트를 쌓지 않는다', () => {
    // 복원이 이벤트를 쌓으면 리포지토리가 계정을 읽을 때마다 AccountRegistered가
    // outbox에 다시 들어간다 — 가입 메일이 조회할 때마다 나간다.
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(account.hasUncommittedEvents).toBe(false);
    expect(account.pullEvents()).toEqual([]);
  });
});

describe('Account.changeCredential', () => {
  it('자격증명과 갱신 시각을 바꾼다', () => {
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const next = Credential.fromHash('$argon2id$hash-two');
    const changedAt = new Date('2026-05-01T00:00:00.000Z');

    account.changeCredential(next, changedAt);

    expect(account.credential.equals(next)).toBe(true);
    expect(account.updatedAt).toEqual(changedAt);
    expect(account.createdAt).toEqual(NOW);
  });

  it('이벤트를 쌓지 않는다', () => {
    // 비밀번호 변경 이벤트를 구독하는 곳이 없다. 발행하면 outbox에 아무도 읽지 않는
    // 행이 쌓이고, payload에 무엇을 담을지 고민만 는다 (YAGNI).
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    account.changeCredential(Credential.fromHash('$argon2id$hash-two'), NOW);
    expect(account.hasUncommittedEvents).toBe(false);
  });

  it('이메일은 바꾸지 않는다', () => {
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    account.changeCredential(Credential.fromHash('$argon2id$hash-two'), NOW);
    expect(account.email.equals(EMAIL)).toBe(true);
  });
});
