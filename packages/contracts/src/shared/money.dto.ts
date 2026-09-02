import { z } from 'zod';

/**
 * 금액 DTO. 도메인의 Money 값 객체가 아니다.
 * JSON에는 bigint가 없으므로 amount를 정수 문자열로 전달한다.
 */
// '0' 또는 앞자리가 0이 아닌 (선택적으로 음수인) 정수 문자열만 허용한다.
// 선행 0('007')과 부호 있는 0('-0')을 거부해 커널의 Money.fromDto와 같은 표준을 쓴다.
const AMOUNT_PATTERN = /^(0|-?[1-9]\d*)$/;

export const moneyDtoSchema = z.object({
  amount: z.string().regex(AMOUNT_PATTERN, '금액은 정규화된 정수 문자열이어야 합니다'),
  currency: z.enum(['KRW', 'USD']),
});

export type MoneyDto = z.infer<typeof moneyDtoSchema>;
