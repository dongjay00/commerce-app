import { describe, expect, it } from 'vitest';
import { Duration } from '../../shared/kernel/duration';
import { readReservationTtl } from './reservation-ttl.config';

describe('readReservationTtl', () => {
  it('없으면 15분이다', () => {
    expect(readReservationTtl({})).toEqual(Duration.minutes(15));
  });

  it('설정한 분을 쓴다', () => {
    expect(readReservationTtl({ RESERVATION_TTL_MINUTES: '30' })).toEqual(Duration.minutes(30));
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('잘못된 값 "%s"에는 부팅을 거부한다', (raw) => {
    // 잘못된 값으로 뜨면 예약이 즉시 만료되거나 영영 만료되지 않는다.
    expect(() => readReservationTtl({ RESERVATION_TTL_MINUTES: raw })).toThrow(
      'RESERVATION_TTL_MINUTES',
    );
  });
});
