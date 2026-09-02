import type { MoneyDto } from '@commerce/contracts';

/** 통화별 최소 단위 자릿수. 원은 소수가 없고, 달러는 센트라 두 자리다. */
const MINOR_UNIT_DIGITS: Record<MoneyDto['currency'], number> = {
  KRW: 0,
  USD: 2,
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 금액 DTO를 화면 표기로 바꾼다.
 * 이것은 표현 로직이므로 프론트에 있는 것이 맞다 — 계산(합계, 할인)은 서버가 한다.
 */
export function formatMoney(money: MoneyDto): string {
  const digits = MINOR_UNIT_DIGITS[money.currency];
  const isNegative = money.amount.startsWith('-');
  const raw = isNegative ? money.amount.slice(1) : money.amount;
  const padded = raw.padStart(digits + 1, '0');

  const whole = padded.slice(0, padded.length - digits);
  const fraction = digits > 0 ? padded.slice(padded.length - digits) : '';
  const sign = isNegative ? '-' : '';
  const grouped = groupThousands(whole);

  return money.currency === 'KRW' ? `${sign}${grouped}원` : `${sign}$${grouped}.${fraction}`;
}
