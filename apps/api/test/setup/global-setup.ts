import { execSync } from 'node:child_process';
import { Client } from 'pg';

export const TEMPLATE_DB = 'commerce_test_template';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}이 필요합니다. apps/api/.env를 확인하세요.`);
  }
  return value;
}

async function dropDatabase(admin: Client, name: string): Promise<void> {
  // 활성 커넥션이 하나라도 있으면 DROP과 TEMPLATE 복제가 모두 실패한다.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}

/** 테스트 실행 전 1회. 템플릿 DB를 새로 만들고 마이그레이션을 적용한다. */
export default async function globalSetup(): Promise<void> {
  const adminUrl = requireEnv('TEST_DATABASE_ADMIN_URL');
  const baseUrl = requireEnv('TEST_DATABASE_BASE_URL');

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const leftovers = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'commerce_test%'`,
    );
    for (const row of leftovers.rows) {
      await dropDatabase(admin, row.datname);
    }

    await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  } finally {
    // query()가 던지면 여기 없이는 end()에 도달하지 못해 실패할 때마다 커넥션이 하나씩 샌다.
    // globalSetup은 pnpm verify마다 정확히 한 번 돈다.
    await admin.end();
  }

  execSync('pnpm --filter @commerce/api exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: `${baseUrl}/${TEMPLATE_DB}` },
    stdio: 'inherit',
  });
}
