import { describe, expect, it } from 'vitest';
import {
  AccountId,
  CorruptedRecordError,
  SessionId,
} from '../../../../../shared/kernel/identifiers';
import { Session } from '../../../domain/session';
import { toSessionDomain, toSessionRow } from './session.mapper';

const ID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3ff101';
const ACCOUNT_ID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3ff001';
const ISSUED = new Date('2026-03-01T10:00:00.000Z');
const EXPIRES = new Date('2026-03-15T10:00:00.000Z');
const ROTATED = new Date('2026-03-05T10:00:00.000Z');
const REVOKED = new Date('2026-03-10T10:00:00.000Z');

const row = {
  id: ID,
  accountId: ACCOUNT_ID,
  refreshTokenHash: 'hash-value',
  issuedAt: ISSUED,
  expiresAt: EXPIRES,
  rotatedAt: null,
  revokedAt: null,
};

describe('session.mapper', () => {
  it('행을 애그리거트로 복원한다', () => {
    const session = toSessionDomain(row);
    expect(session.id).toBe(ID);
    expect(session.accountId).toBe(ACCOUNT_ID);
    expect(session.refreshTokenHash).toBe('hash-value');
    expect(session.issuedAt).toEqual(ISSUED);
    expect(session.expiresAt).toEqual(EXPIRES);
    expect(session.rotatedAt).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it('rotatedAt과 revokedAt이 있는 행도 null 아닌 값 그대로 복원한다', () => {
    const session = toSessionDomain({ ...row, rotatedAt: ROTATED, revokedAt: REVOKED });
    expect(session.rotatedAt).toEqual(ROTATED);
    expect(session.revokedAt).toEqual(REVOKED);
  });

  it('복원된 애그리거트는 미커밋 이벤트를 갖지 않는다', () => {
    expect(toSessionDomain(row).hasUncommittedEvents).toBe(false);
  });

  it('애그리거트를 행으로 되돌린다', () => {
    const session = Session.rehydrate({
      id: SessionId.of(ID),
      accountId: AccountId.of(ACCOUNT_ID),
      refreshTokenHash: 'hash-value',
      issuedAt: ISSUED,
      expiresAt: EXPIRES,
      rotatedAt: ROTATED,
      revokedAt: REVOKED,
    });
    expect(toSessionRow(session)).toEqual({ ...row, rotatedAt: ROTATED, revokedAt: REVOKED });
  });

  it('깨진 account_id를 만나면 CorruptedRecordError를 던진다 — DomainError가 아니다', () => {
    // M7. `of`를 쓰면 InvalidIdError(400)가 나가서, 우리 DB가 깨진 상황에
    // "당신의 요청이 잘못됐다"고 답하게 된다.
    expect(() => toSessionDomain({ ...row, accountId: 'broken' })).toThrow(CorruptedRecordError);
  });

  it('왕복해도 값이 보존된다', () => {
    expect(toSessionRow(toSessionDomain(row))).toEqual(row);
  });
});
