import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import type {
  AuthorizePaymentCommand,
  AuthorizePaymentResult,
  AuthorizePaymentUseCase,
} from '../../../../payment';
import { orderUuid } from '../../../testing/ordering.fixtures';
import { InProcessPaymentAdapter } from './in-process-payment.adapter';

class FakeAuthorize implements AuthorizePaymentUseCase {
  readonly calls: AuthorizePaymentCommand[] = [];

  constructor(
    private readonly result: AuthorizePaymentResult | Error = {
      ok: true,
      paymentId: 'payment-1',
      pgTxId: 'pgtx-1',
    },
  ) {}

  async execute(command: AuthorizePaymentCommand): Promise<AuthorizePaymentResult> {
    this.calls.push(command);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

const authorize = (usecase: FakeAuthorize) =>
  new InProcessPaymentAdapter(usecase).authorize({
    orderId: OrderId.of(orderUuid('1')),
    amount: Money.of(12_000n),
  });

describe('InProcessPaymentAdapter', () => {
  it('승인 결과를 옮긴다', async () => {
    expect(await authorize(new FakeAuthorize())).toEqual({
      ok: true,
      paymentId: 'payment-1',
      pgTxId: 'pgtx-1',
    });
  });

  it('거절 결과와 이유를 옮긴다', async () => {
    const result = await authorize(new FakeAuthorize({ ok: false, reason: '한도 초과' }));
    expect(result).toEqual({ ok: false, reason: '한도 초과' });
  });

  it('금액이 문자열로 넘어간다', async () => {
    // bigint는 JSON으로도 DTO로도 나가지 못한다.
    const usecase = new FakeAuthorize();
    await authorize(usecase);
    expect(usecase.calls[0]).toEqual({
      orderId: orderUuid('1'),
      amount: '12000',
      currency: 'KRW',
    });
  });

  it('유스케이스가 던지면 그대로 던진다', async () => {
    // PG 타임아웃은 결과가 아니라 오류다.
    await expect(authorize(new FakeAuthorize(new Error('PG 타임아웃')))).rejects.toThrow(
      'PG 타임아웃',
    );
  });
});
