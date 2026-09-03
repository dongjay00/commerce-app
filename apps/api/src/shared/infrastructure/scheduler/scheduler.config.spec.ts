import { describe, expect, it } from 'vitest';
import { readSchedulerConfig } from './scheduler.config';

describe('readSchedulerConfig', () => {
  it('아무것도 없으면 켜진 상태에 기본 주기다', () => {
    // 기본이 꺼짐이면 운영에서 변수 하나를 빠뜨렸을 때 자가치유가 조용히 죽는다.
    expect(readSchedulerConfig({})).toEqual({
      enabled: true,
      outboxRelayIntervalMs: 5_000,
      reservationExpiryIntervalMs: 30_000,
    });
  });

  it("정확히 'false'일 때만 꺼진다", () => {
    expect(readSchedulerConfig({ SCHEDULERS_ENABLED: 'false' }).enabled).toBe(false);
    // 오타는 켜진 상태로 남는다 — 안전한 쪽으로 기운 해석이다.
    for (const raw of ['0', 'no', 'FALSE', '']) {
      expect(readSchedulerConfig({ SCHEDULERS_ENABLED: raw }).enabled).toBe(true);
    }
  });

  it('설정한 주기를 쓴다', () => {
    const config = readSchedulerConfig({
      OUTBOX_RELAY_INTERVAL_MS: '1000',
      RESERVATION_EXPIRY_INTERVAL_MS: '2000',
    });
    expect(config.outboxRelayIntervalMs).toBe(1000);
    expect(config.reservationExpiryIntervalMs).toBe(2000);
  });

  it.each(['0', '-1', '1.5', 'abc'])('잘못된 주기 "%s"에는 부팅을 거부한다', (raw) => {
    expect(() => readSchedulerConfig({ OUTBOX_RELAY_INTERVAL_MS: raw })).toThrow(
      'OUTBOX_RELAY_INTERVAL_MS',
    );
    expect(() => readSchedulerConfig({ RESERVATION_EXPIRY_INTERVAL_MS: raw })).toThrow(
      'RESERVATION_EXPIRY_INTERVAL_MS',
    );
  });
});
