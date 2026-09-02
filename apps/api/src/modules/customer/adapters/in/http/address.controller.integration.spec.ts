import { ErrorCode } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerDatabaseName } from '../../../../../../test/setup/database';
import { AppModule } from '../../../../../app.module';

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
  // 이월 25: 복원하지 않으면 같은 워커의 이후 spec이 이 값을 상속한다.
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

const HOME = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
};

const OFFICE = {
  label: '회사',
  recipient: '김철수',
  phone: '010-9876-5432',
  zip: '04524',
  line1: '서울시 중구 세종대로 110',
};

async function signUp(email: string): Promise<{ accessToken: string }> {
  const response = await request(app.getHttpServer())
    .post('/auth/sign-up')
    .send({ email, password: 'correct horse battery staple' });
  return { accessToken: response.body.accessToken };
}

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

describe('주소록', () => {
  it('토큰 없이 목록을 요청하면 401 UNAUTHENTICATED다', async () => {
    const response = await request(app.getHttpServer()).get('/addresses');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('잘못된 토큰이면 401이다', async () => {
    const response = await request(app.getHttpServer())
      .get('/addresses')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('추가하면 목록에 나오고 첫 주소는 기본 배송지다', async () => {
    const { accessToken } = await signUp('list1@example.com');

    const added = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send(HOME);
    expect(added.status).toBe(201);
    expect(added.body.isDefault).toBe(true);

    const list = await request(app.getHttpServer()).get('/addresses').set(authed(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.addresses).toHaveLength(1);
    expect(list.body.addresses[0].isDefault).toBe(true);
  });

  it('두 번째 주소는 기본이 아니고, 기본으로 지정하면 목록 맨 앞으로 온다', async () => {
    const { accessToken } = await signUp('list2@example.com');
    await request(app.getHttpServer()).post('/addresses').set(authed(accessToken)).send(HOME);
    const second = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send(OFFICE);
    expect(second.status).toBe(201);
    expect(second.body.isDefault).toBe(false);

    const setDefault = await request(app.getHttpServer())
      .post(`/addresses/${second.body.id}/default`)
      .set(authed(accessToken));
    expect(setDefault.status).toBe(204);

    const list = await request(app.getHttpServer()).get('/addresses').set(authed(accessToken));
    expect(list.body.addresses[0].id).toBe(second.body.id);
    expect(list.body.addresses[0].isDefault).toBe(true);
    expect(list.body.addresses).toHaveLength(2);
  });

  it('수정하면 내용이 바뀌고 isDefault는 유지된다', async () => {
    const { accessToken } = await signUp('update1@example.com');
    const added = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send(HOME);

    const updated = await request(app.getHttpServer())
      .put(`/addresses/${added.body.id}`)
      .set(authed(accessToken))
      .send(OFFICE);
    expect(updated.status).toBe(200);
    expect(updated.body.recipient).toBe(OFFICE.recipient);
    expect(updated.body.isDefault).toBe(true);
  });

  it('삭제하면 204이고 목록에서 사라진다', async () => {
    const { accessToken } = await signUp('remove1@example.com');
    const added = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send(HOME);

    const removed = await request(app.getHttpServer())
      .delete(`/addresses/${added.body.id}`)
      .set(authed(accessToken));
    expect(removed.status).toBe(204);

    const list = await request(app.getHttpServer()).get('/addresses').set(authed(accessToken));
    expect(list.body.addresses).toEqual([]);
  });

  it('다른 사용자의 주소 ID로 수정하면 404다 — 403이 아니다', async () => {
    const owner = await signUp('owner@example.com');
    const intruder = await signUp('intruder@example.com');
    const added = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(owner.accessToken))
      .send(HOME);

    const response = await request(app.getHttpServer())
      .put(`/addresses/${added.body.id}`)
      .set(authed(intruder.accessToken))
      .send(OFFICE);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('경로 파라미터가 uuid가 아니면 400 VALIDATION_FAILED다', async () => {
    const { accessToken } = await signUp('badid@example.com');
    const response = await request(app.getHttpServer())
      .put('/addresses/not-a-uuid')
      .set(authed(accessToken))
      .send(HOME);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('빈 수취인으로 추가하면 400 VALIDATION_FAILED다', async () => {
    const { accessToken } = await signUp('badrecipient@example.com');
    const response = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send({ ...HOME, recipient: '' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('기본 배송지를 A→B로 옮겨도 부분 유니크 인덱스를 어기지 않는다', async () => {
    const { accessToken } = await signUp('move-default@example.com');
    await request(app.getHttpServer()).post('/addresses').set(authed(accessToken)).send(HOME);
    const second = await request(app.getHttpServer())
      .post('/addresses')
      .set(authed(accessToken))
      .send(OFFICE);

    const setDefault = await request(app.getHttpServer())
      .post(`/addresses/${second.body.id}/default`)
      .set(authed(accessToken));
    expect(setDefault.status).toBe(204);

    const list = await request(app.getHttpServer()).get('/addresses').set(authed(accessToken));
    const defaults = list.body.addresses.filter(
      (address: { isDefault: boolean }) => address.isDefault,
    );
    expect(defaults).toHaveLength(1);
  });
});
