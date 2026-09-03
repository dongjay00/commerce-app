import { Duration } from '../../shared/kernel/duration';

const DEFAULT_MINUTES = 15;

/**
 * 예약 TTL. 스펙 §6.2가 정한 자가치유의 시간 단위다 — 이 값이 지나면
 * `ExpireReservationsService`가 예약을 회수한다.
 *
 * 숫자가 아니거나 0 이하면 **부팅을 거부한다.** 잘못된 값으로 뜨면 예약이
 * 즉시 만료되거나 영영 만료되지 않고, 둘 다 조용히 재고를 망가뜨린다.
 */
export function readReservationTtl(env: NodeJS.ProcessEnv): Duration {
  const raw = env['RESERVATION_TTL_MINUTES'];
  if (raw === undefined) {
    return Duration.minutes(DEFAULT_MINUTES);
  }
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error(`RESERVATION_TTL_MINUTES는 양의 정수여야 합니다: "${raw}"`);
  }
  return Duration.minutes(minutes);
}
