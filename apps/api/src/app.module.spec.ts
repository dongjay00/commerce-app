import { ErrorCode } from '@commerce/contracts';
import { ApplicationConfig } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { DomainErrorRegistry } from './shared/infrastructure/http/domain-error.registry';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { OutboxRelay } from './shared/infrastructure/outbox/outbox-relay';
import { PrismaService } from './shared/infrastructure/prisma/prisma.service';
import { InvalidIdError } from './shared/kernel/identifiers';
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
});
