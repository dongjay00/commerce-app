import { ErrorCode } from '@commerce/contracts';
import { ApplicationConfig } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ProductController } from './modules/catalog/adapters/in/http/product.controller';
import {
  DuplicateSkuCodeError,
  InvalidPriceError,
  InvalidProductError,
  ProductNotFoundError,
  SkuNotFoundError,
} from './modules/catalog/domain/catalog.errors';
import { AddressController } from './modules/customer/adapters/in/http/address.controller';
import { AddressNotFoundError } from './modules/customer/domain/customer.errors';
import { AuthController } from './modules/identity/adapters/in/http/auth.controller';
import { EmailAlreadyRegisteredError } from './modules/identity/domain/account.errors';
import { SessionRevokedError } from './modules/identity/domain/session.errors';
import { StockController } from './modules/inventory/adapters/in/http/stock.controller';
import { PessimisticStockRepository } from './modules/inventory/adapters/out/persistence/pessimistic-stock.repository';
import { STOCK_REPOSITORY } from './modules/inventory/application/ports/out/stock.repository';
import {
  InsufficientStockError,
  ReservationNotFoundError,
  StockAlreadyExistsError,
  StockContentionError,
  StockNotFoundError,
} from './modules/inventory/domain/stock.errors';
import { JwtTokenService } from './shared/infrastructure/auth/jwt-token.service';
import { AccessTokenGuard } from './shared/infrastructure/http/access-token.guard';
import { DomainErrorRegistry } from './shared/infrastructure/http/domain-error.registry';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { UnauthenticatedError } from './shared/infrastructure/http/unauthenticated.error';
import { ValidationFailedError } from './shared/infrastructure/http/zod-validation.pipe';
import { OutboxRelay } from './shared/infrastructure/outbox/outbox-relay';
import { PrismaService } from './shared/infrastructure/prisma/prisma.service';
import { InvalidIdError } from './shared/kernel/identifiers';
import { ACCESS_TOKEN_VERIFIER } from './shared/kernel/ports/access-token-verifier';
import { CLOCK } from './shared/kernel/ports/clock';
import { DOMAIN_EVENT_PUBLISHER } from './shared/kernel/ports/domain-event.publisher';
import { EVENT_TRANSPORT } from './shared/kernel/ports/event-transport';
import { ID_GENERATOR } from './shared/kernel/ports/id-generator';
import { TRANSACTION_MANAGER } from './shared/kernel/ports/transaction-manager';
import { NegativeQuantityError, NonIntegerQuantityError } from './shared/kernel/quantity';

let moduleRef: TestingModule;

beforeAll(async () => {
  // compile()은 컨테이너만 조립한다 — onModuleInit($connect)은 호출되지 않으므로 DB가 필요 없다.
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
});

describe('AppModule DI 그래프', () => {
  it('HealthController가 PrismaService를 주입받는다', () => {
    // PrismaService import가 `import type`으로 바뀌면 design:paramtypes가 Object가 되어
    // Nest가 의존성을 해석하지 못한다. 이 테스트가 그 회귀를 잡는다.
    const controller = moduleRef.get(HealthController);
    expect(controller).toBeInstanceOf(HealthController);
  });

  it('PrismaService가 해석되고 프록시 뒤에서 생명주기 훅이 살아 있다', () => {
    // Prisma 7의 클라이언트는 Proxy이며 그 프로토타입 체인에 PrismaService.prototype이 없다.
    // 따라서 `instanceof PrismaService`는 false이고, vitest의 toBeInstanceOf는
    // 실패 diff를 만들다 Proxy 트랩을 무한 순회해 RangeError로 터진다.
    // prototype 동일성은 우리가 알고 싶은 성질이 아니다. 알고 싶은 것은
    // "DI가 동작하는 Prisma 클라이언트를 해석했고, Nest가 호출할 훅이 프록시를 통과해
    //  여전히 도달 가능한가"이며, 아래가 정확히 그것을 고정한다.
    const prisma = moduleRef.get(PrismaService);
    expect(prisma).toBeDefined();
    expect(prisma.constructor?.name).toBe('PrismaService');
    expect(typeof prisma.$queryRaw).toBe('function');
    expect(typeof prisma.$transaction).toBe('function');
    expect(typeof prisma.onModuleInit).toBe('function');
    expect(typeof prisma.onModuleDestroy).toBe('function');
  });

  it('횡단 포트 5개가 모두 해석된다', () => {
    for (const token of [
      CLOCK,
      ID_GENERATOR,
      TRANSACTION_MANAGER,
      DOMAIN_EVENT_PUBLISHER,
      EVENT_TRANSPORT,
    ]) {
      expect(moduleRef.get(token)).toBeDefined();
    }
  });

  it('OutboxRelay가 해석된다', () => {
    expect(moduleRef.get(OutboxRelay)).toBeInstanceOf(OutboxRelay);
  });

  it('DomainExceptionFilter가 APP_FILTER로 등록되어 전역 필터로 설치된다', () => {
    // main.ts는 더 이상 필터를 설치하지 않는다 — SharedModule의 APP_FILTER
    // 프로바이더가 유일한 설치 지점이다. Nest는 APP_FILTER로 등록된 프로바이더를
    // 익명 토큰으로 바꿔 DI 그래프에 감춘 뒤 ApplicationConfig.globalFilters에
    // 인스턴스를 밀어 넣으므로(같은 compile() 호출 안에서 일어난다), 그 배열을
    // 직접 들여다보는 것이 설치 여부를 확인하는 유일한 방법이다. 이 프로바이더가
    // 없어지면 배열이 비고, 이 테스트가 그 회귀를 잡는다.
    const filters = moduleRef.get(ApplicationConfig).getGlobalFilters();
    expect(filters).toContainEqual(expect.any(DomainExceptionFilter));
  });

  it('DomainErrorRegistry가 커널 예외 매핑을 갖춘 채 조립된다', () => {
    // SharedModule의 팩토리가 registerKernelDomainErrors(registry)를 호출하는지는
    // AppModule 컴파일이 그 팩토리를 실행한다는 사실(커버리지 100%)만으로는 증명되지
    // 않는다 — 조립된 레지스트리를 직접 resolve해서 매핑 내용을 확인해야 한다.
    const registry = moduleRef.get(DomainErrorRegistry);
    expect(registry.resolve(InvalidIdError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(registry.resolve(NegativeQuantityError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
    expect(registry.resolve(NonIntegerQuantityError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('Inventory 예외 매핑이 등록되어 있다', () => {
    // 등록하지 않은 DomainError는 폴백 {422, DOMAIN_RULE_VIOLATED}로 조용히 떨어진다 —
    // 예외가 나지 않고 틀린 상태 코드가 나간다. 조립된 레지스트리를 직접 resolve하는
    // 이 테스트만이 그 회귀를 잡는다.
    const registry = moduleRef.get(DomainErrorRegistry);
    expect(registry.resolve(InsufficientStockError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.INSUFFICIENT_STOCK,
    });
    expect(registry.resolve(StockNotFoundError.CODE)).toEqual({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expect(registry.resolve(StockContentionError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
    expect(registry.resolve(StockAlreadyExistsError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
    expect(registry.resolve(ReservationNotFoundError.CODE)).toEqual({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('StockController가 유스케이스를 주입받는다', () => {
    expect(moduleRef.get(StockController)).toBeInstanceOf(StockController);
  });

  it('STOCK_REPOSITORY가 비관적 어댑터로 해석된다', () => {
    // 스펙 §6.4가 정한 기본 전략이다. 낙관적으로 바꿔도 모든 테스트가 통과하므로
    // (태스크 14의 프루브 a), 어느 쪽이 배선되어 있는지는 이 단언만이 고정한다.
    expect(moduleRef.get(STOCK_REPOSITORY)).toBeInstanceOf(PessimisticStockRepository);
  });

  it('AccessTokenGuard가 해석되고 검증기를 주입받는다', () => {
    expect(moduleRef.get(AccessTokenGuard)).toBeInstanceOf(AccessTokenGuard);
  });

  it('ACCESS_TOKEN_VERIFIER가 JwtTokenService로 해석된다', () => {
    expect(moduleRef.get(ACCESS_TOKEN_VERIFIER)).toBe(moduleRef.get(JwtTokenService));
  });

  it('검증·인증 예외 매핑이 등록되어 있다', () => {
    const registry = moduleRef.get(DomainErrorRegistry);
    expect(registry.resolve(ValidationFailedError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(registry.resolve(UnauthenticatedError.CODE)).toEqual({
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it('두 컨트롤러가 유스케이스를 주입받는다', () => {
    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
    expect(moduleRef.get(AddressController)).toBeInstanceOf(AddressController);
  });

  it('ProductController가 유스케이스를 주입받는다', () => {
    expect(moduleRef.get(ProductController)).toBeInstanceOf(ProductController);
  });

  it('catalog 도메인 예외 매핑 다섯 개가 등록되어 있다', () => {
    // 등록하지 않은 DomainError는 예외를 내지 않는다 — 폴백 {422, DOMAIN_RULE_VIOLATED}로
    // 조용히 틀린 상태 코드가 나간다.
    const registry = moduleRef.get(DomainErrorRegistry);
    expect(registry.resolve(InvalidPriceError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(registry.resolve(InvalidProductError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(registry.resolve(DuplicateSkuCodeError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
    expect(registry.resolve(SkuNotFoundError.CODE)).toEqual({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expect(registry.resolve(ProductNotFoundError.CODE)).toEqual({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('identity·customer 도메인 예외 매핑이 모두 등록되어 있다', () => {
    const registry = moduleRef.get(DomainErrorRegistry);
    expect(registry.resolve(EmailAlreadyRegisteredError.CODE)).toEqual({
      status: 409,
      code: ErrorCode.EMAIL_ALREADY_REGISTERED,
    });
    expect(registry.resolve(AddressNotFoundError.CODE)).toEqual({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expect(registry.resolve(SessionRevokedError.CODE)).toEqual({
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
  });
});

describe('AppModule 부팅 — JWT_SECRET 검증', () => {
  it('JWT_SECRET이 32자 미만이면 컴파일(부팅)이 실패한다', async () => {
    // SharedModule의 JwtTokenService 팩토리가 readJwtConfig(process.env)를 실제로
    // 호출하는지는 이 테스트만이 증명한다 — jwt.config.spec.ts는 함수 자체를
    // 직접 호출해서 검증했을 뿐, 어떤 모듈도 부팅 시점에 그 함수를 부르지 않았다면
    // 짧은 JWT_SECRET은 첫 로그인 요청에서야 500으로 드러났을 것이다.
    //
    // process.env는 워커 프로세스 전역이라, 여기서 덮어쓴 값을 되돌리지 않으면
    // 같은 워커에서 나중에 도는 다른 스펙이 이 짧은 값을 물려받는다 — 이전 태스크가
    // health.controller.integration.spec.ts에서 정확히 이 문제를 겪고 고쳤다.
    const original = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = 'short';
    try {
      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(
        /32/,
      );
    } finally {
      if (original === undefined) {
        delete process.env['JWT_SECRET'];
      } else {
        process.env['JWT_SECRET'] = original;
      }
    }
  });
});

describe('AppModule 부팅 — REFRESH_TOKEN_TTL_DAYS 검증', () => {
  it('REFRESH_TOKEN_TTL_DAYS가 0 이하면 컴파일(부팅)이 실패한다', async () => {
    // IdentityModule의 REFRESH_TTL 팩토리가 readRefreshTtl(process.env)를 실제로
    // 호출하는지는 이 테스트만이 증명한다 — refresh-ttl.config.spec.ts는 함수 자체를
    // 직접 호출해서 검증했을 뿐, 어떤 모듈도 부팅 시점에 그 함수를 부르지 않는 채로
    // 상수를 반환하도록 바뀌어도 이 회귀는 잡히지 않았을 것이다.
    const original = process.env['REFRESH_TOKEN_TTL_DAYS'];
    process.env['REFRESH_TOKEN_TTL_DAYS'] = '0';
    try {
      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(
        /REFRESH_TOKEN_TTL_DAYS/,
      );
    } finally {
      if (original === undefined) {
        delete process.env['REFRESH_TOKEN_TTL_DAYS'];
      } else {
        process.env['REFRESH_TOKEN_TTL_DAYS'] = original;
      }
    }
  });
});
