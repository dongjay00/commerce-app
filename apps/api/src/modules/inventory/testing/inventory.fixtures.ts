import { Duration } from '../../../shared/kernel/duration';

export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');
export const RESERVATION_TTL = Duration.minutes(15);

/**
 * UUID 리터럴은 유효한 16진수여야 하고 마지막 그룹이 정확히 12자여야 한다.
 * 접두사 6자 + 패딩된 접미사 6자. `5c` = sku, `5e` = reservation, `0e` = order.
 */
const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

export const skuUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0c1d5c', suffix)}`;
export const reservationUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0c1d5e', suffix)}`;
export const orderUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0c1d0e', suffix)}`;
