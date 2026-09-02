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

  it('풀이 20이라 20개의 pg_sleep(0.3) 쿼리가 직렬화 없이 병렬로 끝난다', async () => {
    const db = await testDb();
    // Promise.all(N개) 성공 개수만 세면 풀 크기가 1이어도 그냥 순차 대기 후 전부
    // 성공하므로 풀 크기를 구분하지 못한다 — 이 테스트가 고치려는 결함이 정확히 그것이다.
    // 대신 풀이 직렬화하면만 관측되는 벽시계 시간을 잰다: 풀이 1이면 20 * 0.3s = 6s 이상
    // 걸리고, 풀이 20(이상)이면 오버헤드를 감안해도 1.5s 안에 끝난다.
    // pg_sleep은 void를 반환해 Prisma가 역직렬화하지 못하므로 IS NULL로 boolean으로 캐스팅한다.
    const started = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => db.$queryRaw`SELECT pg_sleep(0.3) IS NULL`));
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
