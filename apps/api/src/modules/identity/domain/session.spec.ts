import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import { Session } from './session';
import { SessionExpiredError, SessionRevokedError } from './session.errors';

const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5c');
const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.hours(24 * 14); // 14일

function issue(): Session {
  return Session.issue({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    refreshTokenHash: 'hash-1',
    now: NOW,
    ttl: TTL,
  });
}

describe('Session.issue', () => {
  it('발급 시각과 TTL로 만료 시각을 계산한다', () => {
    const session = issue();
    expect(session.issuedAt).toEqual(NOW);
    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + TTL.millis));
  });

  it('새 세션은 회전도 폐기도 되지 않은 상태다', () => {
    const session = issue();
    expect(session.rotatedAt).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it('만료 직전에는 활성이고 만료 시각에는 비활성이다', () => {
    const session = issue();
    const justBefore = new Date(session.expiresAt.getTime() - 1);
    expect(session.isActive(justBefore)).toBe(true);
    // 경계는 닫힌 구간이 아니다 — expiresAt 자체는 이미 만료다.
    expect(session.isActive(session.expiresAt)).toBe(false);
  });
});

describe('Session.rotate', () => {
  it('해시를 갈아 끼운다', () => {
    const session = issue();
    session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL });
    expect(session.refreshTokenHash).toBe('hash-2');
  });

  it('만료 시각을 회전 시각 기준으로 다시 잡는다 (sliding window)', () => {
    const session = issue();
    const later = new Date(NOW.getTime() + Duration.hours(24 * 7).millis);
    session.rotate({ refreshTokenHash: 'hash-2', now: later, ttl: TTL });
    expect(session.expiresAt).toEqual(new Date(later.getTime() + TTL.millis));
  });

  it('회전 시각을 기록한다', () => {
    const session = issue();
    const later = new Date(NOW.getTime() + 1000);
    session.rotate({ refreshTokenHash: 'hash-2', now: later, ttl: TTL });
    expect(session.rotatedAt).toEqual(later);
  });

  it('발급 시각은 회전해도 바뀌지 않는다', () => {
    const session = issue();
    session.rotate({ refreshTokenHash: 'hash-2', now: new Date(NOW.getTime() + 1000), ttl: TTL });
    expect(session.issuedAt).toEqual(NOW);
  });

  it('만료된 세션은 회전할 수 없다', () => {
    const session = issue();
    const afterExpiry = new Date(session.expiresAt.getTime() + 1);
    expect(() =>
      session.rotate({ refreshTokenHash: 'hash-2', now: afterExpiry, ttl: TTL }),
    ).toThrow(SessionExpiredError);
  });

  it('만료 시각 정각에도 회전할 수 없다', () => {
    const session = issue();
    expect(() =>
      session.rotate({ refreshTokenHash: 'hash-2', now: session.expiresAt, ttl: TTL }),
    ).toThrow(SessionExpiredError);
  });

  it('폐기된 세션은 회전할 수 없다', () => {
    // 로그아웃 후 옛 리프레시 토큰으로 되살리는 경로를 막는다. 이 검사가 없으면
    // "로그아웃했다"는 사용자의 기대가 거짓이 된다.
    const session = issue();
    session.revoke(NOW);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL })).toThrow(
      SessionRevokedError,
    );
  });

  it('폐기가 만료보다 우선 보고된다', () => {
    // 둘 다 해당할 때 어느 쪽이 나오는지 고정해 둔다. 폐기가 더 구체적인 정보다.
    const session = issue();
    session.revoke(NOW);
    const afterExpiry = new Date(session.expiresAt.getTime() + 1);
    expect(() =>
      session.rotate({ refreshTokenHash: 'hash-2', now: afterExpiry, ttl: TTL }),
    ).toThrow(SessionRevokedError);
  });

  it('회전 실패는 세션 상태를 바꾸지 않는다', () => {
    const session = issue();
    session.revoke(NOW);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL })).toThrow();
    expect(session.refreshTokenHash).toBe('hash-1');
  });
});

describe('Session.revoke', () => {
  it('폐기 시각을 기록하고 비활성이 된다', () => {
    const session = issue();
    session.revoke(NOW);
    expect(session.revokedAt).toEqual(NOW);
    expect(session.isActive(NOW)).toBe(false);
  });

  it('두 번 폐기해도 첫 시각을 유지한다 (멱등)', () => {
    // 로그아웃은 재시도될 수 있다. 두 번째 호출이 시각을 덮어쓰면 "언제 로그아웃했나"가
    // 사라진다.
    const session = issue();
    session.revoke(NOW);
    session.revoke(new Date(NOW.getTime() + 60_000));
    expect(session.revokedAt).toEqual(NOW);
  });
});

describe('Session.rehydrate', () => {
  it('저장된 상태를 그대로 복원한다', () => {
    const expiresAt = new Date(NOW.getTime() + TTL.millis);
    const rotatedAt = new Date(NOW.getTime() + 1000);
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt,
      rotatedAt,
      revokedAt: null,
    });
    expect(session.refreshTokenHash).toBe('hash-9');
    expect(session.rotatedAt).toEqual(rotatedAt);
    expect(session.revokedAt).toBeNull();
  });

  it('폐기된 세션을 복원하면 여전히 폐기 상태다', () => {
    // 매퍼가 revoked_at 컬럼을 흘리면 로그아웃한 세션이 되살아난다.
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL.millis),
      rotatedAt: null,
      revokedAt: NOW,
    });
    expect(session.isActive(NOW)).toBe(false);
    expect(() => session.rotate({ refreshTokenHash: 'x', now: NOW, ttl: TTL })).toThrow(
      SessionRevokedError,
    );
  });

  it('이벤트를 쌓지 않는다', () => {
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL.millis),
      rotatedAt: null,
      revokedAt: null,
    });
    expect(session.hasUncommittedEvents).toBe(false);
  });
});
