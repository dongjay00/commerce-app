import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerDatabaseName } from '../../../../../../test/setup/database';

let app: INestApplication;

const originalDatabaseUrl = process.env['DATABASE_URL'];
const originalFlag = process.env['ENABLE_TEST_ENDPOINTS'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  // 플래그를 **명시적으로 지운다.** process.env는 워커 프로세스 전역이고 vitest는
  // 워커를 파일 간에 재사용하므로, pg-scenario.enabled.integration.spec.ts가 먼저 돌면
  // 켜진 값이 남아 있을 수 있다. 지우지 않으면 이 스펙이 그 잔여물 때문에 깨지고,
  // 진짜 회귀와 구분되지 않는다. `payment.module.ts`가 import 시점에 읽으므로
  // AppModule은 동적으로 가져온다.
  delete process.env['ENABLE_TEST_ENDPOINTS'];
  const { AppModule } = await import('../../../../../app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  if (originalFlag === undefined) {
    delete process.env['ENABLE_TEST_ENDPOINTS'];
  } else {
    process.env['ENABLE_TEST_ENDPOINTS'] = originalFlag;
  }
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

describe('POST /testing/pg-scenario — 플래그가 없는 경우', () => {
  it('플래그가 없으면 404다 — 컨트롤러가 등록되지 않는다', async () => {
    // 이것이 이 엔드포인트의 유일한 방어선이다. 기본값이 "없음"이어야 한다.
    // 라우트가 살아 있으면 누구나 인증 없이 결제 시나리오를 바꿀 수 있다.
    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'DECLINE' });

    expect(response.status).toBe(404);
  });
});
