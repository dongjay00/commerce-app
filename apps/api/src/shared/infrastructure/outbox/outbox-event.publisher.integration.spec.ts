import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
import type { DomainEvent } from '../../kernel/domain-event';
import { SequentialIdGenerator } from '../../testing/sequential-id-generator';
import { PrismaTransactionManager } from '../prisma/prisma-transaction-manager';
import { OutboxEventPublisher } from './outbox-event.publisher';

let db: PrismaClient;
let ids: SequentialIdGenerator;
let publisher: OutboxEventPublisher;
let transactions: PrismaTransactionManager;

const AGGREGATE_ID = '0192f3a0-1234-7abc-8def-0123456789ab';

function event(eventType: string, payload: Record<string, unknown> = {}): DomainEvent {
  return {
    eventType,
    aggregateType: 'Order',
    aggregateId: AGGREGATE_ID,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    payload,
  };
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(() => {
  ids = new SequentialIdGenerator('0192f3a0-9999-7abc-8def-');
  publisher = new OutboxEventPublisher(db, ids);
  transactions = new PrismaTransactionManager(db);
});

describe('OutboxEventPublisher', () => {
  it('이벤트를 outbox 행으로 저장한다', async () => {
    await publisher.publish([event('OrderPlaced')]);

    const rows = await db.outbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('OrderPlaced');
    expect(rows[0]?.aggregateType).toBe('Order');
    expect(rows[0]?.aggregateId).toBe(AGGREGATE_ID);
  });

  it('저장 직후 published_at은 비어 있다 — 릴레이가 아직 보내지 않았다', async () => {
    await publisher.publish([event('OrderPlaced')]);
    const [row] = await db.outbox.findMany();
    expect(row?.publishedAt).toBeNull();
  });

  it('payload가 JSON으로 왕복 보존된다', async () => {
    await publisher.publish([event('OrderPaid', { amount: '15000', currency: 'KRW' })]);
    const [row] = await db.outbox.findMany();
    expect(row?.payload).toEqual({ amount: '15000', currency: 'KRW' });
  });

  it('빈 배열이면 아무 행도 만들지 않는다', async () => {
    await publisher.publish([]);
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('여러 이벤트를 한 번에 저장한다', async () => {
    await publisher.publish([event('OrderPlaced'), event('OrderPaid')]);
    await expect(db.outbox.count()).resolves.toBe(2);
  });

  it('트랜잭션과 함께 발행하면 커밋 시 함께 저장된다', async () => {
    await transactions.run(async (tx) => {
      await publisher.publish([event('OrderPaid')], tx);
    });

    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('트랜잭션이 롤백되면 이벤트 행도 사라진다 — Outbox를 쓰는 이유 자체', async () => {
    await expect(
      transactions.run(async (tx) => {
        await publisher.publish([event('OrderPaid')], tx);
        throw new Error('저장 중 실패');
      }),
    ).rejects.toThrow('저장 중 실패');

    await expect(db.outbox.count()).resolves.toBe(0);
  });
});
