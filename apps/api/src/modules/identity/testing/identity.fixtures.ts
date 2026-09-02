import { Duration } from '../../../shared/kernel/duration';

/** 테스트 전반에서 쓰는 고정값. 여러 파일이 같은 값을 다시 타이핑하지 않게 모아둔다. */
export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');
export const REFRESH_TTL = Duration.hours(24 * 14);
export const VALID_PASSWORD = 'correct horse battery staple';
export const OTHER_PASSWORD = 'another valid password 42';
