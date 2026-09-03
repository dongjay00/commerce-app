const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

/**
 * 마지막 그룹은 **16진수 12자리**여야 한다. 마커에 16진수가 아닌 글자를 쓰면
 * `InvalidIdError`가 난다 — 계획 3에서 `'l'`과 `'ver'`로 두 번 깨졌다.
 */
export const paymentUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1a00', suffix)}`;
export const orderUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1b00', suffix)}`;
export const attemptUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1c00', suffix)}`;
export const FIXED_NOW = new Date('2026-03-01T00:00:00.000Z');
