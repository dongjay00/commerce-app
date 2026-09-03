import { describe, expect, it } from 'vitest';
import { AUTHORIZE_PAYMENT_USECASE } from './in/authorize-payment.usecase';
import { HANDLE_PG_CALLBACK_USECASE } from './in/handle-pg-callback.usecase';
import { REFUND_PAYMENT_USECASE } from './in/refund-payment.usecase';
import { PAYMENT_REPOSITORY } from './out/payment.repository';
import { PG_CLIENT } from './out/pg-client';

/**
 * 포트 토큰의 정체성을 고정한다.
 *
 * 커버리지: 포트 파일은 인터페이스와 `Symbol` 하나가 전부라 `import type`으로만
 * 쓰이면 런타임에 로드되지 않고, Vitest의 `coverage.all`이 켜져 있어 0%로 잡혀
 * application 임계값(90/85)을 실패시킨다.
 *
 * 본론: Nest는 심볼의 **정체성**으로 해석하므로 다른 포트 파일에
 * `Symbol('PgClient')`를 복붙해도 배선은 동작한다 — 다만 해석 실패 메시지가
 * 엉뚱한 포트 이름을 댄다.
 */
describe('Payment 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: PAYMENT_REPOSITORY, name: 'PaymentRepository' },
    { token: PG_CLIENT, name: 'PgClient' },
    { token: AUTHORIZE_PAYMENT_USECASE, name: 'AuthorizePaymentUseCase' },
    { token: REFUND_PAYMENT_USECASE, name: 'RefundPaymentUseCase' },
    { token: HANDLE_PG_CALLBACK_USECASE, name: 'HandlePgCallbackUseCase' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('토큰들은 서로 다르다', () => {
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);
  });
});
