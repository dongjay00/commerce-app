import { ErrorCode } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerDatabaseName } from '../../../../../../test/setup/database';
import { FakePgAdapter } from '../../out/pg/fake-pg.adapter';

let app: INestApplication;

const originalDatabaseUrl = process.env['DATABASE_URL'];
const originalFlag = process.env['ENABLE_TEST_ENDPOINTS'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  // 플래그는 `payment.module.ts`가 **import되는 순간** 읽힌다. 정적 import는 파일 맨 위로
  // 호이스팅되므로 이 대입보다 먼저 실행된다 — 그래서 AppModule을 동적으로 가져온다.
  // 이 파일의 정적 import 중 payment.module.ts에 닿는 것은 하나도 없으므로,
  // 아래 `await import`가 그 모듈을 평가하는 첫 지점이고 플래그는 이미 켜져 있다.
  // (`vi.resetModules()`를 쓰지 않는 이유이기도 하다 — 모킹 라이브러리 금지, 스펙 §9.1.)
  process.env['ENABLE_TEST_ENDPOINTS'] = 'true';
  const { AppModule } = await import('../../../../../app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  // process.env는 워커 프로세스 전역이라, 되돌리지 않으면 같은 워커에서 나중에 도는
  // pg-scenario.controller.integration.spec.ts가 켜진 플래그를 물려받아 404 단언이 깨진다.
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

describe('POST /testing/pg-scenario — 플래그가 켜진 경우', () => {
  it('scenario가 바뀐다 — 204이고 DI 컨테이너의 FakePgAdapter에 반영된다', async () => {
    // 이 엔드포인트의 존재 이유다. 200/204만 확인하고 상태를 보지 않으면
    // 본문을 버리는 구현도 통과하고, 브라우저 E2E는 승인 경로를 돌면서
    // "거절 보상 경로를 테스트했다"고 착각한다.
    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'DECLINE' });

    expect(response.status).toBe(204);
    expect(app.get(FakePgAdapter).scenario).toBe('DECLINE');
  });

  it('APPROVE로 되돌릴 수 있다', async () => {
    await request(app.getHttpServer()).post('/testing/pg-scenario').send({ scenario: 'TIMEOUT' });
    expect(app.get(FakePgAdapter).scenario).toBe('TIMEOUT');

    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'APPROVE' });

    expect(response.status).toBe(204);
    expect(app.get(FakePgAdapter).scenario).toBe('APPROVE');
  });

  it('열거값 밖이면 400 VALIDATION_FAILED이고 상태는 그대로다', async () => {
    app.get(FakePgAdapter).scenario = 'APPROVE';

    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'DECLINE_NEXT' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(app.get(FakePgAdapter).scenario).toBe('APPROVE');
  });

  it('알 수 없는 키가 있으면 400이다 — 오타 난 시나리오가 조용히 무시되지 않는다', async () => {
    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .send({ scenario: 'DECLINE', persist: true });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('인증 없이 부를 수 있다 — 가드가 없다', async () => {
    // E2E는 토큰 없이 이 엔드포인트를 부른다. 가드가 붙으면 401이 되어
    // 브라우저 테스트가 시나리오를 바꿀 방법을 잃는다.
    const response = await request(app.getHttpServer())
      .post('/testing/pg-scenario')
      .set('Authorization', '')
      .send({ scenario: 'APPROVE' });

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(204);
  });
});
