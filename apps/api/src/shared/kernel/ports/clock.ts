/**
 * 현재 시각 포트.
 * 도메인과 유스케이스는 절대 `new Date()`나 `Date.now()`를 직접 부르지 않는다.
 * 그러면 TTL 만료 테스트에서 15분을 실제로 기다려야 한다.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
