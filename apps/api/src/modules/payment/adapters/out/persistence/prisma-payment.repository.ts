import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { PaymentRepository } from '../../../application/ports/out/payment.repository';
import type { Payment } from '../../../domain/payment';
import { toPaymentDomain } from './payment.mapper';

/** 시도는 `attemptedAt` 오름차순으로 읽는다 — 이력의 순서가 곧 사건의 순서다. */
const INCLUDE_ATTEMPTS = { attempts: { orderBy: { attemptedAt: 'asc' } } } as const;

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: PaymentId, tx?: TransactionContext): Promise<Payment | null> {
    const row = await this.client(tx).payment.findUnique({
      where: { id },
      include: INCLUDE_ATTEMPTS,
    });
    return row === null ? null : toPaymentDomain(row);
  }

  async findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Payment | null> {
    const row = await this.client(tx).payment.findUnique({
      where: { orderId },
      include: INCLUDE_ATTEMPTS,
    });
    return row === null ? null : toPaymentDomain(row);
  }

  /**
   * upsert + 시도는 **없는 것만 추가한다.**
   *
   * 시도를 지우고 다시 넣지 않는 이유: `payment_attempts.pg_tx_id`가 유니크이고
   * 웹훅 멱등성이 그 위에 서 있다. 삭제 후 재삽입은 그 유니크가 지키던 것을 매 저장마다
   * 잠깐씩 풀어놓는다. `createMany` + `skipDuplicates`가 append-only 시맨틱을 그대로 준다.
   *
   * `createdAt`/`updatedAt`에 `new Date()`를 쓰는 것이 이 파일에서 유일하게 `Clock`을
   * 우회하는 지점이다. 두 컬럼은 감사용 메타데이터이고 도메인 판단에 쓰이지 않는다 —
   * 어떤 테스트도 단언하지 않고 어떤 불변식도 의존하지 않는다. 도메인이 시각을
   * 필요로 하는 곳(`attemptedAt`)은 전부 `Clock`에서 온 값을 애그리거트가 들고 온다.
   * 계획 2의 `PrismaAccountRepository`가 같은 판단을 했다.
   */
  async save(payment: Payment, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const now = new Date();

    await client.payment.upsert({
      where: { id: payment.id },
      create: {
        id: payment.id,
        orderId: payment.orderId,
        status: payment.status,
        authorizedAmount: payment.amount.amount,
        currency: payment.amount.currency,
        createdAt: now,
        updatedAt: now,
      },
      update: { status: payment.status, updatedAt: now },
    });

    if (payment.attempts.length > 0) {
      await client.paymentAttempt.createMany({
        data: payment.attempts.map((attempt) => ({
          id: attempt.id,
          paymentId: payment.id,
          pgTxId: attempt.pgTxId,
          result: attempt.result,
          reason: attempt.reason,
          attemptedAt: attempt.attemptedAt,
        })),
        skipDuplicates: true,
      });
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
