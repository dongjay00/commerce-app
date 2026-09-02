import { z } from 'zod';

/**
 * 프론트엔드가 분기 기준으로 쓰는 에러 코드.
 * HTTP 상태 코드는 거칠어서(422 하나에 여러 원인) 코드로 구분한다.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  DOMAIN_RULE_VIOLATED = 'DOMAIN_RULE_VIOLATED',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',
  PAYMENT_DECLINED = 'PAYMENT_DECLINED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const errorDtoSchema = z.object({
  code: z.nativeEnum(ErrorCode),
  message: z.string().min(1),
});

export type ErrorDto = z.infer<typeof errorDtoSchema>;
