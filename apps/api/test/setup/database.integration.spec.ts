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

  it('풀이 20이라 18개의 동시 요청이 18개의 서로 다른 백엔드를 쓴다', async () => {
    const db = await testDb();
    // Promise.all(N개) 성공 개수만 세면 풀 크기가 1이어도 그냥 순차 대기 후 전부
    // 성공하므로 풀 크기를 구분하지 못한다 — 애초에 이 테스트가 고치려던 결함이다.
    //
    // 벽시계 시간을 재는 버전으로 한 번 고쳤었지만, 실측 결과 그 형태는
    // "풀 크기가 20"이 아니라 "풀 크기가 5 이상"만 구분했다:
    //   max=20 481ms / max=10 685ms / max=5 1242ms / max=4 1537ms(실패) / max=1 6040ms(실패)
    // pg.Pool의 기본값이 max=10이라, 이 파일의 max: 20을 실수로 지운 회귀가
    // 기본값 10으로 떨어져도 685ms < 1500ms라 테스트가 계속 통과했다. 481ms와
    // 685ms를 가르려면 600ms 근방의 임계값이 필요한데, CI나 부하 상태의 머신에서
    // 버틸 수 없을 만큼 빠듯하다 — 시간 기반 형태는 "풀 크기가 정확히 크다"를
    // 검증할 수 없는 구조다.
    //
    // pg_stat_activity로 동시 접속 수를 직접 세는 방법도 시도했으나, 이 프로세스가
    // 이미 Prisma로 여러 커넥션을 열어 둔 상태에서 "같은 프로세스 안의 다른 커넥션"으로
    // pg_stat_activity를 조회하면 실제로는 18개가 열려 있어도(도커 컨테이너 안에서 직접
    // psql로 확인하면 정상적으로 18개가 보인다) 이 프로세스의 관측 커넥션에는 1개만
    // 보이는 재현 가능한 환경 문제(WSL2 + Docker Desktop의 루프백 포트 포워딩으로
    // 추정)를 만났다. 별도 프로세스에서 관측하면 문제없이 정상 카운트가 나오므로
    // Postgres나 풀 자체의 결함은 아니지만, 테스트는 항상 같은 프로세스 안에서
    // 커넥션을 만들고 관측해야 하므로 그 접근은 이 환경에서 쓸 수 없다.
    //
    // 대신 제3의 관측 커넥션 없이, 18개의 동시 쿼리 각자가 자신이 실행된
    // pg_backend_pid()를 스스로 보고하게 한다. 풀에 여유가 있으면(max=20이면 18개
    // 전부 새 커넥션을 받으므로) 18개의 서로 다른 pid가 나오고, 풀이 모자라면
    // (예: max=10이면 10개만 동시에 뜨고 나머지는 먼저 끝난 커넥션을 재사용하므로)
    // 서로 다른 pid 수가 풀 크기만큼만 나온다 — 실측: max=20→18/18, max=10→10/18,
    // max=5→5/18. 관측 대상 커넥션 자체가 곧 관측 주체라 위 환경 문제를 피해 간다.
    // pg_sleep은 void를 반환해 Prisma가 역직렬화하지 못하므로 IS NULL로 캐스팅한다.
    const results = await Promise.all(
      Array.from(
        { length: 18 },
        () =>
          db.$queryRaw<[{ pid: number }]>`SELECT pg_sleep(0.3) IS NULL, pg_backend_pid() as pid`,
      ),
    );
    const distinctBackends = new Set(results.map(([{ pid }]) => pid));
    expect(distinctBackends.size).toBeGreaterThanOrEqual(15);
  });
});
