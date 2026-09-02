import { ErrorCode } from '@commerce/contracts';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../kernel/domain-error';
import { DomainErrorRegistry } from './domain-error.registry';
import { DomainExceptionFilter } from './domain-exception.filter';

class SampleOutOfStockError extends DomainError {
  readonly code = 'SAMPLE_OUT_OF_STOCK';
  constructor() {
    super('재고가 부족합니다');
  }
}

class SampleUnmappedError extends DomainError {
  readonly code = 'SAMPLE_UNMAPPED';
  constructor() {
    super('매핑되지 않은 도메인 규칙 위반');
  }
}

@Controller('sample')
class SampleController {
  @Get('out-of-stock')
  outOfStock(): never {
    throw new SampleOutOfStockError();
  }

  @Get('unmapped')
  unmapped(): never {
    throw new SampleUnmappedError();
  }

  @Get('ok')
  ok(): { fine: true } {
    return { fine: true };
  }
}

@Module({ controllers: [SampleController], providers: [DomainErrorRegistry] })
class SampleModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [SampleModule] }).compile();
  app = moduleRef.createNestApplication();

  const registry = app.get(DomainErrorRegistry);
  registry.register('SampleOutOfStockError', {
    status: 409,
    code: ErrorCode.INSUFFICIENT_STOCK,
  });

  app.useGlobalFilters(new DomainExceptionFilter(registry));
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('DomainExceptionFilter', () => {
  it('등록된 도메인 예외를 매핑된 상태 코드로 변환한다', async () => {
    const response = await request(app.getHttpServer()).get('/sample/out-of-stock');
    expect(response.status).toBe(409);
  });

  it('응답 본문에 에러 코드와 메시지를 담는다', async () => {
    const response = await request(app.getHttpServer()).get('/sample/out-of-stock');
    expect(response.body).toEqual({
      code: ErrorCode.INSUFFICIENT_STOCK,
      message: '재고가 부족합니다',
    });
  });

  it('매핑되지 않은 도메인 예외는 422 DOMAIN_RULE_VIOLATED로 떨어진다', async () => {
    const response = await request(app.getHttpServer()).get('/sample/unmapped');
    expect(response.status).toBe(422);
    expect(response.body.code).toBe(ErrorCode.DOMAIN_RULE_VIOLATED);
  });

  it('정상 응답에는 개입하지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/sample/ok');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fine: true });
  });
});
