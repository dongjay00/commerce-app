import { describe, expect, it } from 'vitest';
import { AccountId, CorruptedRecordError } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { Credential } from '../../../domain/credential';
import { CorruptedEmailError, Email } from '../../../domain/email';
import { toAccountDomain, toAccountRow } from './account.mapper';

const ID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3ff001';
const CREATED = new Date('2026-03-01T10:00:00.000Z');
const UPDATED = new Date('2026-04-01T10:00:00.000Z');

const row = {
  id: ID,
  email: 'user@example.com',
  passwordHash: '$argon2id$hash',
  createdAt: CREATED,
  updatedAt: UPDATED,
};

describe('account.mapper', () => {
  it('행을 애그리거트로 복원한다', () => {
    const account = toAccountDomain(row);
    expect(account.id).toBe(ID);
    expect(account.email.value).toBe('user@example.com');
    expect(account.credential.hash).toBe('$argon2id$hash');
    expect(account.createdAt).toEqual(CREATED);
    expect(account.updatedAt).toEqual(UPDATED);
  });

  it('복원된 애그리거트는 미커밋 이벤트를 갖지 않는다', () => {
    expect(toAccountDomain(row).hasUncommittedEvents).toBe(false);
  });

  it('애그리거트를 행으로 되돌린다', () => {
    const account = Account.rehydrate({
      id: AccountId.of(ID),
      email: Email.of('user@example.com'),
      credential: Credential.fromHash('$argon2id$hash'),
      createdAt: CREATED,
      updatedAt: UPDATED,
    });
    expect(toAccountRow(account)).toEqual(row);
  });

  it('깨진 UUID를 만나면 CorruptedRecordError를 던진다 — DomainError가 아니다', () => {
    // M7. `of`를 쓰면 InvalidIdError(400)가 나가서, 우리 DB가 깨진 상황에
    // "당신의 요청이 잘못됐다"고 답하게 된다.
    expect(() => toAccountDomain({ ...row, id: 'broken' })).toThrow(CorruptedRecordError);
  });

  it('깨진 이메일을 만나면 CorruptedEmailError를 던진다 — DomainError가 아니다', () => {
    // I2/M7. `of`를 쓰면 InvalidEmailError(400)가 나가서, 우리 DB가 깨진 상황에
    // "당신의 요청이 잘못됐다"고 답하게 된다. 저장된 accounts.email이 형식을 어긴
    // 것은 클라이언트 잘못이 아니다.
    expect(() => toAccountDomain({ ...row, email: '   ' })).toThrow(CorruptedEmailError);
  });

  it('왕복해도 값이 보존된다', () => {
    expect(toAccountRow(toAccountDomain(row))).toEqual(row);
  });
});
