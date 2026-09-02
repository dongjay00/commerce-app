import { z } from 'zod';

/**
 * 금액 DTO. 도메인의 Money 값 객체가 아니다.
 * JSON에는 bigint가 없으므로 amount를 정수 문자열로 전달한다.
 */
export const moneyDtoSchema = z.object({
  amount: z.string().regex(/^-?\d+$/, '금액은 정수 문자열이어야 합니다'),
  currency: z.enum(['KRW', 'USD']),
});

export type MoneyDto = z.infer<typeof moneyDtoSchema>;
