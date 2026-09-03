import { ErrorCode, pgWebhookContract } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerDatabaseName } from '../../../../../../test/setup/database';
import { AppModule } from '../../../../../app.module';
import {
  AUTHORIZE_PAYMENT_USECASE,
  type AuthorizePaymentUseCase,
} from '../../../application/ports/in/authorize-payment.usecase';

let app: INestApplication;
const originalDatabaseUrl = process.env['DATABASE_URL'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  // process.env는 워커 단위라 복원하지 않으면 같은 워커의 이후 spec이 상속한다.
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

const order = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-0d1bcb${suffix.padStart(6, '0')}`;

/** 결제 행을 유스케이스로 만든다 — 원시 SQL이면 매퍼와 리포지토리를 건너뛴다. */
async function authorize(orderId: string): Promise<void> {
  await app
    .get<AuthorizePaymentUseCase>(AUTHORIZE_PAYMENT_USECASE)
    .execute({ orderId, amount: '12000', currency: 'KRW' });
}

const callback = (body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/payments/pg-callback').send(body);

describe('PG 웹훅', () => {
  it('결제가 없는 주문의 콜백은 404다', async () => {
    const response = await callback({
      orderId: order('99'),
      pgTxId: 'late-99',
      result: 'APPROVED',
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('처음 보는 콜백은 200 accepted: true다', async () => {
    const orderId = order('1');
    await authorize(orderId);

    const response = await callback({ orderId, pgTxId: 'late-1', result: 'APPROVED' });

    expect(response.status).toBe(200);
    // 서버를 자기 계약에 묶는다.
    expect(() => pgWebhookContract.callback.responses[200].parse(response.body)).not.toThrow();
    expect(response.body).toEqual({ accepted: true });
  });

  it('같은 pgTxId가 두 번 오면 accepted: false이고 시도가 늘지 않는다', async () => {
    // 스펙 §7.6의 "웹훅, 멱등". 도메인과 DB 유니크로 이중으로 건다.
    const orderId = order('2');
    await authorize(orderId);
    const body = { orderId, pgTxId: 'late-2', result: 'APPROVED' };

    expect((await callback(body)).body).toEqual({ accepted: true });
    const second = await callback(body);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ accepted: false });
  });

  it('result가 열거값 밖이면 400 VALIDATION_FAILED다', async () => {
    const response = await callback({ orderId: order('3'), pgTxId: 'x', result: 'MAYBE' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('토큰 없이 불러도 200이다 — 가드가 없다는 사실을 고정한다', async () => {
    // PG는 우리 액세스 토큰을 갖고 있지 않다. 나중에 서명 검증을 넣으면 이 테스트가
    // 깨지고, 그때 의도적으로 고치는 것이 맞다.
    const orderId = order('4');
    await authorize(orderId);

    const response = await callback({ orderId, pgTxId: 'late-4', result: 'DECLINED' });

    expect(response.status).toBe(200);
  });
});
