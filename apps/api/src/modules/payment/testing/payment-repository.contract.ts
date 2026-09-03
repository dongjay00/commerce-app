import { describe, expect, it } from 'vitest';
import { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import type { PaymentRepository } from '../application/ports/out/payment.repository';
import { Payment } from '../domain/payment';
import { PaymentAttempt } from '../domain/payment-attempt';
import { attemptUuid, FIXED_NOW, orderUuid, paymentUuid } from './payment.fixtures';

/**
 * PaymentRepository 계약. **같은 스위트가 in-memory와 Prisma 양쪽에서 통과해야 한다**
 * (스펙 §9.2). 두 구현의 관측 가능한 동작이 같다는 것이 이 스위트의 주장이다.
 */
export function paymentRepositoryContract(
  name: string,
  createRepo: () => Promise<PaymentRepository>,
): void {
  describe(`PaymentRepository 계약 — ${name}`, () => {
    const open = (suffix: string): Payment =>
      Payment.open({
        id: PaymentId.of(paymentUuid(suffix)),
        orderId: OrderId.of(orderUuid(suffix)),
        amount: Money.of(12_000n),
        now: FIXED_NOW,
      });

    it('저장한 결제를 id로 찾는다', async () => {
      const repo = await createRepo();
      await repo.save(open('1'));

      const found = await repo.findById(PaymentId.of(paymentUuid('1')));
      expect(found?.orderId).toBe(orderUuid('1'));
      expect(found?.amount.amount).toBe(12_000n);
      expect(found?.status).toBe('PENDING');
    });

    it('없는 id는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(PaymentId.of(paymentUuid('99')))).toBeNull();
    });

    it('주문 id로 찾는다', async () => {
      const repo = await createRepo();
      await repo.save(open('2'));
      const found = await repo.findByOrderId(OrderId.of(orderUuid('2')));
      expect(found?.id).toBe(paymentUuid('2'));
    });

    it('없는 주문 id는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findByOrderId(OrderId.of(orderUuid('98')))).toBeNull();
    });

    it('상태 변화가 저장된다', async () => {
      const repo = await createRepo();
      const payment = open('3');
      await repo.save(payment);

      payment.authorize(new PaymentAttempt(attemptUuid('3'), 'pg-3', 'APPROVED', null, FIXED_NOW));
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('3')));
      expect(found?.status).toBe('AUTHORIZED');
    });

    it('시도 이력이 저장되고 attemptedAt 오름차순으로 복원된다', async () => {
      // 이력이 사라지면 웹훅 멱등성의 근거가 사라진다.
      //
      // **나중 시각을 먼저 넣는다.** 삽입 순서와 시각 순서를 같게 두면 정렬을
      // 지워도 통과해 이 테스트가 아무것도 검증하지 못한다 — 실측으로 확인했다.
      const repo = await createRepo();
      const payment = open('4');
      payment.recordCallback(
        new PaymentAttempt(
          attemptUuid('42'),
          'pg-42',
          'APPROVED',
          null,
          new Date(FIXED_NOW.getTime() + 1000),
        ),
      );
      payment.recordCallback(
        new PaymentAttempt(attemptUuid('41'), 'pg-41', 'DECLINED', '한도 초과', FIXED_NOW),
      );
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('4')));
      expect(found?.attempts.map((a) => a.pgTxId)).toEqual(['pg-41', 'pg-42']);
      expect(found?.attempts[0]?.reason).toBe('한도 초과');
      expect(found?.attempts[1]?.reason).toBeNull();
    });

    it('같은 결제를 두 번 저장해도 시도가 중복되지 않는다', async () => {
      // save는 upsert다. 시도를 append-only로 다루면 두 번째 save가 이력을 두 배로 만든다.
      const repo = await createRepo();
      const payment = open('5');
      payment.authorize(new PaymentAttempt(attemptUuid('5'), 'pg-5', 'APPROVED', null, FIXED_NOW));
      await repo.save(payment);
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('5')));
      expect(found?.attempts).toHaveLength(1);
    });

    it('돌려준 결제를 바꿔도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(open('6'));

      const first = await repo.findByOrderId(OrderId.of(orderUuid('6')));
      first?.authorize(new PaymentAttempt(attemptUuid('6'), 'pg-6', 'APPROVED', null, FIXED_NOW));

      const second = await repo.findByOrderId(OrderId.of(orderUuid('6')));
      expect(second?.status).toBe('PENDING');
    });
  });
}
