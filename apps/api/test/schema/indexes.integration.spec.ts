import { beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../setup/database';

interface IndexRow {
  indexdef: string;
}

async function indexDefinition(name: string): Promise<string | null> {
  const db = await testDb();
  const rows = await db.$queryRaw<IndexRow[]>`
    SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ${name}
  `;
  return rows[0]?.indexdef ?? null;
}

describe('부분 인덱스가 마이그레이션에 남아 있는지', () => {
  // 부분 인덱스는 Prisma 스키마 언어로 표현할 수 없어 원시 SQL로만 존재한다.
  // 즉 `prisma migrate dev`가 "스키마에 없는 인덱스"라며 DROP을 제안하는 순간
  // 조용히 사라질 수 있고, 사라져도 기능 테스트는 전부 통과한다 — 느려질 뿐이거나
  // (outbox), 불변식이 코드에만 남을 뿐이다(saved_addresses).
  // 이 스위트가 그 소실을 소리 나게 만든다.

  it('outbox_unpublished_idx가 존재하고 published_at IS NULL 부분 인덱스다', async () => {
    const def = await indexDefinition('outbox_unpublished_idx');
    expect(def).not.toBeNull();
    expect(def).toContain('occurred_at');
    expect(def?.toLowerCase()).toContain('where (published_at is null)');
  });

  it('saved_addresses_default_idx가 존재하고 부분 UNIQUE 인덱스다', async () => {
    const def = await indexDefinition('saved_addresses_default_idx');
    expect(def).not.toBeNull();
    expect(def).toContain('UNIQUE');
    expect(def).toContain('customer_id');
    expect(def?.toLowerCase()).toContain('where is_default');
  });
});

describe('outbox 릴레이 쿼리가 부분 인덱스를 실제로 쓰는지', () => {
  it('미발행 행이 많을 때 순차 스캔이 아니라 인덱스를 탄다', async () => {
    // 인덱스가 "존재한다"와 "쓰인다"는 다른 명제다. 계획 1에서 확인한 EXPLAIN은
    // 사람이 한 번 돌린 것이라 이후 어떤 변경도 다시 확인하지 않는다.
    const db = await testDb();

    await db.$executeRawUnsafe(`
      INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, occurred_at, attempts)
      SELECT gen_random_uuid(), 'Probe', gen_random_uuid(), 'probe.Event', '{}'::jsonb,
             now() - (n || ' seconds')::interval, 0
        FROM generate_series(1, 5000) AS n
    `);
    await db.$executeRawUnsafe('ANALYZE outbox');

    // OutboxRelay.relayOnce()(apps/api/src/shared/infrastructure/outbox/outbox-relay.ts)가
    // 실제로 던지는 조건과 정렬·LIMIT을 그대로 따라간다. next_attempt_at 분기(백오프)를
    // 빠뜨리면 이 테스트는 릴레이가 실행하지도 않는 쿼리를 검사하는 셈이 된다.
    // attempts < 10 은 OutboxRelay.MAX_ATTEMPTS(=10)와 수동으로 맞춰둔 값이다 —
    // 그 상수가 바뀌면 이 리터럴도 같이 바꿔야 한다.
    const now = new Date().toISOString();
    const plan = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`
      EXPLAIN SELECT id FROM outbox
        WHERE published_at IS NULL
          AND attempts < 10
          AND (next_attempt_at IS NULL OR next_attempt_at <= '${now}'::timestamptz)
        ORDER BY occurred_at ASC
        LIMIT 100
    `);
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(planText).toContain('outbox_unpublished_idx');
  });
});

describe('기본 배송지 부분 유니크 인덱스가 DB 수준에서 강제되는지', () => {
  // 도메인(AddressBook)도 "기본은 0 또는 1개"를 지키지만, 도메인만으로는 두 요청이
  // 동시에 서로 다른 주소를 기본으로 지정하는 경합을 막을 수 없다. 마지막 방어선은 DB다.
  beforeEach(async () => {
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d00000001', 'idx@example.com', 'h', now(), now())
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO customers (id, account_id, created_at)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d00000002', '018f2b1c-4a5d-7e6f-8a9b-0c1d00000001', now())
    `);
  });

  async function insertAddress(id: string, isDefault: boolean): Promise<void> {
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO saved_addresses (id, customer_id, label, recipient, phone, zip, line1, is_default)
      VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0c1d00000002', '집', '홍길동', '010', '06236', '서울', ${isDefault})
    `);
  }

  it('한 고객에게 기본 배송지 두 개를 넣으면 거부된다', async () => {
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000011', true);
    await expect(insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000012', true)).rejects.toThrow();
  });

  it('기본이 아닌 주소는 몇 개든 넣을 수 있다', async () => {
    // 부분 인덱스가 아니라 통짜 UNIQUE(customer_id)였다면 여기서 깨진다.
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000021', false);
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000022', false);
    await expect(
      insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000023', false),
    ).resolves.toBeUndefined();
  });

  it('기본 배송지 하나 + 일반 주소 여럿은 허용된다', async () => {
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000031', true);
    await expect(
      insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000032', false),
    ).resolves.toBeUndefined();
  });
});
