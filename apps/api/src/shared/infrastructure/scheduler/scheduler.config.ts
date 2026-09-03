export interface SchedulerConfig {
  readonly enabled: boolean;
  readonly outboxRelayIntervalMs: number;
  readonly reservationExpiryIntervalMs: number;
}

/** 계획 2의 `readJwtConfig`와 같은 형태 — 없으면 기본값, 잘못됐으면 부팅 거부. */
function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}은 양의 정수여야 합니다: "${raw}"`);
  }
  return value;
}

/**
 * 스케줄러는 **기본으로 켜지고 테스트에서만 꺼진다.** 반대로 하면(기본 꺼짐)
 * 운영 배포에서 환경변수 하나를 빠뜨렸을 때 TTL 자가치유가 조용히 죽는다 —
 * 그리고 그 사실은 재고가 영원히 예약 상태로 쌓인 뒤에야 드러난다.
 *
 * 끄는 값은 정확히 `'false'` 하나다. 오타(`'0'`, `'no'`)는 켜진 상태로 남는다 —
 * 안전한 쪽으로 기운 해석이다.
 */
export function readSchedulerConfig(env: NodeJS.ProcessEnv): SchedulerConfig {
  return {
    enabled: env['SCHEDULERS_ENABLED'] !== 'false',
    outboxRelayIntervalMs: positiveInt(
      env['OUTBOX_RELAY_INTERVAL_MS'],
      5_000,
      'OUTBOX_RELAY_INTERVAL_MS',
    ),
    reservationExpiryIntervalMs: positiveInt(
      env['RESERVATION_EXPIRY_INTERVAL_MS'],
      30_000,
      'RESERVATION_EXPIRY_INTERVAL_MS',
    ),
  };
}

export const SCHEDULER_CONFIG = Symbol('SchedulerConfig');
