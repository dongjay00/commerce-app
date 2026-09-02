import type { PrismaClient } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
import { asPrismaClient, PrismaTransactionManager } from './prisma-transaction-manager';

let db: PrismaClient;
let manager: PrismaTransactionManager;

beforeAll(async () => {
  db = await testDb();
  manager = new PrismaTransactionManager(db);
});

function outboxRow(id: string) {
  return {
    id,
    aggregateType: 'Sample',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    eventType: 'SampleHappened',
    payload: {},
    occurredAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('PrismaTransactionManager', () => {
  it('work가 정상 종료하면 커밋된다', async () => {
    await manager.run(async (tx) => {
      await asPrismaClient(tx).outbox.create({
        data: outboxRow('0192f3a0-2222-7abc-8def-000000000001'),
      });
    });

    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('work가 예외를 던지면 롤백된다', async () => {
    await expect(
      manager.run(async (tx) => {
        await asPrismaClient(tx).outbox.create({
          data: outboxRow('0192f3a0-2222-7abc-8def-000000000002'),
        });
        throw new Error('의도된 실패');
      }),
    ).rejects.toThrow('의도된 실패');

    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('work의 반환값을 그대로 전달한다', async () => {
    await expect(manager.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('트랜잭션 안에서 쓴 데이터를 같은 트랜잭션 안에서 읽을 수 있다', async () => {
    const count = await manager.run(async (tx) => {
      const client = asPrismaClient(tx);
      await client.outbox.create({ data: outboxRow('0192f3a0-2222-7abc-8def-000000000003') });
      return client.outbox.count();
    });

    expect(count).toBe(1);
  });
});
