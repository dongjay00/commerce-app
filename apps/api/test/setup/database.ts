import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { TEMPLATE_DB } from './global-setup';

let cached: PrismaClient | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}이 필요합니다. apps/api/.env를 확인하세요.`);
  }
  return value;
}

export function workerDatabaseName(): string {
  return `commerce_test_w${process.env.VITEST_WORKER_ID ?? '1'}`;
}

/**
 * 이 워커 전용 DB에 연결된 Prisma 클라이언트를 반환한다.
 * 없으면 템플릿에서 복제해 만든다 (~100ms).
 *
 * 풀 크기 20은 필수다. 풀이 작으면 동시성 테스트의 요청들이 풀에서 직렬화되어
 * 경합이 발생하지 않고 테스트가 거짓으로 통과한다.
 *
 * Prisma 7의 PrismaClient 생성자는 `datasources`/`datasourceUrl`을 더 이상 받지 않는다
 * (허용 키: errorFormat, adapter, accelerateUrl, log, transactionOptions, omit,
 *  comments, queryPlanCacheMaxSize, __internal). 런타임에 연결 문자열을 지정하려면
 * 드라이버 어댑터를 쓴다. 풀 크기도 어댑터(=pg.Pool)의 옵션으로 준다 —
 * `?connection_limit=`은 Prisma 엔진 파라미터라 pg 드라이버가 무시한다.
 */
export async function testDb(): Promise<PrismaClient> {
  if (cached) return cached;

  const databaseName = workerDatabaseName();
  const baseUrl = requireEnv('TEST_DATABASE_BASE_URL');

  const admin = new Client({ connectionString: requireEnv('TEST_DATABASE_ADMIN_URL') });
  await admin.connect();
  const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
    databaseName,
  ]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE "${TEMPLATE_DB}"`);
  }
  await admin.end();

  const adapter = new PrismaPg({
    connectionString: `${baseUrl}/${databaseName}`,
    max: 20,
  });
  cached = new PrismaClient({ adapter });
  await cached.$connect();
  return cached;
}

/** 테스트 파일 사이의 정리. 트랜잭션 롤백 대신 TRUNCATE를 쓴다. */
export async function truncateAll(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function closeTestDb(): Promise<void> {
  await cached?.$disconnect();
  cached = undefined;
}
