import { Inject, Injectable } from '@nestjs/common';
import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';
import { AUTHORIZE_PAYMENT_USECASE, type AuthorizePaymentUseCase } from '../../../../payment';
import type {
  AuthorizeOutcome,
  PaymentGateway,
} from '../../../application/ports/out/payment.gateway';

/**
 * Payment로 나가는 ACL. **PG를 직접 부르지 않는다** — payment 모듈을 부른다(스펙 §7.4).
 *
 * 결과 유니온을 그대로 옮긴다. 두 유니온의 모양이 같은 것은 우연이 아니라 같은
 * 판단(거절은 결과, 오류는 예외)에서 나온 것이고, 모양이 갈라지는 순간 이 파일만 바뀐다.
 */
@Injectable()
export class InProcessPaymentAdapter implements PaymentGateway {
  constructor(
    @Inject(AUTHORIZE_PAYMENT_USECASE) private readonly authorizePayment: AuthorizePaymentUseCase,
  ) {}

  async authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome> {
    const result = await this.authorizePayment.execute({
      orderId: params.orderId,
      amount: params.amount.amount.toString(),
      currency: params.amount.currency,
    });
    return result.ok
      ? { ok: true, paymentId: result.paymentId, pgTxId: result.pgTxId }
      : { ok: false, reason: result.reason };
  }
}
