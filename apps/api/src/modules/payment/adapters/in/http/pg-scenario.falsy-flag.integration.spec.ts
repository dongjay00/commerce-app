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
  // 'false'는 이 변수를 **끄려고** 할 때 사람이 가장 자연스럽게 쓰는 값이다. 그런데
  // 환경변수는 언제나 문자열이라 `'false'`는 truthy다 — payment.module.ts의 비교가
  // `=== 'true'`가 아니라 단순 truthy 검사로 느슨해지면, 끄려는 시도가 결제 거절
  // 엔드포인트를 **켠다**. 다른 두 spec은 플래그가 없거나 정확히 'true'인 경우만
  // 보므로 그 회귀를 통과시킨다. 이 파일이 `=== 'true'`의 엄격함 자체를 고정한다.
  //
  // 플래그는 payment.module.ts가 import되는 순간 읽히고 정적 import는 호이스팅되므로
  // AppModule은 동적으로 가져온다 — 다른 두 spec과 같은 규율이다.
  process.env['ENABLE_TEST_ENDPOINTS'] = 'false';
  const { AppModule } = await import('../../../../../app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  // process.env는 워커 프로세스 전역이라, 되돌리지 않으면 같은 워커의 이후 spec이 상속한다.
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

describe("POST /testing/pg-scenario — 플래그가 'false'인 경우", () => {
  it("ENABLE_TEST_ENDPOINTS='false'면 404다 — 'true'가 아닌 값은 전부 꺼진 것이다", async () => {
    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'DECLINE' });

    expect(response.status).toBe(404);
  });
});
