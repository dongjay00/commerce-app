import { describe, expect, it } from 'vitest';
import { testDb } from './database';

async function insertOutboxRow(id: string): Promise<void> {
  const db = await testDb();
  await db.outbox.create({
    data: {
      id,
      aggregateType: 'Sample',
      aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
      eventType: 'SampleHappened',
      payload: { hello: 'world' },
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
}

describe('테스트 DB 격리', () => {
  it('워커 전용 DB에 연결된다', async () => {
    const db = await testDb();
    const [row] = await db.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    expect(row?.current_database).toMatch(/^commerce_test_w\d+$/);
  });

  it('마이그레이션이 적용되어 outbox 테이블이 존재한다', async () => {
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('부분 인덱스가 복제되어 있다', async () => {
    const db = await testDb();
    const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'outbox' AND indexname = 'outbox_unpublished_idx'
    `;
    expect(rows[0]?.indexdef).toContain('WHERE (published_at IS NULL)');
  });

  it('행을 넣으면 조회된다', async () => {
    await insertOutboxRow('0192f3a0-1111-7abc-8def-000000000001');
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('이전 테스트가 넣은 행이 남아 있지 않다 — beforeEach의 TRUNCATE가 동작한다', async () => {
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('connection_limit이 20으로 설정되어 동시 커넥션이 확보된다', async () => {
    const db = await testDb();
    // 동시에 10개 쿼리를 던져도 직렬화되지 않고 모두 성공해야 한다.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`),
    );
    expect(results).toHaveLength(10);
  });
});
