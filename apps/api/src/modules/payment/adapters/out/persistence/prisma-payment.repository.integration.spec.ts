import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { PaymentId } from '../../../../../shared/kernel/identifiers';
import { CorruptedPaymentError } from '../../../domain/payment.errors';
import { paymentRepositoryContract } from '../../../testing/payment-repository.contract';
import { PrismaPaymentRepository } from './prisma-payment.repository';

paymentRepositoryContract('prisma', async () => new PrismaPaymentRepository(await testDb()));

const insertPayment = async (
  db: Awaited<ReturnType<typeof testDb>>,
  paymentId: string,
  orderId: string,
  status: string,
  currency: string,
): Promise<void> => {
  await db.$executeRawUnsafe(`
    INSERT INTO payments (id, order_id, status, authorized_amount, currency, created_at, updated_at)
    VALUES ('${paymentId}', '${orderId}', '${status}', 1000, '${currency}', now(), now())
  `);
};

describe('PrismaPaymentRepository — 어댑터 전용', () => {
  it('알 수 없는 상태가 저장된 행을 읽으면 CorruptedPaymentError다', async () => {
    // 계약 스위트는 정상 데이터만 다룬다. 손상된 행은 원시 SQL로만 만들 수 있다.
    const db = await testDb();
    const id = '018f2b1c-4a5d-7e6f-8a9b-0d1a00bad001';
    await insertPayment(db, id, '018f2b1c-4a5d-7e6f-8a9b-0d1b00bad001', 'WEIRD', 'KRW');

    await expect(new PrismaPaymentRepository(db).findById(PaymentId.of(id))).rejects.toThrow(
      CorruptedPaymentError,
    );
  });

  it('알 수 없는 통화가 저장된 행을 읽으면 던진다', async () => {
    const db = await testDb();
    const id = '018f2b1c-4a5d-7e6f-8a9b-0d1a00bad002';
    await insertPayment(db, id, '018f2b1c-4a5d-7e6f-8a9b-0d1b00bad002', 'PENDING', 'JPY');

    await expect(new PrismaPaymentRepository(db).findById(PaymentId.of(id))).rejects.toThrow(
      /통화를 해석할 수 없습니다/,
    );
  });

  it('알 수 없는 시도 결과가 저장된 행을 읽으면 던진다', async () => {
    const db = await testDb();
    const id = '018f2b1c-4a5d-7e6f-8a9b-0d1a00bad003';
    await insertPayment(db, id, '018f2b1c-4a5d-7e6f-8a9b-0d1b00bad003', 'PENDING', 'KRW');
    await db.$executeRawUnsafe(`
      INSERT INTO payment_attempts (id, payment_id, pg_tx_id, result, reason, attempted_at)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0d1c00bad003', '${id}', 'weird-tx', 'MAYBE', NULL, now())
    `);

    await expect(new PrismaPaymentRepository(db).findById(PaymentId.of(id))).rejects.toThrow(
      /시도 결과를 해석할 수 없습니다/,
    );
  });

  it('같은 pgTxId를 다른 결제에 넣으면 유니크 위반이다', async () => {
    // 웹훅 멱등성의 근거가 이 제약이다(스펙 §10.8). 도메인의 recordCallback은
    // 같은 결제 안에서만 중복을 막고, 결제를 가로지르는 중복은 DB만 막는다.
    const db = await testDb();
    const first = {
      paymentId: '018f2b1c-4a5d-7e6f-8a9b-0d1a00d00001',
      orderId: '018f2b1c-4a5d-7e6f-8a9b-0d1b00d00001',
      attemptId: '018f2b1c-4a5d-7e6f-8a9b-0d1c00d00001',
    };
    const second = {
      paymentId: '018f2b1c-4a5d-7e6f-8a9b-0d1a00d00002',
      orderId: '018f2b1c-4a5d-7e6f-8a9b-0d1b00d00002',
      attemptId: '018f2b1c-4a5d-7e6f-8a9b-0d1c00d00002',
    };
    for (const row of [first, second]) {
      await insertPayment(db, row.paymentId, row.orderId, 'PENDING', 'KRW');
    }
    const insertAttempt = (row: typeof first) =>
      db.$executeRawUnsafe(`
        INSERT INTO payment_attempts (id, payment_id, pg_tx_id, result, reason, attempted_at)
        VALUES ('${row.attemptId}', '${row.paymentId}', 'shared-tx', 'APPROVED', NULL, now())
      `);

    await insertAttempt(first);
    await expect(insertAttempt(second)).rejects.toThrow();
  });
});
