# 기반 골격 (Foundation Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 커머스 주문 파이프라인의 모든 후속 작업이 올라탈 모노레포 골격을 만든다 — 공유 커널(Money·Quantity·식별자·AggregateRoot), 횡단 포트 4종과 어댑터, Outbox 이벤트 발행, 실제 Postgres 기반 테스트 격리, 경계 강제 규칙까지 전부 테스트로 검증된 상태.

**Architecture:** 헥사고날 아키텍처의 "안쪽"부터 만든다. 프레임워크를 모르는 순수 TypeScript 커널을 TDD로 완성한 뒤, 그 위에 포트 인터페이스를 정의하고, 마지막에 Prisma/Nest 어댑터를 붙인다. 어댑터가 붙기 전까지 커널과 포트는 `@nestjs/*`와 `@prisma/client`를 import하지 않으며, 이 규칙은 계획 마지막 태스크에서 dependency-cruiser로 강제된다.

**Tech Stack:** pnpm workspace, TypeScript 5, Nest.js, Next.js (App Router), PostgreSQL 17 (Docker), Prisma, Biome, dependency-cruiser, Vitest, ts-rest + Zod, MSW

**Spec:** `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`

---

## Global Constraints

이 값들은 스펙에서 그대로 가져온 것이며, 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **PostgreSQL 17** (`postgres:17-alpine`). 로컬 DB는 Docker Compose로만 띄운다. PGlite 금지 — 동시 트랜잭션이 격리되지 않아 경합 테스트가 거짓 통과한다.
- **금액은 `bigint` 최소 단위 정수**(원)로만 다룬다. 부동소수점 금지. DB에는 `*_amount`(BigInt) + `*_currency`(String) 두 컬럼으로 저장한다.
- **도메인 계층(`apps/api/src/modules/*/domain/**`, `apps/api/src/shared/kernel/**`)은 `@nestjs/*`, `@prisma/client`, `packages/contracts`를 import하지 않는다.**
- **애플리케이션 계층은 `adapters/**`와 `@prisma/client`를 import하지 않는다.** 포트 인터페이스만 안다.
- **목(mock) 라이브러리를 쓰지 않는다.** `vi.mock`, `vi.spyOn`을 이용한 포트 대체 금지. 아웃바운드 포트마다 손으로 쓴 fake를 만든다.
- **도메인 예외에 HTTP 상태 코드를 넣지 않는다.** 매핑은 인바운드 어댑터의 예외 필터에서만 한다.
- **테스트 DB는 `TEMPLATE` 복제로 워커별 격리**하고, 파일 간에는 `TRUNCATE ... RESTART IDENTITY CASCADE`로 정리한다. 테스트를 트랜잭션으로 감싸 롤백하는 방식은 금지 — 동시성 경합을 재현할 수 없다.
- **테스트용 `DATABASE_URL`에는 반드시 `?connection_limit=20`을 붙인다.** 풀이 작으면 경합이 발생하지 않아 동시성 테스트가 거짓 통과한다.
- **Biome `noRestrictedImports`의 `patterns` 옵션은 Biome v2.2.0 이상**이 필요하다.
- **Nest가 주입하는 클래스는 값(value) import여야 한다.** Biome의 `useImportType` 자동 수정이 생성자 파라미터 전용 import를 `import type`으로 바꾸면 `design:paramtypes` 메타데이터가 `Object`가 되어 **DI가 조용히 깨진다.** 타입 체크도 린트도 테스트도 통과하고 서버를 실제로 띄웠을 때만 드러난다. 해당 import 위에 `// biome-ignore lint/style/useImportType: ...` 를 이유와 함께 남긴다.
- 커버리지 임계값: `modules/*/domain/**` lines 95 / branches 90, `modules/*/application/**` lines 90 / branches 85. 어댑터에는 임계값을 걸지 않는다.

---

## 스펙 대비 이 계획의 보완 사항

스펙 6.3은 Outbox 릴레이가 "발행한다"고만 적고 발행 대상을 명시하지 않았다. 이 계획에서는
**`EventTransport` 포트와 `NestEventEmitterTransport` 어댑터**를 추가해 릴레이가 포트로 발행하게 한다.
나중에 Kafka 어댑터로 교체할 자리이며, 스펙 6.3의 "adapters/out/messaging/kafka-event.publisher.ts ← 나중에"
의도와 일치한다.

스펙 11.2의 dependency-cruiser 규칙은 `modules/*/domain`만 대상으로 한다. 이 계획에는 아직
모듈이 없고 공유 커널만 있으므로, 같은 취지의 규칙 두 개를 추가한다.

- `kernel-is-pure` — `shared/kernel/**`이 `@nestjs/*`, `@prisma/client`, `shared/infrastructure`,
  `shared/testing`, `packages/contracts`를 import하지 못하게 한다.
- `no-test-doubles-in-production` — `shared/testing/**`의 fake가 운영 코드로 새는 것을 막는다.
  스펙 9.1이 fake를 대량으로 만들기로 한 이상 반드시 필요한 방어다.

---

## File Structure

이 계획이 만드는 파일과 각각의 책임.

### 루트

| 파일 | 책임 |
|---|---|
| `pnpm-workspace.yaml` | 워크스페이스 멤버 선언 |
| `package.json` | 루트 스크립트 (`verify`, `test`, `lint`, `arch:check`) |
| `tsconfig.base.json` | 공통 컴파일러 옵션 (strict) |
| `biome.jsonc` | 포맷 + 린트 + 계층별 import 금지 |
| `.dependency-cruiser.js` | 아키텍처 그래프 규칙 |
| `vitest.config.ts` | 3개 프로젝트 (api-unit / api-integration / web) |
| `docker-compose.yml` | Postgres 17 |
| `.env.example` | DB URL 템플릿 |

### apps/api — 공유 커널 (프레임워크를 모름)

| 파일 | 책임 |
|---|---|
| `src/shared/kernel/money.ts` | 금액 VO. bigint 최소단위 + 통화. 연산 시 통화 일치 검증 |
| `src/shared/kernel/quantity.ts` | 수량 VO. 정수 ≥ 0 (`of`) / ≥ 1 (`positive`) |
| `src/shared/kernel/duration.ts` | 기간 VO. ms 정수. TTL 계산용 |
| `src/shared/kernel/identifiers.ts` | branded ID 타입 (OrderId, SkuId, ...) — 서로 대입 불가 |
| `src/shared/kernel/domain-error.ts` | 도메인 예외 기반 클래스. HTTP 상태 코드 없음 |
| `src/shared/kernel/domain-event.ts` | 도메인 이벤트 인터페이스 |
| `src/shared/kernel/aggregate-root.ts` | 이벤트 누적 + `pullEvents()` |

### apps/api — 횡단 포트 (application이 소유)

| 파일 | 책임 |
|---|---|
| `src/shared/kernel/ports/clock.ts` | `now(): Date` |
| `src/shared/kernel/ports/id-generator.ts` | `nextId(): string` |
| `src/shared/kernel/ports/transaction-manager.ts` | `run(fn)` + 불투명 `TransactionContext` |
| `src/shared/kernel/ports/domain-event.publisher.ts` | `publish(events, tx?)` |
| `src/shared/kernel/ports/event-transport.ts` | 릴레이가 이벤트를 내보내는 출구 |

### apps/api — 인프라 어댑터

| 파일 | 책임 |
|---|---|
| `src/shared/infrastructure/clock/system-clock.ts` | `Clock` 실물 |
| `src/shared/infrastructure/id/uuid-v7.generator.ts` | `IdGenerator` 실물 (UUID v7 = 시간순 정렬) |
| `src/shared/infrastructure/prisma/prisma.service.ts` | PrismaClient 수명 관리 |
| `src/shared/infrastructure/prisma/prisma-transaction-manager.ts` | `TransactionManager` 실물 |
| `src/shared/infrastructure/outbox/outbox-event.publisher.ts` | 이벤트를 outbox 테이블에 INSERT (같은 트랜잭션) |
| `src/shared/infrastructure/outbox/outbox-relay.ts` | 미발행 outbox row 폴링 → 전송 → 마킹 |
| `src/shared/infrastructure/messaging/nest-event-emitter.transport.ts` | `EventTransport` 실물 |
| `src/shared/infrastructure/http/domain-exception.filter.ts` | `DomainError` → HTTP 상태 + `ErrorCode` |
| `src/shared/shared.module.ts` | 위 어댑터들의 Nest DI 등록 |

### apps/api — 테스트 더블과 인프라

| 파일 | 책임 |
|---|---|
| `src/shared/testing/mutable-clock.ts` | `advanceBy()` 가능한 `Clock` fake |
| `src/shared/testing/sequential-id-generator.ts` | 결정적 ID fake |
| `src/shared/testing/passthrough-transaction-manager.ts` | 트랜잭션 없이 그냥 실행하는 fake |
| `src/shared/testing/recording-event-publisher.ts` | 발행된 이벤트를 배열로 보관하는 fake |
| `src/shared/testing/recording-event-transport.ts` | 전송된 이벤트를 배열로 보관하는 fake |
| `test/setup/global-setup.ts` | 템플릿 DB 생성 + 마이그레이션 (1회) |
| `test/setup/database.ts` | 워커별 DB 복제, `TRUNCATE`, 커넥션 관리 |

### packages/contracts

| 파일 | 책임 |
|---|---|
| `src/shared/error-codes.ts` | 프론트가 분기하는 에러 코드 enum |
| `src/shared/money.dto.ts` | `{ amount: string; currency }` — VO가 아닌 DTO |
| `src/health/health.contract.ts` | 배선 검증용 최소 계약 |

### apps/web

| 파일 | 책임 |
|---|---|
| `app/layout.tsx`, `app/page.tsx` | Next 라우팅 껍데기 |
| `src/server/api-client.ts` | 서버 전용. Nest 호출 (토큰 주입은 계획 2에서) |
| `src/shared/api/contract-client.ts` | ts-rest 클라이언트 팩토리 |
| `src/shared/api/msw/handlers/health.ts` | contracts 스키마로 검증하는 MSW 핸들러 |

---

### Task 1: 모노레포 골격 + Money VO

모노레포 스캐폴딩은 그 자체로 테스트할 것이 없으므로, 첫 도메인 값 객체인 `Money`를
TDD로 만드는 태스크에 함께 접어 넣는다. 이 태스크가 끝나면 `pnpm test`가 실제로 돈다.

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `biome.jsonc`, `vitest.config.ts`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/api/src/shared/kernel/money.ts`
- Test: `apps/api/src/shared/kernel/money.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `type Currency = 'KRW' | 'USD'`
  - `class Money` — `static of(amount: bigint | number, currency?: Currency): Money`,
    `static zero(currency?: Currency): Money`, `readonly amount: bigint`, `readonly currency: Currency`,
    `plus(other: Money): Money`, `minus(other: Money): Money`, `multiply(factor: number): Money`,
    `equals(other: Money): boolean`, `isGreaterThan(other: Money): boolean`, `isNegative(): boolean`,
    `toDto(): { amount: string; currency: Currency }`, `static fromDto(dto): Money`
  - `class CurrencyMismatchError extends Error`, `class InvalidMoneyError extends Error`

- [ ] **Step 1: 워크스페이스 스캐폴딩 파일 생성**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

# pnpm 10부터 의존성의 빌드 스크립트는 명시적으로 승인해야 실행된다.
# 이 항목이 없으면 esbuild의 postinstall이 차단되어
# `pnpm install`이 ERR_PNPM_IGNORED_BUILDS로 실패하고 vitest가 동작하지 않는다.
# 나중에 빌드 스크립트가 필요한 의존성(prisma 등)을 추가하면 여기에도 등록해야 한다.
allowBuilds:
  esbuild: true
```

`package.json`:

```json
{
  "name": "commerce-app",
  "private": true,
  "packageManager": "pnpm@11.8.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.2.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^3.2.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`biome.jsonc`:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**/*.ts", "**/*.tsx", "**/*.json", "**/*.jsonc"] },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api-unit',
          include: ['apps/api/src/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
```

`apps/api/package.json`:

```json
{
  "name": "@commerce/api",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.0"
  }
}
```

`vitest`와 `@types/node`를 루트뿐 아니라 이 패키지에도 선언하는 것은 필수다.
pnpm 기본 격리 링크에서는 루트 devDependency가 `apps/api/node_modules`에 나타나지 않아,
`tsc`가 spec 파일의 `import { describe } from 'vitest'`를 해결하지 못한다.

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`exclude`를 두지 않는 것은 의도적이다. spec 파일이 타입 체크에서 빠지면 Task 2 Step 9의
branded 타입 검증이 무의미해지고, 테스트 코드의 타입 오류가 CI를 통과한다.
(`build` 스크립트가 dist에 spec을 방출하는 것은 계획 2에서 `tsconfig.build.json`으로 분리한다.)

- [ ] **Step 2: 의존성 설치**

Run: `pnpm install`
Expected: `node_modules/` 생성, 에러 없음

- [ ] **Step 3: 실패하는 Money 테스트 작성**

`apps/api/src/shared/kernel/money.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidMoneyError, Money } from './money';

describe('Money', () => {
  describe('생성', () => {
    it('정수로 생성하면 bigint 최소 단위로 보관한다', () => {
      expect(Money.of(1000).amount).toBe(1000n);
      expect(Money.of(1000).currency).toBe('KRW');
    });

    it('bigint로도 생성할 수 있다', () => {
      expect(Money.of(9_007_199_254_740_993n).amount).toBe(9_007_199_254_740_993n);
    });

    it('소수를 넣으면 거부한다', () => {
      expect(() => Money.of(10.5)).toThrow(InvalidMoneyError);
    });

    it('zero는 0원이다', () => {
      expect(Money.zero().amount).toBe(0n);
    });

    it('음수 금액도 생성할 수 있다 (환불 차액 계산에 필요)', () => {
      expect(Money.of(-500).isNegative()).toBe(true);
    });
  });

  describe('연산', () => {
    it('같은 통화끼리 더한다', () => {
      expect(Money.of(1000).plus(Money.of(500)).amount).toBe(1500n);
    });

    it('같은 통화끼리 뺀다', () => {
      expect(Money.of(1000).minus(Money.of(300)).amount).toBe(700n);
    });

    it('정수 배수를 곱한다', () => {
      expect(Money.of(1200).multiply(3).amount).toBe(3600n);
    });

    it('소수 배수는 거부한다 — 반올림 정책을 암묵적으로 정하지 않는다', () => {
      expect(() => Money.of(1000).multiply(1.5)).toThrow(InvalidMoneyError);
    });

    it('연산해도 원본이 바뀌지 않는다', () => {
      const original = Money.of(1000);
      original.plus(Money.of(500));
      expect(original.amount).toBe(1000n);
    });
  });

  describe('통화 검증', () => {
    it('다른 통화를 더하면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').plus(Money.of(10, 'USD'))).toThrow(CurrencyMismatchError);
    });

    it('다른 통화를 빼면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').minus(Money.of(10, 'USD'))).toThrow(CurrencyMismatchError);
    });

    it('다른 통화끼리 비교하면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').isGreaterThan(Money.of(10, 'USD'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  describe('비교', () => {
    it('금액과 통화가 모두 같아야 같다', () => {
      expect(Money.of(1000).equals(Money.of(1000))).toBe(true);
      expect(Money.of(1000).equals(Money.of(1001))).toBe(false);
      expect(Money.of(1000, 'KRW').equals(Money.of(1000, 'USD'))).toBe(false);
    });

    it('크기를 비교한다', () => {
      expect(Money.of(1000).isGreaterThan(Money.of(999))).toBe(true);
      expect(Money.of(1000).isGreaterThan(Money.of(1000))).toBe(false);
    });
  });

  describe('DTO 변환', () => {
    it('amount를 문자열로 직렬화한다 — JSON에는 bigint가 없다', () => {
      expect(Money.of(1000).toDto()).toEqual({ amount: '1000', currency: 'KRW' });
    });

    it('DTO에서 복원하면 원본과 같다', () => {
      const original = Money.of(123_456, 'KRW');
      expect(Money.fromDto(original.toDto()).equals(original)).toBe(true);
    });
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/money.spec.ts`
Expected: FAIL — `Failed to resolve import "./money"`

- [ ] **Step 5: Money 구현**

`apps/api/src/shared/kernel/money.ts`:

```ts
export type Currency = 'KRW' | 'USD';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`통화가 다릅니다: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export interface MoneyDto {
  amount: string;
  currency: Currency;
}

/**
 * 금액 값 객체.
 * 최소 단위(원) 정수만 bigint로 보관한다. 부동소수점은 절대 쓰지 않는다.
 */
export class Money {
  private constructor(
    readonly amount: bigint,
    readonly currency: Currency,
  ) {}

  static of(amount: bigint | number, currency: Currency = 'KRW'): Money {
    if (typeof amount === 'number' && !Number.isInteger(amount)) {
      throw new InvalidMoneyError(`금액은 최소 단위 정수여야 합니다: ${amount}`);
    }
    return new Money(BigInt(amount), currency);
  }

  static zero(currency: Currency = 'KRW'): Money {
    return new Money(0n, currency);
  }

  static fromDto(dto: MoneyDto): Money {
    return new Money(BigInt(dto.amount), dto.currency);
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  /** 반올림이 생기지 않도록 정수 배수만 허용한다. */
  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new InvalidMoneyError(`배수는 정수여야 합니다: ${factor}`);
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  toDto(): MoneyDto {
    return { amount: this.amount.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
```

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/money.spec.ts`
Expected: PASS — 17 tests passed

- [ ] **Step 7: 린트와 타입 체크**

Run: `pnpm lint && pnpm typecheck`
Expected: 둘 다 통과. 실패하면 `pnpm format` 후 재실행

- [ ] **Step 8: 커밋**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json biome.jsonc vitest.config.ts apps/api
git commit -m "feat: 모노레포 골격과 Money 값 객체"
```

---

### Task 2: Quantity VO + branded 식별자

**Files:**
- Create: `apps/api/src/shared/kernel/quantity.ts`
- Create: `apps/api/src/shared/kernel/identifiers.ts`
- Test: `apps/api/src/shared/kernel/quantity.spec.ts`
- Test: `apps/api/src/shared/kernel/identifiers.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `class Quantity` — `static of(value: number): Quantity` (정수 ≥ 0),
    `static positive(value: number): Quantity` (정수 ≥ 1),
    `static ZERO: Quantity`, `readonly value: number`,
    `plus(other: Quantity): Quantity`, `minus(other: Quantity): Quantity` (음수면 예외),
    `isGreaterThan(other: Quantity): boolean`, `isZero(): boolean`, `equals(other: Quantity): boolean`
  - `class InvalidQuantityError extends Error`, `class NegativeQuantityError extends Error`
  - `type OrderId, CartId, SkuId, ProductId, CustomerId, AccountId, ReservationId, PaymentId, AddressId`
    — 각각 `Brand<string, '...'>`
  - 동명의 const 네임스페이스: `OrderId.of(v: string): OrderId` 등. 형식이 UUID가 아니면 `InvalidIdError`
  - `class InvalidIdError extends Error`

`Quantity`에 팩토리가 둘인 이유: 재고 잔량은 0이 될 수 있고(`of`), 주문·장바구니 라인의
수량은 1 이상이어야 한다(`positive`). 스펙 8.4의 "의미 검증은 VO가 지킨다"를 두 규칙 모두에
적용하기 위한 것이다.

- [ ] **Step 1: 실패하는 Quantity 테스트 작성**

`apps/api/src/shared/kernel/quantity.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InvalidQuantityError, NegativeQuantityError, Quantity } from './quantity';

describe('Quantity', () => {
  describe('of — 재고 잔량용 (0 이상)', () => {
    it('0을 허용한다', () => {
      expect(Quantity.of(0).value).toBe(0);
    });

    it('양의 정수를 허용한다', () => {
      expect(Quantity.of(7).value).toBe(7);
    });

    it('음수를 거부한다', () => {
      expect(() => Quantity.of(-1)).toThrow(InvalidQuantityError);
    });

    it('소수를 거부한다', () => {
      expect(() => Quantity.of(1.5)).toThrow(InvalidQuantityError);
    });
  });

  describe('positive — 주문 라인용 (1 이상)', () => {
    it('1 이상을 허용한다', () => {
      expect(Quantity.positive(1).value).toBe(1);
    });

    it('0을 거부한다 — 장바구니에 수량 0인 줄은 존재할 수 없다', () => {
      expect(() => Quantity.positive(0)).toThrow(InvalidQuantityError);
    });

    it('음수를 거부한다', () => {
      expect(() => Quantity.positive(-3)).toThrow(InvalidQuantityError);
    });
  });

  describe('연산', () => {
    it('더한다', () => {
      expect(Quantity.of(3).plus(Quantity.of(4)).value).toBe(7);
    });

    it('뺀다', () => {
      expect(Quantity.of(10).minus(Quantity.of(4)).value).toBe(6);
    });

    it('결과가 음수가 되는 뺄셈은 거부한다 — 재고가 음수가 될 수 없다', () => {
      expect(() => Quantity.of(3).minus(Quantity.of(5))).toThrow(NegativeQuantityError);
    });

    it('연산해도 원본이 바뀌지 않는다', () => {
      const original = Quantity.of(5);
      original.plus(Quantity.of(2));
      expect(original.value).toBe(5);
    });
  });

  describe('비교', () => {
    it('크기를 비교한다', () => {
      expect(Quantity.of(5).isGreaterThan(Quantity.of(4))).toBe(true);
      expect(Quantity.of(5).isGreaterThan(Quantity.of(5))).toBe(false);
    });

    it('0인지 판별한다', () => {
      expect(Quantity.ZERO.isZero()).toBe(true);
      expect(Quantity.of(1).isZero()).toBe(false);
    });

    it('값이 같으면 같다', () => {
      expect(Quantity.of(3).equals(Quantity.of(3))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/quantity.spec.ts`
Expected: FAIL — `Failed to resolve import "./quantity"`

- [ ] **Step 3: Quantity 구현**

`apps/api/src/shared/kernel/quantity.ts`:

```ts
export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

export class NegativeQuantityError extends Error {
  constructor(left: number, right: number) {
    super(`수량이 음수가 됩니다: ${left} - ${right}`);
    this.name = 'NegativeQuantityError';
  }
}

/**
 * 수량 값 객체.
 * - `of`: 0 이상. 재고 잔량처럼 0이 유효한 값인 경우.
 * - `positive`: 1 이상. 주문·장바구니 라인처럼 0이면 줄 자체가 없어야 하는 경우.
 */
export class Quantity {
  static readonly ZERO = new Quantity(0);

  private constructor(readonly value: number) {}

  static of(value: number): Quantity {
    Quantity.assertInteger(value);
    if (value < 0) {
      throw new InvalidQuantityError(`수량은 0 이상이어야 합니다: ${value}`);
    }
    return new Quantity(value);
  }

  static positive(value: number): Quantity {
    Quantity.assertInteger(value);
    if (value < 1) {
      throw new InvalidQuantityError(`수량은 1 이상이어야 합니다: ${value}`);
    }
    return new Quantity(value);
  }

  // 정수 검사는 두 팩토리가 공유한다. 범위 검사는 서로 달라야 하므로 각자 남긴다.
  private static assertInteger(value: number): void {
    if (!Number.isInteger(value)) {
      throw new InvalidQuantityError(`수량은 정수여야 합니다: ${value}`);
    }
  }

  plus(other: Quantity): Quantity {
    return new Quantity(this.value + other.value);
  }

  minus(other: Quantity): Quantity {
    const result = this.value - other.value;
    if (result < 0) {
      throw new NegativeQuantityError(this.value, other.value);
    }
    return new Quantity(result);
  }

  isGreaterThan(other: Quantity): boolean {
    return this.value > other.value;
  }

  isZero(): boolean {
    return this.value === 0;
  }

  equals(other: Quantity): boolean {
    return this.value === other.value;
  }
}
```

- [ ] **Step 4: Quantity 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/quantity.spec.ts`
Expected: PASS — 14 tests passed

- [ ] **Step 5: 실패하는 식별자 테스트 작성**

`apps/api/src/shared/kernel/identifiers.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CustomerId, InvalidIdError, OrderId, SkuId } from './identifiers';

const VALID_UUID = '0192f3a0-1234-7abc-8def-0123456789ab';

describe('식별자', () => {
  it('UUID 형식이면 생성된다', () => {
    expect(OrderId.of(VALID_UUID)).toBe(VALID_UUID);
  });

  it('UUID가 아니면 거부한다', () => {
    expect(() => OrderId.of('order-1')).toThrow(InvalidIdError);
  });

  it('빈 문자열을 거부한다', () => {
    expect(() => OrderId.of('')).toThrow(InvalidIdError);
  });

  it('대문자 UUID도 허용한다', () => {
    expect(() => SkuId.of(VALID_UUID.toUpperCase())).not.toThrow();
  });

  it('서로 다른 ID 타입은 컴파일 단계에서 섞이지 않는다', () => {
    // 런타임에는 같은 문자열이지만 타입이 다르다.
    // 아래 주석을 해제하면 `pnpm typecheck`가 실패해야 한다:
    //   const wrong: OrderId = CustomerId.of(VALID_UUID);
    const orderId = OrderId.of(VALID_UUID);
    const customerId = CustomerId.of(VALID_UUID);
    expect(String(orderId)).toBe(String(customerId));
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/identifiers.spec.ts`
Expected: FAIL — `Failed to resolve import "./identifiers"`

- [ ] **Step 7: 식별자 구현**

`apps/api/src/shared/kernel/identifiers.ts`:

```ts
declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export class InvalidIdError extends Error {
  constructor(kind: string, value: string) {
    super(`${kind}는 UUID 형식이어야 합니다: "${value}"`);
    this.name = 'InvalidIdError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeIdFactory<T extends string>(kind: T) {
  return {
    of(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new InvalidIdError(kind, value);
      }
      return value as Brand<string, T>;
    },
  };
}

export type OrderId = Brand<string, 'OrderId'>;
export type CartId = Brand<string, 'CartId'>;
export type SkuId = Brand<string, 'SkuId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type ReservationId = Brand<string, 'ReservationId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type AddressId = Brand<string, 'AddressId'>;

export const OrderId = makeIdFactory('OrderId');
export const CartId = makeIdFactory('CartId');
export const SkuId = makeIdFactory('SkuId');
export const ProductId = makeIdFactory('ProductId');
export const CustomerId = makeIdFactory('CustomerId');
export const AccountId = makeIdFactory('AccountId');
export const ReservationId = makeIdFactory('ReservationId');
export const PaymentId = makeIdFactory('PaymentId');
export const AddressId = makeIdFactory('AddressId');
```

- [ ] **Step 8: 식별자 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/identifiers.spec.ts`
Expected: PASS — 5 tests passed

- [ ] **Step 9: branded 타입이 실제로 섞이지 않는지 수동 확인**

`identifiers.spec.ts`의 주석 처리된 줄을 잠시 해제한다:

```ts
const wrong: OrderId = CustomerId.of(VALID_UUID);
```

Run: `pnpm typecheck`
Expected: FAIL — `Type 'CustomerId' is not assignable to type 'OrderId'`

확인 후 그 줄을 **다시 주석 처리**하고 `pnpm typecheck`가 통과하는 것을 확인한다.

- [ ] **Step 10: 커밋**

```bash
git add apps/api/src/shared/kernel
git commit -m "feat: Quantity 값 객체와 branded 식별자 타입"
```

---

### Task 3: Duration, DomainError, DomainEvent, AggregateRoot

**Files:**
- Create: `apps/api/src/shared/kernel/duration.ts`
- Create: `apps/api/src/shared/kernel/domain-error.ts`
- Create: `apps/api/src/shared/kernel/domain-event.ts`
- Create: `apps/api/src/shared/kernel/aggregate-root.ts`
- Test: `apps/api/src/shared/kernel/duration.spec.ts`
- Test: `apps/api/src/shared/kernel/domain-error.spec.ts`
- Test: `apps/api/src/shared/kernel/aggregate-root.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `class Duration` — `static ofMillis(n)`, `static seconds(n)`, `static minutes(n)`, `static hours(n)`,
    `readonly millis: number`, `plus(other)`, `isLongerThan(other)`, `equals(other)`
  - `abstract class DomainError extends Error` — `abstract readonly code: string`
  - `interface DomainEvent` — `{ eventType, aggregateType, aggregateId, occurredAt: Date, payload }`
  - `abstract class AggregateRoot` — `protected raise(event: DomainEvent): void`,
    `pullEvents(): DomainEvent[]`, `get hasUncommittedEvents(): boolean`

- [ ] **Step 1: 실패하는 Duration 테스트 작성**

`apps/api/src/shared/kernel/duration.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Duration, InvalidDurationError } from './duration';

describe('Duration', () => {
  it('밀리초 단위로 보관한다', () => {
    expect(Duration.ofMillis(1500).millis).toBe(1500);
  });

  it('초·분·시를 밀리초로 환산한다', () => {
    expect(Duration.seconds(2).millis).toBe(2000);
    expect(Duration.minutes(15).millis).toBe(900_000);
    expect(Duration.hours(1).millis).toBe(3_600_000);
  });

  it('음수를 거부한다', () => {
    expect(() => Duration.ofMillis(-1)).toThrow(InvalidDurationError);
  });

  it('소수 밀리초를 거부한다', () => {
    expect(() => Duration.ofMillis(1.5)).toThrow(InvalidDurationError);
  });

  it('더한다', () => {
    expect(Duration.minutes(10).plus(Duration.minutes(5)).millis).toBe(900_000);
  });

  it('길이를 비교한다', () => {
    expect(Duration.minutes(16).isLongerThan(Duration.minutes(15))).toBe(true);
    expect(Duration.minutes(15).isLongerThan(Duration.minutes(15))).toBe(false);
  });

  it('값이 같으면 같다', () => {
    expect(Duration.minutes(1).equals(Duration.seconds(60))).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/duration.spec.ts`
Expected: FAIL — `Failed to resolve import "./duration"`

- [ ] **Step 3: Duration 구현**

`apps/api/src/shared/kernel/duration.ts`:

```ts
export class InvalidDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDurationError';
  }
}

/** 기간 값 객체. 예약 TTL 계산과 테스트에서의 시간 조작에 쓴다. */
export class Duration {
  private constructor(readonly millis: number) {}

  static ofMillis(millis: number): Duration {
    if (!Number.isInteger(millis)) {
      throw new InvalidDurationError(`기간은 정수 밀리초여야 합니다: ${millis}`);
    }
    if (millis < 0) {
      throw new InvalidDurationError(`기간은 0 이상이어야 합니다: ${millis}`);
    }
    return new Duration(millis);
  }

  static seconds(value: number): Duration {
    return Duration.ofMillis(value * 1000);
  }

  static minutes(value: number): Duration {
    return Duration.ofMillis(value * 60_000);
  }

  static hours(value: number): Duration {
    return Duration.ofMillis(value * 3_600_000);
  }

  plus(other: Duration): Duration {
    return new Duration(this.millis + other.millis);
  }

  isLongerThan(other: Duration): boolean {
    return this.millis > other.millis;
  }

  equals(other: Duration): boolean {
    return this.millis === other.millis;
  }
}
```

- [ ] **Step 4: Duration 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/duration.spec.ts`
Expected: PASS — 7 tests passed

- [ ] **Step 5: 실패하는 DomainError 테스트 작성**

`apps/api/src/shared/kernel/domain-error.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';

class SampleDomainError extends DomainError {
  readonly code = 'SAMPLE_FAILURE';
  constructor(readonly detail: string) {
    super(`샘플 실패: ${detail}`);
  }
}

describe('DomainError', () => {
  it('Error를 상속한다', () => {
    expect(new SampleDomainError('x')).toBeInstanceOf(Error);
  });

  it('name이 구체 클래스 이름으로 설정된다 — 예외 필터가 이 값으로 매핑한다', () => {
    expect(new SampleDomainError('x').name).toBe('SampleDomainError');
  });

  it('code를 노출한다', () => {
    expect(new SampleDomainError('x').code).toBe('SAMPLE_FAILURE');
  });

  it('메시지를 보존한다', () => {
    expect(new SampleDomainError('재고 부족').message).toBe('샘플 실패: 재고 부족');
  });

  it('HTTP 상태 코드를 담지 않는다 — 매핑은 어댑터의 책임이다', () => {
    const error = new SampleDomainError('x') as unknown as Record<string, unknown>;
    expect('status' in error).toBe(false);
    expect('statusCode' in error).toBe(false);
    expect('httpStatus' in error).toBe(false);
  });

  it('스택 트레이스를 가진다', () => {
    expect(new SampleDomainError('x').stack).toBeDefined();
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/domain-error.spec.ts`
Expected: FAIL — `Failed to resolve import "./domain-error"`

- [ ] **Step 7: DomainError와 DomainEvent 구현**

`apps/api/src/shared/kernel/domain-error.ts`:

```ts
/**
 * 모든 도메인 예외의 기반 클래스.
 * HTTP 상태 코드를 절대 담지 않는다 — 그러면 HTTP가 아닌 경로(배치, 이벤트 핸들러)에서
 * 의미를 잃는다. 상태 코드 매핑은 인바운드 어댑터의 예외 필터가 담당한다.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
```

`apps/api/src/shared/kernel/domain-event.ts`:

```ts
/**
 * 도메인 이벤트. outbox 테이블의 컬럼과 1:1로 대응한다.
 * payload는 JSON 직렬화 가능한 값만 담는다 (bigint는 문자열로 변환할 것).
 */
export interface DomainEvent {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}
```

- [ ] **Step 8: DomainError 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/domain-error.spec.ts`
Expected: PASS — 6 tests passed

- [ ] **Step 9: 실패하는 AggregateRoot 테스트 작성**

`apps/api/src/shared/kernel/aggregate-root.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root';
import type { DomainEvent } from './domain-event';

function sampleEvent(type: string): DomainEvent {
  return {
    eventType: type,
    aggregateType: 'Sample',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: {},
  };
}

class SampleAggregate extends AggregateRoot {
  doSomething(): void {
    this.raise(sampleEvent('SomethingHappened'));
  }

  doTwoThings(): void {
    this.raise(sampleEvent('First'));
    this.raise(sampleEvent('Second'));
  }
}

describe('AggregateRoot', () => {
  it('처음에는 미커밋 이벤트가 없다', () => {
    expect(new SampleAggregate().hasUncommittedEvents).toBe(false);
  });

  it('raise한 이벤트가 쌓인다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    expect(aggregate.hasUncommittedEvents).toBe(true);
  });

  it('pullEvents가 쌓인 이벤트를 순서대로 반환한다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doTwoThings();
    expect(aggregate.pullEvents().map((e) => e.eventType)).toEqual(['First', 'Second']);
  });

  it('pullEvents는 내부 목록을 비운다 — 같은 이벤트를 두 번 발행하지 않기 위함', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    aggregate.pullEvents();
    expect(aggregate.pullEvents()).toEqual([]);
    expect(aggregate.hasUncommittedEvents).toBe(false);
  });

  it('반환된 배열을 변형해도 애그리거트 내부에 영향이 없다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    const pulled = aggregate.pullEvents();
    pulled.push(sampleEvent('Injected'));
    aggregate.doSomething();
    expect(aggregate.pullEvents()).toHaveLength(1);
  });
});
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/kernel/aggregate-root.spec.ts`
Expected: FAIL — `Failed to resolve import "./aggregate-root"`

- [ ] **Step 11: AggregateRoot 구현**

`apps/api/src/shared/kernel/aggregate-root.ts`:

```ts
import type { DomainEvent } from './domain-event';

/**
 * 애그리거트 루트 기반 클래스.
 * 비즈니스 메서드가 이벤트를 raise하면 내부에 쌓이고, 리포지토리가 저장 직후
 * pullEvents()로 꺼내 같은 트랜잭션 안에서 outbox에 기록한다.
 */
export abstract class AggregateRoot {
  private uncommittedEvents: DomainEvent[] = [];

  protected raise(event: DomainEvent): void {
    this.uncommittedEvents.push(event);
  }

  /** 쌓인 이벤트를 반환하고 내부 목록을 비운다. */
  pullEvents(): DomainEvent[] {
    const pulled = this.uncommittedEvents;
    this.uncommittedEvents = [];
    return pulled;
  }

  get hasUncommittedEvents(): boolean {
    return this.uncommittedEvents.length > 0;
  }
}
```

- [ ] **Step 12: 전체 테스트와 린트 확인**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: 모두 통과 (Money 17 + Quantity 14 + 식별자 5 + Duration 7 + DomainError 6 + AggregateRoot 5)

- [ ] **Step 13: 커밋**

```bash
git add apps/api/src/shared/kernel
git commit -m "feat: Duration, DomainError, DomainEvent, AggregateRoot 커널 추가"
```

---

### Task 4: Clock / IdGenerator 포트와 어댑터, fake

이 태스크가 만드는 `MutableClock`은 스펙 9.7의 TTL 만료 테스트 전체가 의존하는 도구다.
Vitest의 fake timer를 쓰지 않는 이유는 전역을 오염시켜 Prisma의 내부 타이머·커넥션
keepalive와 충돌하기 때문이다.

**Files:**
- Create: `apps/api/src/shared/kernel/ports/clock.ts`
- Create: `apps/api/src/shared/kernel/ports/id-generator.ts`
- Create: `apps/api/src/shared/testing/mutable-clock.ts`
- Create: `apps/api/src/shared/testing/sequential-id-generator.ts`
- Create: `apps/api/src/shared/infrastructure/clock/system-clock.ts`
- Create: `apps/api/src/shared/infrastructure/id/uuid-v7.generator.ts`
- Test: `apps/api/src/shared/testing/mutable-clock.spec.ts`
- Test: `apps/api/src/shared/testing/sequential-id-generator.spec.ts`
- Test: `apps/api/src/shared/infrastructure/id/uuid-v7.generator.spec.ts`
- Modify: `apps/api/package.json` (uuid 의존성 추가)

**Interfaces:**
- Consumes: `Duration` (Task 3)
- Produces:
  - `interface Clock { now(): Date }`
  - `interface IdGenerator { nextId(): string }`
  - `class SystemClock implements Clock`
  - `class UuidV7Generator implements IdGenerator`
  - `class MutableClock implements Clock` — `constructor(start?: Date)`, `advanceBy(d: Duration): void`,
    `setTo(instant: Date): void`
  - `class SequentialIdGenerator implements IdGenerator` — `constructor(prefix?: string)`, `reset(): void`

- [ ] **Step 1: uuid 의존성 설치**

Run: `pnpm --filter @commerce/api add uuid && pnpm --filter @commerce/api add -D @types/uuid`
Expected: `apps/api/package.json`에 `uuid` 추가 (v11 이상 — `v7` export가 필요하다)

- [ ] **Step 2: 포트 인터페이스 작성**

포트는 인터페이스뿐이라 테스트할 동작이 없다. 구현체 테스트로 검증한다.

`apps/api/src/shared/kernel/ports/clock.ts`:

```ts
/**
 * 현재 시각 포트.
 * 도메인과 유스케이스는 절대 `new Date()`나 `Date.now()`를 직접 부르지 않는다.
 * 그러면 TTL 만료 테스트에서 15분을 실제로 기다려야 한다.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
```

`apps/api/src/shared/kernel/ports/id-generator.ts`:

```ts
/** 식별자 생성 포트. 테스트에서는 결정적 fake로 바꿔 끼운다. */
export interface IdGenerator {
  nextId(): string;
}

export const ID_GENERATOR = Symbol('IdGenerator');
```

- [ ] **Step 3: 실패하는 MutableClock 테스트 작성**

`apps/api/src/shared/testing/mutable-clock.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Duration } from '../kernel/duration';
import { MutableClock } from './mutable-clock';

const START = new Date('2026-01-01T00:00:00.000Z');

describe('MutableClock', () => {
  it('생성 시각을 그대로 반환한다', () => {
    expect(new MutableClock(START).now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('같은 시각을 여러 번 물어도 값이 변하지 않는다', () => {
    const clock = new MutableClock(START);
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it('advanceBy로 시간을 앞당긴다', () => {
    const clock = new MutableClock(START);
    clock.advanceBy(Duration.minutes(16));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:16:00.000Z');
  });

  it('advanceBy를 여러 번 호출하면 누적된다', () => {
    const clock = new MutableClock(START);
    clock.advanceBy(Duration.minutes(10));
    clock.advanceBy(Duration.minutes(5));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it('setTo로 특정 시각에 고정한다', () => {
    const clock = new MutableClock(START);
    clock.setTo(new Date('2026-03-15T12:30:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-03-15T12:30:00.000Z');
  });

  it('반환된 Date를 변형해도 시계에 영향이 없다', () => {
    const clock = new MutableClock(START);
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/mutable-clock.spec.ts`
Expected: FAIL — `Failed to resolve import "./mutable-clock"`

- [ ] **Step 5: MutableClock과 SystemClock 구현**

`apps/api/src/shared/testing/mutable-clock.ts`:

```ts
import type { Duration } from '../kernel/duration';
import type { Clock } from '../kernel/ports/clock';

/** 테스트용 Clock. 시간을 임의로 앞당길 수 있다. */
export class MutableClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceBy(duration: Duration): void {
    this.current = new Date(this.current.getTime() + duration.millis);
  }

  setTo(instant: Date): void {
    this.current = new Date(instant.getTime());
  }
}
```

`apps/api/src/shared/infrastructure/clock/system-clock.ts`:

```ts
import type { Clock } from '../../kernel/ports/clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
```

- [ ] **Step 6: MutableClock 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/mutable-clock.spec.ts`
Expected: PASS — 6 tests passed

- [ ] **Step 7: 실패하는 ID 생성기 테스트 작성**

`apps/api/src/shared/testing/sequential-id-generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrderId } from '../kernel/identifiers';
import { SequentialIdGenerator } from './sequential-id-generator';

describe('SequentialIdGenerator', () => {
  it('호출할 때마다 다른 ID를 준다', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.nextId()).not.toBe(ids.nextId());
  });

  it('생성 순서를 예측할 수 있다', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000001');
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000002');
  });

  it('식별자 VO가 받아들이는 UUID 형식이다', () => {
    const ids = new SequentialIdGenerator();
    expect(() => OrderId.of(ids.nextId())).not.toThrow();
  });

  it('prefix를 다르게 주면 서로 겹치지 않는다', () => {
    const orders = new SequentialIdGenerator('00000000-0000-7000-8000-');
    const skus = new SequentialIdGenerator('11111111-0000-7000-8000-');
    expect(orders.nextId()).not.toBe(skus.nextId());
  });

  it('reset하면 처음부터 다시 센다', () => {
    const ids = new SequentialIdGenerator();
    ids.nextId();
    ids.reset();
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000001');
  });
});
```

`apps/api/src/shared/infrastructure/id/uuid-v7.generator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrderId } from '../../kernel/identifiers';
import { UuidV7Generator } from './uuid-v7.generator';

describe('UuidV7Generator', () => {
  it('식별자 VO가 받아들이는 UUID 형식이다', () => {
    expect(() => OrderId.of(new UuidV7Generator().nextId())).not.toThrow();
  });

  it('버전 7이다', () => {
    // UUID의 13번째 hex 문자가 버전을 나타낸다: xxxxxxxx-xxxx-Vxxx-...
    expect(new UuidV7Generator().nextId()[14]).toBe('7');
  });

  it('나중에 만든 ID가 문자열 정렬에서 뒤에 온다 — 인덱스 친화적이어야 한다', async () => {
    const ids = new UuidV7Generator();
    const first = ids.nextId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = ids.nextId();
    expect(second > first).toBe(true);
  });

  it('연속 호출해도 중복되지 않는다', () => {
    const ids = new UuidV7Generator();
    const generated = new Set(Array.from({ length: 1000 }, () => ids.nextId()));
    expect(generated.size).toBe(1000);
  });
});
```

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/sequential-id-generator.spec.ts apps/api/src/shared/infrastructure/id/uuid-v7.generator.spec.ts`
Expected: FAIL — 두 모듈 모두 resolve 실패

- [ ] **Step 9: ID 생성기 구현**

`apps/api/src/shared/testing/sequential-id-generator.ts`:

```ts
import type { IdGenerator } from '../kernel/ports/id-generator';

/**
 * 테스트용 결정적 ID 생성기.
 * 식별자 VO가 UUID 형식을 요구하므로, 카운터를 UUID의 마지막 노드에 채워 넣는다.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string = '00000000-0000-7000-8000-') {}

  nextId(): string {
    this.counter += 1;
    return `${this.prefix}${this.counter.toString(16).padStart(12, '0')}`;
  }

  reset(): void {
    this.counter = 0;
  }
}
```

`apps/api/src/shared/infrastructure/id/uuid-v7.generator.ts`:

```ts
import { v7 as uuidv7 } from 'uuid';
import type { IdGenerator } from '../../kernel/ports/id-generator';

/**
 * UUID v7 생성기.
 * v7은 앞부분이 타임스탬프라 문자열 정렬 = 생성 순서가 되어 B-tree 인덱스에 친화적이다.
 */
export class UuidV7Generator implements IdGenerator {
  nextId(): string {
    return uuidv7();
  }
}
```

- [ ] **Step 10: 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing apps/api/src/shared/infrastructure`
Expected: PASS — 15 tests passed (MutableClock 6 + Sequential 5 + UuidV7 4)

- [ ] **Step 11: 커밋**

```bash
git add apps/api/src/shared apps/api/package.json pnpm-lock.yaml
git commit -m "feat: Clock/IdGenerator 포트와 어댑터, 테스트 fake"
```

---

### Task 5: Docker Postgres + Prisma + outbox 스키마

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `apps/api/.env`
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma7.config.ts`
- Create: `apps/api/prisma/migrations/*/migration.sql` (Prisma가 생성)
- Modify: `apps/api/package.json`, `package.json` (스크립트)
- Modify: `.gitignore` (`.env`는 이미 무시됨 — 확인만)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `outbox` 테이블 — 컬럼: `id`(uuid PK), `aggregate_type`, `aggregate_id`(uuid),
    `event_type`, `payload`(jsonb), `occurred_at`(timestamptz), `published_at`(timestamptz, nullable)
  - 부분 인덱스 `outbox_unpublished_idx ON outbox (occurred_at) WHERE published_at IS NULL`
  - Prisma 모델명 `Outbox`, 클라이언트 접근자 `prisma.outbox`
  - 환경변수 `DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`, `TEST_DATABASE_BASE_URL`

- [ ] **Step 1: Docker Compose와 환경변수 템플릿 작성**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17-alpine
    container_name: commerce-db
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: commerce
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 3s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

`.env.example`:

```bash
# 개발용 데이터베이스
DATABASE_URL="postgresql://postgres:dev@localhost:5432/commerce?schema=public"

# 테스트용 — 템플릿 DB 생성과 워커별 복제에 쓴다
TEST_DATABASE_ADMIN_URL="postgresql://postgres:dev@localhost:5432/postgres"
TEST_DATABASE_BASE_URL="postgresql://postgres:dev@localhost:5432"
```

`apps/api/.env` (커밋하지 않는다 — `.gitignore`에 `.env`가 이미 있다):

```bash
DATABASE_URL="postgresql://postgres:dev@localhost:5432/commerce?schema=public"
TEST_DATABASE_ADMIN_URL="postgresql://postgres:dev@localhost:5432/postgres"
TEST_DATABASE_BASE_URL="postgresql://postgres:dev@localhost:5432"
```

- [ ] **Step 2: Postgres 기동 확인**

Run: `docker compose up -d && docker compose ps`
Expected: `commerce-db` 상태가 `healthy`

접속도 확인한다.

Run: `docker compose exec db psql -U postgres -d commerce -c 'SELECT version();'`
Expected: `PostgreSQL 17.x` 출력

- [ ] **Step 3: Prisma 설치와 스키마 작성**

Run: `pnpm --filter @commerce/api add @prisma/client@^7.10.0 && pnpm --filter @commerce/api add -D prisma@^7.10.0 dotenv`

**버전을 반드시 고정한다.** npm의 `prisma` CLI는 `latest` dist-tag가 프리릴리스(8.0.0-rc)를 가리키는 반면
`@prisma/client`의 `latest`는 안정판 7.10.0을 가리킨다 — 두 동반 패키지의 태그가 어긋나 있다.
고정 없이 설치하면 CLI만 RC로 올라가 (a) CLI/client 버전 불일치, (b) RC가 끌어오는
`@prisma/composer-cli` → `alchemy`(AWS SDK, Cloudflare `workerd` 네이티브 런타임, ~84MB)라는
이 프로젝트와 무관한 의존성 체인, (c) `workerd`·`msgpackr-extract`에 대한 `ERR_PNPM_IGNORED_BUILDS`가
한꺼번에 발생한다. CLI와 client는 항상 같은 메이저·마이너로 맞춘다.

`apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

/// 도메인 이벤트를 애그리거트 저장과 같은 트랜잭션으로 커밋하기 위한 테이블.
/// 릴레이가 published_at IS NULL 인 행만 폴링해 발행한다.
model Outbox {
  id            String    @id @db.Uuid
  aggregateType String    @map("aggregate_type")
  aggregateId   String    @map("aggregate_id") @db.Uuid
  eventType     String    @map("event_type")
  payload       Json      @db.JsonB
  occurredAt    DateTime  @map("occurred_at") @db.Timestamptz(3)
  publishedAt   DateTime? @map("published_at") @db.Timestamptz(3)

  @@map("outbox")
}
```

**Prisma 7은 `datasource.url`을 스키마 파일에서 완전히 제거했다.** 위 블록에 `url` 줄이
있으면 `P1012: The datasource property \`url\` is no longer supported in schema files`로 실패한다.
연결 문자열은 별도 설정 파일로 옮긴다.

`apps/api/prisma7.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
```

파일명이 `prisma7.config.ts`인 것은 오타가 아니다 — Prisma 7 CLI가 이 이름을 찾는다
(설치된 `prisma@7.10.0` 패키지 안에서 이 문자열이 확인된다). `dotenv/config` import가 필요한
이유는 `prisma` CLI에 `--env-file` 플래그가 없어서, 이 파일이 로드될 때 `.env`를
`process.env`에 올려주지 않으면 `datasource.url`이 비어 실패하기 때문이다.

`apps/api/package.json`의 `scripts`에 추가:

```json
{
  "scripts": {
    "prisma": "prisma",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy"
  }
}
```

루트 `package.json`의 `scripts`에 추가:

```json
{
  "db:up": "docker compose up -d",
  "db:down": "docker compose down",
  "db:migrate": "pnpm --filter @commerce/api db:migrate",
  "db:generate": "pnpm --filter @commerce/api db:generate"
}
```

- [ ] **Step 4: 첫 마이그레이션 생성 및 적용**

Run: `pnpm --filter @commerce/api exec prisma migrate dev --name init_outbox`
Expected: `apps/api/prisma/migrations/<timestamp>_init_outbox/migration.sql` 생성,
Prisma Client 생성 완료

- [ ] **Step 5: 부분 인덱스 마이그레이션 추가**

Prisma 스키마 문법으로는 부분 인덱스(`WHERE ...`)를 표현할 수 없다. 빈 마이그레이션을
만들어 raw SQL을 직접 넣는다.

Run: `pnpm --filter @commerce/api exec prisma migrate dev --create-only --name outbox_partial_index`

생성된 `apps/api/prisma/migrations/<timestamp>_outbox_partial_index/migration.sql`의 내용을
아래로 **교체**한다:

```sql
-- 미발행 이벤트만 담는 부분 인덱스.
-- 릴레이는 published_at IS NULL 인 행만 훑으므로, 발행 완료된 행은 인덱스에서 빠진다.
CREATE INDEX "outbox_unpublished_idx"
  ON "outbox" ("occurred_at")
  WHERE "published_at" IS NULL;
```

Run: `pnpm --filter @commerce/api exec prisma migrate dev`
Expected: 방금 만든 마이그레이션이 적용됨

- [ ] **Step 6: 스키마와 인덱스가 실제로 만들어졌는지 확인**

Run: `docker compose exec db psql -U postgres -d commerce -c '\d outbox'`
Expected: 7개 컬럼과 `outbox_unpublished_idx` 인덱스가 보이고,
인덱스 정의에 `WHERE (published_at IS NULL)`이 포함됨

- [ ] **Step 7: 커밋**

```bash
git add docker-compose.yml .env.example apps/api/prisma apps/api/prisma7.config.ts \
  apps/api/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: Docker Postgres와 outbox 테이블 스키마"
```

---

### Task 6: 테스트 DB 격리 인프라

스펙 9.5의 3단계 전략을 구현한다. 테스트를 트랜잭션으로 감싸 롤백하는 방식은 쓰지 않는다 —
같은 트랜잭션 안에서는 동시성 경합을 재현할 수 없기 때문이다.

**Files:**
- Create: `apps/api/test/setup/global-setup.ts`
- Create: `apps/api/test/setup/database.ts`
- Create: `apps/api/test/setup/integration-setup.ts`
- Test: `apps/api/test/setup/database.integration.spec.ts`
- Create: `apps/api/tsconfig.typecheck.json`
- Modify: `vitest.config.ts` (api-integration 프로젝트 추가), `apps/api/package.json` (typecheck 스크립트)
- Modify: `package.json` (pg, dotenv 의존성)

**Interfaces:**
- Consumes: `outbox` 테이블 (Task 5)
- Produces:
  - `testDb(): Promise<PrismaClient>` — 워커별 DB에 연결된 클라이언트 (캐시됨)
  - `truncateAll(db: PrismaClient): Promise<void>` — `_prisma_migrations`를 제외한 전 테이블 비움
  - `closeTestDb(): Promise<void>`
  - `apps/api/test/setup/integration-setup.ts` — `beforeAll`/`beforeEach`/`afterAll` 자동 등록
  - vitest 프로젝트 이름 `api-integration`, 대상 패턴 `**/*.integration.spec.ts`

- [ ] **Step 1: 의존성 설치**

Run: `pnpm add -D -w pg @types/pg dotenv && pnpm --filter @commerce/api add @prisma/adapter-pg@^7.10.0`
Expected: 루트 `package.json`의 devDependencies에 3개 추가

- [ ] **Step 2: 전역 setup 작성 — 템플릿 DB 생성**

`apps/api/test/setup/global-setup.ts`:

```ts
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

  const leftovers = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'commerce_test%'`,
  );
  for (const row of leftovers.rows) {
    await dropDatabase(admin, row.datname);
  }

  await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  await admin.end();

  execSync('pnpm --filter @commerce/api exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: `${baseUrl}/${TEMPLATE_DB}` },
    stdio: 'inherit',
  });
}
```

- [ ] **Step 3: 워커별 DB 관리 모듈 작성**

`apps/api/test/setup/database.ts`:

```ts
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

function workerDatabaseName(): string {
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
```

- [ ] **Step 4: 통합 테스트 공통 훅 작성**

`apps/api/test/setup/integration-setup.ts`:

```ts
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { closeTestDb, testDb, truncateAll } from './database';

beforeAll(async () => {
  await testDb();
});

beforeEach(async () => {
  await truncateAll(await testDb());
});

afterAll(async () => {
  await closeTestDb();
});
```

- [ ] **Step 5: vitest 설정에 api-integration 프로젝트 추가**

`vitest.config.ts`를 아래로 **교체**한다:

```ts
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: 'apps/api/.env' });

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api-unit',
          include: ['apps/api/src/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api-integration',
          include: ['apps/api/**/*.integration.spec.ts'],
          environment: 'node',
          globalSetup: ['./apps/api/test/setup/global-setup.ts'],
          setupFiles: ['./apps/api/test/setup/integration-setup.ts'],
          fileParallelism: true,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      thresholds: {
        'apps/api/src/shared/kernel/**': { lines: 95, branches: 90 },
      },
    },
  },
});
```

루트 `package.json`의 `scripts`에 추가:

```json
{
  "test:unit": "vitest run --project api-unit",
  "test:int": "vitest run --project api-integration"
}
```

- [ ] **Step 5b: typecheck가 test/** 를 커버하게 만든다**

`apps/api/tsconfig.json`의 `include`는 `src/**`뿐이라, 지금 만든 `apps/api/test/**`가
`pnpm typecheck`에서 영구히 빠진다. `pnpm verify`가 이 계획의 완료 게이트이므로 그대로 두면
게이트가 거짓말을 한다.

`include`에 `test/**/*.ts`를 그냥 추가하는 것은 동작하지 않는다 — `rootDir: "src"` 때문에
`error TS6059: File ... is not under 'rootDir'`로 실패한다. 별도 설정 파일을 둔다.

`apps/api/tsconfig.typecheck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "prisma7.config.ts"]
}
```

`apps/api/package.json`의 typecheck 스크립트를 이 파일로 돌린다:

```json
"typecheck": "tsc -p tsconfig.typecheck.json"
```

`tsconfig.json`은 build 전용으로 그대로 둔다 — dist 산출물에 테스트 파일이 섞이지 않는다.
`prisma7.config.ts`(Task 5에서 생성)도 같은 이유로 검사 대상 밖이었으므로 함께 포함한다.

Run: `pnpm typecheck && pnpm --filter @commerce/api exec tsc -p tsconfig.typecheck.json --listFiles | grep -c 'apps/api/test'`
Expected: 통과하고, test 디렉터리 파일이 4개 잡힌다.

- [ ] **Step 6: 격리가 실제로 동작하는지 검증하는 테스트 작성**

`apps/api/test/setup/database.integration.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { testDb } from './database';

async function insertOutboxRow(id: string): Promise<void> {
  const db = await testDb();
  await db.outbox.create({
    data: {
      id,
      aggregateType: 'Sample',
      aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
      eventType: 'SampleHappened',
      payload: { hello: 'world' },
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
}

describe('테스트 DB 격리', () => {
  it('워커 전용 DB에 연결된다', async () => {
    const db = await testDb();
    const [row] = await db.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    expect(row?.current_database).toMatch(/^commerce_test_w\d+$/);
  });

  it('마이그레이션이 적용되어 outbox 테이블이 존재한다', async () => {
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('부분 인덱스가 복제되어 있다', async () => {
    const db = await testDb();
    const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'outbox' AND indexname = 'outbox_unpublished_idx'
    `;
    expect(rows[0]?.indexdef).toContain('WHERE (published_at IS NULL)');
  });

  it('행을 넣으면 조회된다', async () => {
    await insertOutboxRow('0192f3a0-1111-7abc-8def-000000000001');
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('이전 테스트가 넣은 행이 남아 있지 않다 — beforeEach의 TRUNCATE가 동작한다', async () => {
    const db = await testDb();
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('connection_limit이 20으로 설정되어 동시 커넥션이 확보된다', async () => {
    const db = await testDb();
    // 동시에 10개 쿼리를 던져도 직렬화되지 않고 모두 성공해야 한다.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`),
    );
    expect(results).toHaveLength(10);
  });
});
```

- [ ] **Step 7: 통합 테스트 실행**

Run: `pnpm db:up && pnpm test:int`
Expected: PASS — 6 tests passed.
5번째 테스트("이전 테스트가 넣은 행이 남아 있지 않다")가 실패하면 `beforeEach`의
`truncateAll`이 등록되지 않은 것이므로 `setupFiles` 경로를 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add apps/api/test apps/api/package.json vitest.config.ts package.json pnpm-lock.yaml
git commit -m "test: TEMPLATE 복제 기반 테스트 DB 격리 인프라"
```

---

### Task 7: TransactionManager 포트와 Prisma 어댑터

유스케이스가 트랜잭션 경계의 주인이 되게 하되, `@prisma/client`의 존재는 모르게 한다.
`TransactionContext`는 불투명 타입이고, 실제 Prisma 클라이언트로 되돌리는 캐스팅은
어댑터 계층의 헬퍼 한 곳에만 존재한다.

**Files:**
- Create: `apps/api/src/shared/kernel/ports/transaction-manager.ts`
- Create: `apps/api/src/shared/infrastructure/prisma/prisma-transaction-manager.ts`
- Create: `apps/api/src/shared/testing/passthrough-transaction-manager.ts`
- Test: `apps/api/src/shared/testing/passthrough-transaction-manager.spec.ts`
- Test: `apps/api/src/shared/infrastructure/prisma/prisma-transaction-manager.integration.spec.ts`

**Interfaces:**
- Consumes: `testDb()` (Task 6), `outbox` 테이블 (Task 5)
- Produces:
  - `type TransactionContext` — 불투명 브랜드 타입
  - `interface TransactionManager { run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> }`
  - `const TRANSACTION_MANAGER: symbol` — Nest DI 토큰
  - `class PrismaTransactionManager implements TransactionManager` — `constructor(prisma: PrismaClient)`
  - `function asPrismaClient(tx: TransactionContext): Prisma.TransactionClient` — 어댑터 전용 캐스팅 헬퍼
  - `class PassthroughTransactionManager implements TransactionManager`

- [ ] **Step 1: 포트 작성**

`apps/api/src/shared/kernel/ports/transaction-manager.ts`:

```ts
declare const transactionContextBrand: unique symbol;

/**
 * 트랜잭션 핸들. 애플리케이션 계층은 이 값의 내부를 절대 들여다보지 않고
 * 리포지토리 포트에 그대로 넘기기만 한다.
 * 실제 Prisma 클라이언트로 되돌리는 캐스팅은 어댑터의 asPrismaClient()에만 존재한다.
 */
export type TransactionContext = { readonly [transactionContextBrand]: true };

export interface TransactionManager {
  /** work가 예외를 던지면 트랜잭션 전체가 롤백된다. */
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export const TRANSACTION_MANAGER = Symbol('TransactionManager');
```

- [ ] **Step 2: 실패하는 Passthrough fake 테스트 작성**

`apps/api/src/shared/testing/passthrough-transaction-manager.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PassthroughTransactionManager } from './passthrough-transaction-manager';

describe('PassthroughTransactionManager', () => {
  it('work를 실행하고 반환값을 그대로 전달한다', async () => {
    const manager = new PassthroughTransactionManager();
    await expect(manager.run(async () => 42)).resolves.toBe(42);
  });

  it('work에 트랜잭션 핸들을 넘긴다', async () => {
    const manager = new PassthroughTransactionManager();
    await manager.run(async (tx) => {
      expect(tx).toBeDefined();
      return null;
    });
  });

  it('work가 던진 예외를 그대로 전파한다', async () => {
    const manager = new PassthroughTransactionManager();
    await expect(
      manager.run(async () => {
        throw new Error('의도된 실패');
      }),
    ).rejects.toThrow('의도된 실패');
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/passthrough-transaction-manager.spec.ts`
Expected: FAIL — `Failed to resolve import "./passthrough-transaction-manager"`

- [ ] **Step 4: Passthrough fake 구현**

`apps/api/src/shared/testing/passthrough-transaction-manager.ts`:

```ts
import type {
  TransactionContext,
  TransactionManager,
} from '../kernel/ports/transaction-manager';

/**
 * 단위 테스트용 TransactionManager.
 * 실제 트랜잭션 없이 work를 그대로 실행한다. 인메모리 리포지토리와 함께 쓴다.
 */
export class PassthroughTransactionManager implements TransactionManager {
  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({} as TransactionContext);
  }
}
```

- [ ] **Step 5: fake 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/passthrough-transaction-manager.spec.ts`
Expected: PASS — 3 tests passed

- [ ] **Step 6: 실패하는 Prisma 어댑터 통합 테스트 작성**

`apps/api/src/shared/infrastructure/prisma/prisma-transaction-manager.integration.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { testDb } from '../../../../test/setup/database';
import { asPrismaClient, PrismaTransactionManager } from './prisma-transaction-manager';

let db: PrismaClient;
let manager: PrismaTransactionManager;

beforeAll(async () => {
  db = await testDb();
  manager = new PrismaTransactionManager(db);
});

function outboxRow(id: string) {
  return {
    id,
    aggregateType: 'Sample',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    eventType: 'SampleHappened',
    payload: {},
    occurredAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('PrismaTransactionManager', () => {
  it('work가 정상 종료하면 커밋된다', async () => {
    await manager.run(async (tx) => {
      await asPrismaClient(tx).outbox.create({
        data: outboxRow('0192f3a0-2222-7abc-8def-000000000001'),
      });
    });

    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('work가 예외를 던지면 롤백된다', async () => {
    await expect(
      manager.run(async (tx) => {
        await asPrismaClient(tx).outbox.create({
          data: outboxRow('0192f3a0-2222-7abc-8def-000000000002'),
        });
        throw new Error('의도된 실패');
      }),
    ).rejects.toThrow('의도된 실패');

    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('work의 반환값을 그대로 전달한다', async () => {
    await expect(manager.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('트랜잭션 안에서 쓴 데이터를 같은 트랜잭션 안에서 읽을 수 있다', async () => {
    const count = await manager.run(async (tx) => {
      const client = asPrismaClient(tx);
      await client.outbox.create({ data: outboxRow('0192f3a0-2222-7abc-8def-000000000003') });
      return client.outbox.count();
    });

    expect(count).toBe(1);
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project api-integration prisma-transaction-manager`
Expected: FAIL — `Failed to resolve import "./prisma-transaction-manager"`

- [ ] **Step 8: Prisma 어댑터 구현**

`apps/api/src/shared/infrastructure/prisma/prisma-transaction-manager.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  TransactionContext,
  TransactionManager,
} from '../../kernel/ports/transaction-manager';

/**
 * 불투명한 TransactionContext를 실제 Prisma 트랜잭션 클라이언트로 되돌린다.
 * 이 캐스팅은 어댑터 계층에만 존재해야 한다 — 애플리케이션이 이 함수를 부르면
 * dependency-cruiser의 application-knows-no-adapters 규칙이 잡아낸다.
 */
export function asPrismaClient(tx: TransactionContext): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

export class PrismaTransactionManager implements TransactionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) =>
      work(client as unknown as TransactionContext),
    );
  }
}
```

- [ ] **Step 9: 통합 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project api-integration prisma-transaction-manager`
Expected: PASS — 4 tests passed

- [ ] **Step 10: 커밋**

```bash
git add apps/api/src/shared
git commit -m "feat: TransactionManager 포트와 Prisma 어댑터"
```

---

### Task 8: DomainEventPublisher 포트와 Outbox 어댑터

스펙 6.3의 핵심을 구현한다. "주문 저장은 성공했는데 이벤트 발행이 실패해 재고가 영원히
예약 상태로 남는" 문제를, 이벤트를 애그리거트와 **같은 트랜잭션 안에서** DB에 기록해 막는다.
이 태스크의 4번째 테스트가 그 원자성을 직접 검증한다.

**Files:**
- Create: `apps/api/src/shared/kernel/ports/domain-event.publisher.ts`
- Create: `apps/api/src/shared/infrastructure/outbox/outbox-event.publisher.ts`
- Create: `apps/api/src/shared/testing/recording-event-publisher.ts`
- Test: `apps/api/src/shared/testing/recording-event-publisher.spec.ts`
- Test: `apps/api/src/shared/infrastructure/outbox/outbox-event.publisher.integration.spec.ts`

**Interfaces:**
- Consumes: `DomainEvent` (Task 3), `IdGenerator` (Task 4), `TransactionContext`·`asPrismaClient` (Task 7), `testDb()` (Task 6)
- Produces:
  - `interface DomainEventPublisher { publish(events: DomainEvent[], tx?: TransactionContext): Promise<void> }`
  - `const DOMAIN_EVENT_PUBLISHER: symbol`
  - `class OutboxEventPublisher implements DomainEventPublisher` — `constructor(prisma: PrismaClient, ids: IdGenerator)`
  - `class RecordingEventPublisher implements DomainEventPublisher` —
    `readonly published: DomainEvent[]`, `eventsOfType(type: string): DomainEvent[]`, `clear(): void`

- [ ] **Step 1: 포트 작성**

`apps/api/src/shared/kernel/ports/domain-event.publisher.ts`:

```ts
import type { DomainEvent } from '../domain-event';
import type { TransactionContext } from './transaction-manager';

/**
 * 도메인 이벤트 발행 포트.
 * tx를 함께 넘기면 애그리거트 저장과 같은 트랜잭션으로 커밋된다 — 이벤트 유실을 막는
 * 유일한 방법이다. 애플리케이션은 이 뒤에 outbox 테이블이 있다는 사실을 모른다.
 */
export interface DomainEventPublisher {
  publish(events: DomainEvent[], tx?: TransactionContext): Promise<void>;
}

export const DOMAIN_EVENT_PUBLISHER = Symbol('DomainEventPublisher');
```

- [ ] **Step 2: 실패하는 RecordingEventPublisher 테스트 작성**

`apps/api/src/shared/testing/recording-event-publisher.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../kernel/domain-event';
import { RecordingEventPublisher } from './recording-event-publisher';

function event(type: string): DomainEvent {
  return {
    eventType: type,
    aggregateType: 'Order',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: {},
  };
}

describe('RecordingEventPublisher', () => {
  it('발행된 이벤트를 순서대로 보관한다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced'), event('OrderPaid')]);
    expect(publisher.published.map((e) => e.eventType)).toEqual(['OrderPlaced', 'OrderPaid']);
  });

  it('여러 번 호출하면 누적된다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    await publisher.publish([event('OrderPaid')]);
    expect(publisher.published).toHaveLength(2);
  });

  it('타입으로 걸러낸다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced'), event('OrderPaid'), event('OrderPlaced')]);
    expect(publisher.eventsOfType('OrderPlaced')).toHaveLength(2);
  });

  it('clear로 비운다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    publisher.clear();
    expect(publisher.published).toEqual([]);
  });

  it('빈 배열을 발행해도 문제없다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([]);
    expect(publisher.published).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/recording-event-publisher.spec.ts`
Expected: FAIL — `Failed to resolve import "./recording-event-publisher"`

- [ ] **Step 4: RecordingEventPublisher 구현**

`apps/api/src/shared/testing/recording-event-publisher.ts`:

```ts
import type { DomainEvent } from '../kernel/domain-event';
import type { DomainEventPublisher } from '../kernel/ports/domain-event.publisher';

/**
 * 유스케이스 테스트용 fake.
 * "이 유스케이스가 OrderPaid를 발행했는가"를 상태로 검증한다.
 */
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];

  async publish(events: DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }

  eventsOfType(eventType: string): DomainEvent[] {
    return this.published.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.published.length = 0;
  }
}
```

- [ ] **Step 5: fake 테스트가 통과하는지 확인**

Run: `pnpm vitest run apps/api/src/shared/testing/recording-event-publisher.spec.ts`
Expected: PASS — 5 tests passed

- [ ] **Step 6: 실패하는 Outbox 어댑터 통합 테스트 작성**

`apps/api/src/shared/infrastructure/outbox/outbox-event.publisher.integration.spec.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
import type { DomainEvent } from '../../kernel/domain-event';
import { SequentialIdGenerator } from '../../testing/sequential-id-generator';
import { PrismaTransactionManager } from '../prisma/prisma-transaction-manager';
import { OutboxEventPublisher } from './outbox-event.publisher';

let db: PrismaClient;
let ids: SequentialIdGenerator;
let publisher: OutboxEventPublisher;
let transactions: PrismaTransactionManager;

const AGGREGATE_ID = '0192f3a0-1234-7abc-8def-0123456789ab';

function event(eventType: string, payload: Record<string, unknown> = {}): DomainEvent {
  return {
    eventType,
    aggregateType: 'Order',
    aggregateId: AGGREGATE_ID,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    payload,
  };
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(() => {
  ids = new SequentialIdGenerator('0192f3a0-9999-7abc-8def-');
  publisher = new OutboxEventPublisher(db, ids);
  transactions = new PrismaTransactionManager(db);
});

describe('OutboxEventPublisher', () => {
  it('이벤트를 outbox 행으로 저장한다', async () => {
    await publisher.publish([event('OrderPlaced')]);

    const rows = await db.outbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('OrderPlaced');
    expect(rows[0]?.aggregateType).toBe('Order');
    expect(rows[0]?.aggregateId).toBe(AGGREGATE_ID);
  });

  it('저장 직후 published_at은 비어 있다 — 릴레이가 아직 보내지 않았다', async () => {
    await publisher.publish([event('OrderPlaced')]);
    const [row] = await db.outbox.findMany();
    expect(row?.publishedAt).toBeNull();
  });

  it('payload가 JSON으로 왕복 보존된다', async () => {
    await publisher.publish([event('OrderPaid', { amount: '15000', currency: 'KRW' })]);
    const [row] = await db.outbox.findMany();
    expect(row?.payload).toEqual({ amount: '15000', currency: 'KRW' });
  });

  it('빈 배열이면 아무 행도 만들지 않는다', async () => {
    await publisher.publish([]);
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('여러 이벤트를 한 번에 저장한다', async () => {
    await publisher.publish([event('OrderPlaced'), event('OrderPaid')]);
    await expect(db.outbox.count()).resolves.toBe(2);
  });

  it('트랜잭션과 함께 발행하면 커밋 시 함께 저장된다', async () => {
    await transactions.run(async (tx) => {
      await publisher.publish([event('OrderPaid')], tx);
    });

    await expect(db.outbox.count()).resolves.toBe(1);
  });

  it('트랜잭션이 롤백되면 이벤트 행도 사라진다 — Outbox를 쓰는 이유 자체', async () => {
    await expect(
      transactions.run(async (tx) => {
        await publisher.publish([event('OrderPaid')], tx);
        throw new Error('저장 중 실패');
      }),
    ).rejects.toThrow('저장 중 실패');

    await expect(db.outbox.count()).resolves.toBe(0);
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project api-integration outbox-event.publisher`
Expected: FAIL — `Failed to resolve import "./outbox-event.publisher"`

- [ ] **Step 8: OutboxEventPublisher 구현**

`apps/api/src/shared/infrastructure/outbox/outbox-event.publisher.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { DomainEvent } from '../../kernel/domain-event';
import type { DomainEventPublisher } from '../../kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../kernel/ports/id-generator';
import type { TransactionContext } from '../../kernel/ports/transaction-manager';
import { asPrismaClient } from '../prisma/prisma-transaction-manager';

/**
 * 도메인 이벤트를 outbox 테이블에 기록하는 어댑터.
 * tx가 주어지면 그 트랜잭션 클라이언트로 INSERT하므로 애그리거트 저장과 원자적으로 커밋된다.
 * 실제 발행은 OutboxRelay가 별도로 수행한다.
 */
export class OutboxEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ids: IdGenerator,
  ) {}

  async publish(events: DomainEvent[], tx?: TransactionContext): Promise<void> {
    if (events.length === 0) return;

    const client = tx ? asPrismaClient(tx) : this.prisma;
    await client.outbox.createMany({
      data: events.map((event) => ({
        id: this.ids.nextId(),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
      })),
    });
  }
}
```

- [ ] **Step 9: 통합 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project api-integration outbox-event.publisher`
Expected: PASS — 7 tests passed

- [ ] **Step 10: 커밋**

```bash
git add apps/api/src/shared
git commit -m "feat: DomainEventPublisher 포트와 Outbox 어댑터"
```

---

### Task 9: OutboxRelay와 EventTransport

릴레이는 **at-least-once** 전달을 보장한다. 전송 성공 후 마킹 전에 프로세스가 죽으면
같은 이벤트가 다시 전송되므로, 구독자는 반드시 멱등해야 한다. 이 태스크의 테스트가
"이미 발행된 행은 다시 보내지 않는다"와 "전송 실패한 행은 다음 라운드에 재시도된다"를
모두 검증한다.

**Files:**
- Create: `apps/api/src/shared/kernel/ports/event-transport.ts`
- Create: `apps/api/src/shared/infrastructure/outbox/outbox-relay.ts`
- Create: `apps/api/src/shared/testing/recording-event-transport.ts`
- Test: `apps/api/src/shared/infrastructure/outbox/outbox-relay.integration.spec.ts`

**Interfaces:**
- Consumes: `outbox` 테이블 (Task 5), `Clock` (Task 4), `testDb()` (Task 6)
- Produces:
  - `interface OutboxRecord` — `{ id, aggregateType, aggregateId, eventType, payload, occurredAt }`
  - `interface EventTransport { send(record: OutboxRecord): Promise<void> }`
  - `const EVENT_TRANSPORT: symbol`
  - `class OutboxRelay` — `constructor(prisma: PrismaClient, transport: EventTransport, clock: Clock, batchSize?: number)`,
    `relayOnce(): Promise<number>` (전송한 건수 반환)
  - `class RecordingEventTransport implements EventTransport` —
    `readonly sent: OutboxRecord[]`, `failWhen(predicate: (record: OutboxRecord) => boolean): void`

- [ ] **Step 1: EventTransport 포트 작성**

`apps/api/src/shared/kernel/ports/event-transport.ts`:

```ts
/** outbox 행 하나가 바깥으로 나갈 때의 모양. */
export interface OutboxRecord {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

/**
 * 이벤트가 나가는 출구.
 * 지금은 같은 프로세스의 Nest EventEmitter 어댑터를 꽂지만,
 * 나중에 Kafka 어댑터로 교체해도 릴레이 코드는 바뀌지 않는다.
 */
export interface EventTransport {
  send(record: OutboxRecord): Promise<void>;
}

export const EVENT_TRANSPORT = Symbol('EventTransport');
```

- [ ] **Step 2: RecordingEventTransport fake 작성**

`apps/api/src/shared/testing/recording-event-transport.ts`:

```ts
import type { EventTransport, OutboxRecord } from '../kernel/ports/event-transport';

/**
 * 릴레이 테스트용 fake.
 * failWhen으로 특정 레코드의 전송을 실패시켜 재시도 경로를 검증할 수 있다.
 */
export class RecordingEventTransport implements EventTransport {
  readonly sent: OutboxRecord[] = [];
  private shouldFail: ((record: OutboxRecord) => boolean) | undefined;

  failWhen(predicate: (record: OutboxRecord) => boolean): void {
    this.shouldFail = predicate;
  }

  succeedAlways(): void {
    this.shouldFail = undefined;
  }

  async send(record: OutboxRecord): Promise<void> {
    if (this.shouldFail?.(record)) {
      throw new Error(`전송 실패: ${record.eventType}`);
    }
    this.sent.push(record);
  }
}
```

- [ ] **Step 3: 실패하는 릴레이 통합 테스트 작성**

`apps/api/src/shared/infrastructure/outbox/outbox-relay.integration.spec.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/setup/database';
import { MutableClock } from '../../testing/mutable-clock';
import { RecordingEventTransport } from '../../testing/recording-event-transport';
import { OutboxRelay } from './outbox-relay';

let db: PrismaClient;
let transport: RecordingEventTransport;
let clock: MutableClock;
let relay: OutboxRelay;

const NOW = new Date('2026-02-01T00:00:00.000Z');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(() => {
  transport = new RecordingEventTransport();
  clock = new MutableClock(NOW);
  relay = new OutboxRelay(db, transport, clock);
});

let rowCounter = 0;

async function seedEvent(eventType: string, occurredAt: string): Promise<string> {
  rowCounter += 1;
  const id = `0192f3a0-8888-7abc-8def-${rowCounter.toString(16).padStart(12, '0')}`;
  await db.outbox.create({
    data: {
      id,
      aggregateType: 'Order',
      aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
      eventType,
      payload: { note: eventType },
      occurredAt: new Date(occurredAt),
    },
  });
  return id;
}

describe('OutboxRelay', () => {
  it('발행할 이벤트가 없으면 0을 반환한다', async () => {
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toEqual([]);
  });

  it('미발행 이벤트를 전송한다', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');

    await expect(relay.relayOnce()).resolves.toBe(1);
    expect(transport.sent.map((r) => r.eventType)).toEqual(['OrderPaid']);
    expect(transport.sent[0]?.payload).toEqual({ note: 'OrderPaid' });
  });

  it('전송에 성공하면 published_at을 현재 시각으로 채운다', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');
    await relay.relayOnce();

    const [row] = await db.outbox.findMany();
    expect(row?.publishedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('이미 발행된 이벤트는 다시 보내지 않는다 — 멱등성', async () => {
    await seedEvent('OrderPaid', '2026-01-01T00:00:00Z');

    await relay.relayOnce();
    await expect(relay.relayOnce()).resolves.toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('occurred_at 오름차순으로 전송한다', async () => {
    await seedEvent('Third', '2026-01-03T00:00:00Z');
    await seedEvent('First', '2026-01-01T00:00:00Z');
    await seedEvent('Second', '2026-01-02T00:00:00Z');

    await relay.relayOnce();
    expect(transport.sent.map((r) => r.eventType)).toEqual(['First', 'Second', 'Third']);
  });

  it('배치 크기를 넘겨 보내지 않는다', async () => {
    await seedEvent('A', '2026-01-01T00:00:00Z');
    await seedEvent('B', '2026-01-02T00:00:00Z');
    await seedEvent('C', '2026-01-03T00:00:00Z');

    const limited = new OutboxRelay(db, transport, clock, 2);
    await expect(limited.relayOnce()).resolves.toBe(2);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(1);
  });

  it('전송이 실패한 이벤트는 미발행으로 남아 다음 라운드에 재시도된다', async () => {
    await seedEvent('Flaky', '2026-01-01T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Flaky');

    await expect(relay.relayOnce()).rejects.toThrow('전송 실패: Flaky');
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(1);

    transport.succeedAlways();
    await expect(relay.relayOnce()).resolves.toBe(1);
    await expect(db.outbox.count({ where: { publishedAt: null } })).resolves.toBe(0);
  });

  it('배치 중간에 실패해도 이미 보낸 이벤트는 발행 완료로 남는다', async () => {
    await seedEvent('Good', '2026-01-01T00:00:00Z');
    await seedEvent('Bad', '2026-01-02T00:00:00Z');
    transport.failWhen((record) => record.eventType === 'Bad');

    await expect(relay.relayOnce()).rejects.toThrow('전송 실패: Bad');

    const good = await db.outbox.findFirst({ where: { eventType: 'Good' } });
    const bad = await db.outbox.findFirst({ where: { eventType: 'Bad' } });
    expect(good?.publishedAt).not.toBeNull();
    expect(bad?.publishedAt).toBeNull();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project api-integration outbox-relay`
Expected: FAIL — `Failed to resolve import "./outbox-relay"`

- [ ] **Step 5: OutboxRelay 구현**

`apps/api/src/shared/infrastructure/outbox/outbox-relay.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../../kernel/ports/clock';
import type { EventTransport } from '../../kernel/ports/event-transport';

/**
 * 미발행 outbox 행을 폴링해 전송하고 published_at을 채운다.
 *
 * 전달 보장은 at-least-once다. 전송 성공 후 마킹 전에 프로세스가 죽으면 같은 이벤트가
 * 다시 전송되므로 구독자는 반드시 멱등해야 한다. exactly-once는 분산 트랜잭션 없이는
 * 불가능하고, 이 프로젝트에서는 감수하는 쪽이 옳다.
 */
export class OutboxRelay {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: EventTransport,
    private readonly clock: Clock,
    private readonly batchSize: number = 100,
  ) {}

  /** 한 배치를 처리하고 전송한 건수를 반환한다. */
  async relayOnce(): Promise<number> {
    const rows = await this.prisma.outbox.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: this.batchSize,
    });

    let sent = 0;
    for (const row of rows) {
      await this.transport.send({
        id: row.id,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
        occurredAt: row.occurredAt,
      });

      await this.prisma.outbox.update({
        where: { id: row.id },
        data: { publishedAt: this.clock.now() },
      });
      sent += 1;
    }

    return sent;
  }
}
```

- [ ] **Step 6: 통합 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project api-integration outbox-relay`
Expected: PASS — 8 tests passed

- [ ] **Step 7: 전체 테스트 확인**

Run: `pnpm test`
Expected: api-unit과 api-integration 모두 통과

- [ ] **Step 8: 커밋**

```bash
git add apps/api/src/shared
git commit -m "feat: OutboxRelay와 EventTransport 포트"
```

---

### Task 10: contracts 패키지

계약 패키지는 어떤 앱도 import하지 않는 리프(leaf)다. Nest 예외 필터(Task 11)가
`ErrorCode`를 필요로 하므로 먼저 만든다.

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/shared/error-codes.ts`
- Create: `packages/contracts/src/shared/money.dto.ts`
- Create: `packages/contracts/src/health/health.contract.ts`
- Test: `packages/contracts/src/shared/error-codes.spec.ts`
- Test: `packages/contracts/src/health/health.contract.spec.ts`
- Modify: `vitest.config.ts` (contracts 프로젝트 추가)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `enum ErrorCode` — `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
    `DOMAIN_RULE_VIOLATED`, `INSUFFICIENT_STOCK`, `ORDER_NOT_CANCELLABLE`, `PAYMENT_DECLINED`,
    `INTERNAL_ERROR`
  - `const moneyDtoSchema: z.ZodType<{ amount: string; currency: 'KRW' | 'USD' }>`
  - `type MoneyDto = z.infer<typeof moneyDtoSchema>`
  - `const errorDtoSchema` — `{ code: ErrorCode; message: string }`
  - `type ErrorDto = z.infer<typeof errorDtoSchema>`
  - `const healthContract` — ts-rest 라우터. `GET /health` → 200 `{ status: 'ok'; database: 'up' | 'down' }`
  - 패키지 이름 `@commerce/contracts`

- [ ] **Step 1: 패키지 스캐폴딩과 의존성 설치**

`packages/contracts/package.json`:

```json
{
  "name": "@commerce/contracts",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.0"
  }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

Run: `pnpm --filter @commerce/contracts add zod@^3.25.76 @ts-rest/core@^3.52.1`

**두 버전을 모두 고정한다.** npm의 `zod` `latest`는 4.x이지만 `@ts-rest/core`의 모든 안정 릴리스가
`peerDependencies: { zod: "^3.22.3" }`을 선언한다 — zod 4를 지원하는 ts-rest 안정 버전은 없다.
고정하지 않으면 선언되지 않은 조합 위에 계획 2~5의 엔드포인트 약 30개를 쌓게 된다.
zod 4는 오류 내부 구조(`.issues`, `flatten()`)를 바꿨는데 그 지점이 바로 ts-rest의
검증 파이프와 응답 파싱이 건드리는 표면이다.

`3.25.76`을 고르는 이유는 이 버전이 `zod/v4` 서브패스를 함께 제공하기 때문이다 —
ts-rest가 zod 4를 지원하면 메인 엔트리만 올리면 되고, 그전에도 필요하면
`import { z } from 'zod/v4'`로 개별 이관이 가능하다. 막다른 길이 아니다.

- [ ] **Step 2: 실패하는 ErrorCode 테스트 작성**

`packages/contracts/src/shared/error-codes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ErrorCode, errorDtoSchema } from './error-codes';

describe('ErrorCode', () => {
  it('값이 서로 중복되지 않는다 — 프론트가 이 값으로 분기한다', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it('값이 전부 SCREAMING_SNAKE_CASE다', () => {
    for (const value of Object.values(ErrorCode)) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('주문 파이프라인이 쓰는 코드를 포함한다', () => {
    expect(ErrorCode.INSUFFICIENT_STOCK).toBe('INSUFFICIENT_STOCK');
    expect(ErrorCode.ORDER_NOT_CANCELLABLE).toBe('ORDER_NOT_CANCELLABLE');
    expect(ErrorCode.PAYMENT_DECLINED).toBe('PAYMENT_DECLINED');
  });
});

describe('errorDtoSchema', () => {
  it('유효한 에러 응답을 통과시킨다', () => {
    const parsed = errorDtoSchema.parse({
      code: ErrorCode.INSUFFICIENT_STOCK,
      message: '재고가 부족합니다',
    });
    expect(parsed.code).toBe('INSUFFICIENT_STOCK');
  });

  it('알 수 없는 코드를 거부한다', () => {
    expect(() => errorDtoSchema.parse({ code: 'MADE_UP', message: 'x' })).toThrow();
  });

  it('message가 없으면 거부한다', () => {
    expect(() => errorDtoSchema.parse({ code: ErrorCode.NOT_FOUND })).toThrow();
  });
});
```

- [ ] **Step 3: vitest에 contracts 프로젝트 추가**

`vitest.config.ts`의 `projects` 배열 **맨 앞**에 추가한다:

```ts
{
  test: {
    name: 'contracts',
    include: ['packages/contracts/src/**/*.spec.ts'],
    environment: 'node',
  },
},
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project contracts`
Expected: FAIL — `Failed to resolve import "./error-codes"`

- [ ] **Step 5: error-codes와 money.dto 구현**

`packages/contracts/src/shared/error-codes.ts`:

```ts
import { z } from 'zod';

/**
 * 프론트엔드가 분기 기준으로 쓰는 에러 코드.
 * HTTP 상태 코드는 거칠어서(422 하나에 여러 원인) 코드로 구분한다.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  DOMAIN_RULE_VIOLATED = 'DOMAIN_RULE_VIOLATED',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',
  PAYMENT_DECLINED = 'PAYMENT_DECLINED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const errorDtoSchema = z.object({
  code: z.nativeEnum(ErrorCode),
  message: z.string().min(1),
});

export type ErrorDto = z.infer<typeof errorDtoSchema>;
```

`packages/contracts/src/shared/money.dto.ts`:

```ts
import { z } from 'zod';

/**
 * 금액 DTO. 도메인의 Money 값 객체가 아니다.
 * JSON에는 bigint가 없으므로 amount를 정수 문자열로 전달한다.
 */
export const moneyDtoSchema = z.object({
  amount: z.string().regex(/^-?\d+$/, '금액은 정수 문자열이어야 합니다'),
  currency: z.enum(['KRW', 'USD']),
});

export type MoneyDto = z.infer<typeof moneyDtoSchema>;
```

- [ ] **Step 6: ErrorCode 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project contracts`
Expected: PASS — 6 tests passed

- [ ] **Step 7: 실패하는 health 계약 테스트 작성**

`packages/contracts/src/health/health.contract.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { healthContract } from './health.contract';

describe('healthContract', () => {
  it('GET /health 경로를 노출한다', () => {
    expect(healthContract.check.method).toBe('GET');
    expect(healthContract.check.path).toBe('/health');
  });

  it('정상 응답을 통과시킨다', () => {
    const parsed = healthContract.check.responses[200].parse({
      status: 'ok',
      database: 'up',
    });
    expect(parsed.database).toBe('up');
  });

  it('database가 down인 응답도 유효하다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'down' }),
    ).not.toThrow();
  });

  it('알 수 없는 database 값을 거부한다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'maybe' }),
    ).toThrow();
  });
});
```

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project contracts health`
Expected: FAIL — `Failed to resolve import "./health.contract"`

- [ ] **Step 9: health 계약과 배럴 파일 구현**

`packages/contracts/src/health/health.contract.ts`:

```ts
import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const healthContract = c.router({
  check: {
    method: 'GET',
    path: '/health',
    responses: {
      200: z.object({
        status: z.literal('ok'),
        database: z.enum(['up', 'down']),
      }),
    },
    summary: 'API와 데이터베이스 연결 상태',
  },
});
```

`packages/contracts/src/index.ts`:

```ts
export * from './health/health.contract';
export * from './shared/error-codes';
export * from './shared/money.dto';
```

- [ ] **Step 10: 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project contracts`
Expected: PASS — 10 tests passed

- [ ] **Step 11: 커밋**

```bash
git add packages/contracts vitest.config.ts pnpm-lock.yaml package.json
git commit -m "feat: contracts 패키지 — 에러 코드, Money DTO, health 계약"
```

---

### Task 11: Nest 부트 + 예외 필터 + health 엔드포인트

여기서 처음으로 프레임워크가 등장한다. 지금까지 만든 커널과 포트는 `@nestjs/*`를
전혀 모르는 상태로 유지되며, Task 13의 dependency-cruiser가 이를 검증한다.

**Files:**
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/shared/shared.module.ts`
- Create: `apps/api/src/shared/infrastructure/prisma/prisma.service.ts`
- Create: `apps/api/src/shared/infrastructure/messaging/nest-event-emitter.transport.ts`
- Create: `apps/api/src/shared/infrastructure/http/domain-error.registry.ts`
- Create: `apps/api/src/shared/infrastructure/http/domain-exception.filter.ts`
- Create: `apps/api/src/shared/infrastructure/http/health.controller.ts`
- Test: `apps/api/src/shared/infrastructure/http/domain-error.registry.spec.ts`
- Test: `apps/api/src/shared/infrastructure/http/domain-exception.filter.integration.spec.ts`
- Modify: `vitest.config.ts` (swc 플러그인), `apps/api/package.json`

**Interfaces:**
- Consumes: `DomainError` (Task 3), `ErrorCode` (Task 10), `Clock`·`IdGenerator` (Task 4),
  `TransactionManager` (Task 7), `DomainEventPublisher` (Task 8), `EventTransport` (Task 9)
- Produces:
  - `class PrismaService extends PrismaClient` — Nest 수명주기에 연결
  - `class NestEventEmitterTransport implements EventTransport`
  - `interface DomainErrorMapping { status: number; code: ErrorCode }`
  - `class DomainErrorRegistry` — `register(errorName: string, mapping: DomainErrorMapping): void`,
    `resolve(errorName: string): DomainErrorMapping` (미등록 시 `{ status: 422, code: DOMAIN_RULE_VIOLATED }`)
  - `class DomainExceptionFilter implements ExceptionFilter`
  - `class SharedModule` — 위 어댑터들을 DI 토큰(`CLOCK`, `ID_GENERATOR`, `TRANSACTION_MANAGER`,
    `DOMAIN_EVENT_PUBLISHER`, `EVENT_TRANSPORT`)에 바인딩하고 export
  - `GET /health` 엔드포인트

- [ ] **Step 1: Nest와 테스트 도구 설치**

```bash
pnpm --filter @commerce/api add @nestjs/common@^12.0.1 @nestjs/core@^12.0.1 \
  @nestjs/platform-express@^12.0.1 @nestjs/event-emitter@^12.0.0 \
  reflect-metadata@^0.2.2 rxjs@^7.8.2 @commerce/contracts
pnpm --filter @commerce/api add -D @nestjs/testing@^12.0.1 supertest@^7.2.2 @types/supertest @types/express
pnpm add -D -w @swc/core@^1.16.1 unplugin-swc@^1.5.11
```

`@commerce/contracts`는 워크스페이스 프로토콜로 들어가야 한다. `apps/api/package.json`의
dependencies가 `"@commerce/contracts": "workspace:*"`인지 확인한다.

**Nest 12는 비교적 최근 메이저다.** 이 계획의 Nest 코드(`@Catch`, `ExceptionFilter`,
`ArgumentsHost`, `EventEmitterModule.forRoot()`, `NestFactory.create`)는 그보다 앞선
관용구로 작성됐다. 시그니처나 import 경로가 바뀌었을 수 있으니 **가정하지 말고 확인할 것** —
어긋나면 임의로 우회하지 말고 멈추고 보고한다. Prisma 7이 같은 방식으로 세 번 막았다.

- [ ] **Step 2: vitest에 swc 플러그인 추가**

Nest의 데코레이터와 `emitDecoratorMetadata`는 esbuild가 처리하지 못한다.
`vitest.config.ts`의 `api-unit`과 `api-integration` 프로젝트에 각각 플러그인을 추가한다.

파일 상단에 import를 추가하고:

```ts
import swc from 'unplugin-swc';
```

두 api 프로젝트 객체에 `plugins`를 추가한다 (`contracts`와 `web` 프로젝트에는 넣지 않는다):

```ts
{
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'api-unit',
    // ... 기존 설정 유지
  },
},
```

- [ ] **Step 3: 실패하는 DomainErrorRegistry 테스트 작성**

`apps/api/src/shared/infrastructure/http/domain-error.registry.spec.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { DomainErrorRegistry } from './domain-error.registry';

describe('DomainErrorRegistry', () => {
  it('등록한 매핑을 돌려준다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('InsufficientStockError', {
      status: 409,
      code: ErrorCode.INSUFFICIENT_STOCK,
    });

    expect(registry.resolve('InsufficientStockError')).toEqual({
      status: 409,
      code: ErrorCode.INSUFFICIENT_STOCK,
    });
  });

  it('등록되지 않은 도메인 예외는 422 DOMAIN_RULE_VIOLATED로 처리한다', () => {
    expect(new DomainErrorRegistry().resolve('UnknownError')).toEqual({
      status: 422,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
  });

  it('같은 이름을 두 번 등록하면 거부한다 — 조용한 덮어쓰기를 막는다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('SomeError', { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });

    expect(() =>
      registry.register('SomeError', { status: 422, code: ErrorCode.PAYMENT_DECLINED }),
    ).toThrow('SomeError');
  });

  it('여러 예외를 독립적으로 등록한다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('A', { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });
    registry.register('B', { status: 422, code: ErrorCode.PAYMENT_DECLINED });

    expect(registry.resolve('A').status).toBe(409);
    expect(registry.resolve('B').status).toBe(422);
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project api-unit domain-error.registry`
Expected: FAIL — `Failed to resolve import "./domain-error.registry"`

- [ ] **Step 5: 레지스트리와 예외 필터 구현**

`apps/api/src/shared/infrastructure/http/domain-error.registry.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import { Injectable } from '@nestjs/common';

export interface DomainErrorMapping {
  status: number;
  code: ErrorCode;
}

const FALLBACK: DomainErrorMapping = {
  status: 422,
  code: ErrorCode.DOMAIN_RULE_VIOLATED,
};

/**
 * 도메인 예외 이름 → HTTP 상태 + 에러 코드 매핑.
 * 각 모듈이 자기 예외를 등록한다. 도메인 예외 자체에는 상태 코드가 없으므로
 * 이 레지스트리가 유일한 매핑 지점이다.
 */
@Injectable()
export class DomainErrorRegistry {
  private readonly mappings = new Map<string, DomainErrorMapping>();

  register(errorName: string, mapping: DomainErrorMapping): void {
    if (this.mappings.has(errorName)) {
      throw new Error(`도메인 예외 매핑이 이미 등록되어 있습니다: ${errorName}`);
    }
    this.mappings.set(errorName, mapping);
  }

  resolve(errorName: string): DomainErrorMapping {
    return this.mappings.get(errorName) ?? FALLBACK;
  }
}
```

`apps/api/src/shared/infrastructure/http/domain-exception.filter.ts`:

```ts
import type { ErrorDto } from '@commerce/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../kernel/domain-error';
// biome-ignore lint/style/useImportType: 일관성 목적이며 여기서는 DI 필수 아님 — 이 필터는 main.ts에서 손으로 생성된다.
import { DomainErrorRegistry } from './domain-error.registry';

/**
 * 도메인 예외를 HTTP 응답으로 변환하는 유일한 지점.
 * 도메인은 HTTP를 모르고, 이 어댑터만 안다.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly registry: DomainErrorRegistry) {}

  catch(exception: DomainError, host: ArgumentsHost): void {
    const { status, code } = this.registry.resolve(exception.name);
    const body: ErrorDto = { code, message: exception.message };

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
```

- [ ] **Step 6: 레지스트리 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project api-unit domain-error.registry`
Expected: PASS — 4 tests passed

- [ ] **Step 7: PrismaService, EventTransport 어댑터, SharedModule 작성**

`apps/api/src/shared/infrastructure/prisma/prisma.service.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL이 설정되지 않았습니다.');
    }
    // Prisma 7은 스키마에 datasource.url을 두지 않으므로, 런타임 연결은
    // 반드시 드라이버 어댑터로 공급해야 한다 (Task 6에서 같은 이유로 확인됨).
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`apps/api/src/shared/infrastructure/messaging/nest-event-emitter.transport.ts`:

```ts
import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EventTransport, OutboxRecord } from '../../kernel/ports/event-transport';

/**
 * 같은 프로세스 안에서 이벤트를 전달하는 어댑터.
 * 나중에 Kafka 어댑터로 교체할 자리이며, OutboxRelay는 바뀌지 않는다.
 */
@Injectable()
export class NestEventEmitterTransport implements EventTransport {
  constructor(private readonly emitter: EventEmitter2) {}

  async send(record: OutboxRecord): Promise<void> {
    await this.emitter.emitAsync(record.eventType, record);
  }
}
```

`apps/api/src/shared/shared.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { type Clock, CLOCK } from './kernel/ports/clock';
import { DOMAIN_EVENT_PUBLISHER } from './kernel/ports/domain-event.publisher';
import { type EventTransport, EVENT_TRANSPORT } from './kernel/ports/event-transport';
import { type IdGenerator, ID_GENERATOR } from './kernel/ports/id-generator';
import { TRANSACTION_MANAGER } from './kernel/ports/transaction-manager';
import { SystemClock } from './infrastructure/clock/system-clock';
import { DomainErrorRegistry } from './infrastructure/http/domain-error.registry';
import { UuidV7Generator } from './infrastructure/id/uuid-v7.generator';
import { NestEventEmitterTransport } from './infrastructure/messaging/nest-event-emitter.transport';
import { OutboxEventPublisher } from './infrastructure/outbox/outbox-event.publisher';
import { OutboxRelay } from './infrastructure/outbox/outbox-relay';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { PrismaTransactionManager } from './infrastructure/prisma/prisma-transaction-manager';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    PrismaService,
    DomainErrorRegistry,
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    { provide: EVENT_TRANSPORT, useClass: NestEventEmitterTransport },
    {
      provide: TRANSACTION_MANAGER,
      useFactory: (prisma: PrismaService) => new PrismaTransactionManager(prisma),
      inject: [PrismaService],
    },
    {
      provide: DOMAIN_EVENT_PUBLISHER,
      useFactory: (prisma: PrismaService, ids: IdGenerator) =>
        new OutboxEventPublisher(prisma, ids),
      inject: [PrismaService, ID_GENERATOR],
    },
    {
      provide: OutboxRelay,
      useFactory: (prisma: PrismaService, transport: EventTransport, clock: Clock) =>
        new OutboxRelay(prisma, transport, clock),
      inject: [PrismaService, EVENT_TRANSPORT, CLOCK],
    },
  ],
  exports: [
    PrismaService,
    DomainErrorRegistry,
    OutboxRelay,
    CLOCK,
    ID_GENERATOR,
    EVENT_TRANSPORT,
    TRANSACTION_MANAGER,
    DOMAIN_EVENT_PUBLISHER,
  ],
})
export class SharedModule {}
```

- [ ] **Step 8: health 컨트롤러와 앱 부트스트랩 작성**

`apps/api/src/shared/infrastructure/http/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' | 'down' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'ok', database: 'down' };
    }
  }
}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [HealthController],
})
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorRegistry } from './shared/infrastructure/http/domain-error.registry';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainExceptionFilter(app.get(DomainErrorRegistry)));
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
```

`apps/api/package.json`의 `scripts`에 추가:

```json
{
  "dev": "node --watch -r dotenv/config -r ts-node/register src/main.ts",
  "build": "tsc -p tsconfig.json"
}
```

Run: `pnpm --filter @commerce/api add -D ts-node`

`@swc/core`는 네이티브 빌드 스크립트를 갖는다. `pnpm install`이 `ERR_PNPM_IGNORED_BUILDS`로
멈추면 `pnpm-workspace.yaml`의 `allowBuilds`에 `'@swc/core': true`를 추가한다 —
우리가 의도적으로 도입한 컴파일러이므로 정당한 승인이다.

- [ ] **Step 9: 실패하는 예외 필터 통합 테스트 작성**

`apps/api/src/shared/infrastructure/http/domain-exception.filter.integration.spec.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

Run: `pnpm vitest run --project api-integration domain-exception.filter`
Expected: FAIL — 데코레이터 메타데이터 또는 모듈 resolve 실패.
`Unable to resolve signature of class decorator`가 나오면 Step 2의 swc 플러그인이
적용되지 않은 것이므로 `vitest.config.ts`를 다시 확인한다.

- [ ] **Step 11: 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project api-integration domain-exception.filter`
Expected: PASS — 4 tests passed

- [ ] **Step 11b: DI 그래프가 실제로 조립되는지 테스트한다**

Step 12의 수동 curl 없이는 잡히지 않는 구멍이 있다. `useImportType` 자동 수정으로 DI가 깨져도
typecheck·lint·전체 테스트가 모두 통과한다 — `pnpm verify`가 기동조차 못 하는 앱에 초록불을 준다.
DB 없이 컨테이너 조립만 검증하는 테스트로 그 구멍을 막는다.

`apps/api/src/app.module.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { OutboxRelay } from './shared/infrastructure/outbox/outbox-relay';
import { PrismaService } from './shared/infrastructure/prisma/prisma.service';
import { CLOCK } from './shared/kernel/ports/clock';
import { DOMAIN_EVENT_PUBLISHER } from './shared/kernel/ports/domain-event.publisher';
import { EVENT_TRANSPORT } from './shared/kernel/ports/event-transport';
import { ID_GENERATOR } from './shared/kernel/ports/id-generator';
import { TRANSACTION_MANAGER } from './shared/kernel/ports/transaction-manager';

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
});
```

Run: `pnpm vitest run --project api-unit app.module`
Expected: PASS — 4 tests passed. `PrismaService` 생성자가 `DATABASE_URL`을 읽으므로
`apps/api/.env`가 있어야 한다(vitest.config.ts가 dotenv로 로드한다). DB 연결은 하지 않는다.

- [ ] **Step 12: 서버를 실제로 띄워 health 확인**

Run: `pnpm db:up && pnpm --filter @commerce/api dev`
별도 터미널에서: `curl -s localhost:3001/health`
Expected: `{"status":"ok","database":"up"}`

확인 후 서버를 종료한다.

- [ ] **Step 13: 커밋**

```bash
git add apps/api vitest.config.ts package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: Nest 부트스트랩, 도메인 예외 필터, health 엔드포인트"
```

---

### Task 12: Next 앱, BFF 골격, FSD 레이어, MSW

BFF에는 헥사고날을 적용하지 않는다(스펙 8.1). 대신 FSD 레이어 폴더를 만들고,
MSW 핸들러가 `@commerce/contracts` 스키마로 응답을 검증하게 해서 계약이 바뀌면
프론트 목이 즉시 깨지도록 한다(스펙 9.9).

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Create: `apps/web/src/shared/api/contract-client.ts`
- Create: `apps/web/src/shared/api/msw/handlers/health.ts`, `apps/web/src/shared/api/msw/server.ts`
- Create: `apps/web/src/shared/lib/format-money.ts`
- Create: `apps/web/src/server/api-client.ts`
- Create: FSD 레이어 디렉터리 (`src/{views,widgets,features,entities}/.gitkeep`)
- Create: `apps/web/test/setup.ts`
- Test: `apps/web/src/shared/lib/format-money.spec.ts`
- Test: `apps/web/src/shared/api/msw/handlers/health.spec.ts`
- Modify: `vitest.config.ts` (web 프로젝트 추가)

**Interfaces:**
- Consumes: `healthContract`, `MoneyDto` (Task 10)
- Produces:
  - `function formatMoney(money: MoneyDto): string` — KRW는 `15,000원`, USD는 `$1,234.56`
  - `function createContractClient(baseUrl: string)` — ts-rest 클라이언트 팩토리
  - `const apiClient` (`src/server/api-client.ts`) — 서버 전용. Nest를 호출한다
  - `const server` (MSW node 서버), `const healthHandlers`
  - vitest 프로젝트 이름 `web`

- [ ] **Step 1: Next 앱 스캐폴딩과 의존성 설치**

`--filter`는 대상 패키지가 이미 존재해야 동작한다. `package.json`을 먼저 만들고 설치한다.

`apps/web/package.json`:

```json
{
  "name": "@commerce/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

파일을 만든 뒤 의존성을 설치한다.

```bash
pnpm --filter @commerce/web add next@^16.3.4 react@^19.2.8 react-dom@^19.2.8 \
  @ts-rest/core@^3.52.1 @commerce/contracts server-only
pnpm --filter @commerce/web add -D @types/react @types/react-dom @types/node typescript vitest
pnpm add -D -w @testing-library/react@^16.3.3 @testing-library/jest-dom jsdom@^30.0.1 msw@^2.15.0
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@commerce/contracts'],
};

export default config;
```

`apps/web/app/layout.tsx`:

```tsx
export const metadata = { title: 'Commerce' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:

```tsx
export default function HomePage() {
  return <main>Commerce</main>;
}
```

- [ ] **Step 2: FSD 레이어 디렉터리 생성**

```bash
mkdir -p apps/web/src/{views,widgets,features,entities}
touch apps/web/src/{views,widgets,features,entities}/.gitkeep
```

레이어는 아래에서 위로만 의존한다: `shared → entities → features → widgets → views`.
`src/server/`는 BFF라 FSD 레이어 밖이며, Task 13의 dependency-cruiser가 이를 강제한다.

- [ ] **Step 3: 실패하는 formatMoney 테스트 작성**

`apps/web/src/shared/lib/format-money.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney } from './format-money';

describe('formatMoney', () => {
  it('원화는 천 단위 구분 기호와 원 단위로 표시한다', () => {
    expect(formatMoney({ amount: '15000', currency: 'KRW' })).toBe('15,000원');
  });

  it('백만 단위도 올바르게 끊는다', () => {
    expect(formatMoney({ amount: '1234567', currency: 'KRW' })).toBe('1,234,567원');
  });

  it('0원을 표시한다', () => {
    expect(formatMoney({ amount: '0', currency: 'KRW' })).toBe('0원');
  });

  it('세 자리 미만은 구분 기호가 없다', () => {
    expect(formatMoney({ amount: '500', currency: 'KRW' })).toBe('500원');
  });

  it('음수는 부호를 앞에 붙인다', () => {
    expect(formatMoney({ amount: '-5000', currency: 'KRW' })).toBe('-5,000원');
  });

  it('달러는 최소 단위가 센트이므로 소수 두 자리로 환산한다', () => {
    expect(formatMoney({ amount: '123456', currency: 'USD' })).toBe('$1,234.56');
  });

  it('1달러 미만의 센트도 올바르게 표시한다', () => {
    expect(formatMoney({ amount: '5', currency: 'USD' })).toBe('$0.05');
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인 (web 프로젝트 설정 포함)**

`vitest.config.ts`의 `projects` 배열 끝에 추가한다:

```ts
{
  test: {
    name: 'web',
    include: ['apps/web/src/**/*.spec.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./apps/web/test/setup.ts'],
  },
},
```

`apps/web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../src/shared/api/msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Run: `pnpm vitest run --project web`
Expected: FAIL — `format-money`와 `msw/server` 모두 resolve 실패

- [ ] **Step 5: formatMoney 구현**

`apps/web/src/shared/lib/format-money.ts`:

```ts
import type { MoneyDto } from '@commerce/contracts';

/** 통화별 최소 단위 자릿수. 원은 소수가 없고, 달러는 센트라 두 자리다. */
const MINOR_UNIT_DIGITS: Record<MoneyDto['currency'], number> = {
  KRW: 0,
  USD: 2,
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 금액 DTO를 화면 표기로 바꾼다.
 * 이것은 표현 로직이므로 프론트에 있는 것이 맞다 — 계산(합계, 할인)은 서버가 한다.
 */
export function formatMoney(money: MoneyDto): string {
  const digits = MINOR_UNIT_DIGITS[money.currency];
  const isNegative = money.amount.startsWith('-');
  const raw = isNegative ? money.amount.slice(1) : money.amount;
  const padded = raw.padStart(digits + 1, '0');

  const whole = padded.slice(0, padded.length - digits);
  const fraction = digits > 0 ? padded.slice(padded.length - digits) : '';
  const sign = isNegative ? '-' : '';
  const grouped = groupThousands(whole);

  return money.currency === 'KRW' ? `${sign}${grouped}원` : `${sign}$${grouped}.${fraction}`;
}
```

- [ ] **Step 6: MSW 핸들러와 클라이언트 작성**

`apps/web/src/shared/api/msw/handlers/health.ts`:

```ts
import { healthContract } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';

/**
 * 응답을 계약 스키마로 parse해서 내려준다.
 * 백엔드 계약이 바뀌면 이 핸들러가 즉시 터지므로, 목이 실물과 조용히 드리프트할 수 없다.
 */
export function healthHandler(payload: unknown) {
  return http.get('*/health', () =>
    HttpResponse.json(healthContract.check.responses[200].parse(payload)),
  );
}

export const healthHandlers = [healthHandler({ status: 'ok', database: 'up' })];
```

`apps/web/src/shared/api/msw/server.ts`:

```ts
import { setupServer } from 'msw/node';
import { healthHandlers } from './handlers/health';

export const server = setupServer(...healthHandlers);
```

`apps/web/src/shared/api/contract-client.ts`:

```ts
import { healthContract } from '@commerce/contracts';
import { initClient } from '@ts-rest/core';

export function createContractClient(baseUrl: string) {
  return initClient(healthContract, {
    baseUrl,
    baseHeaders: { 'Content-Type': 'application/json' },
  });
}
```

`apps/web/src/server/api-client.ts`:

```ts
import 'server-only';
import { createContractClient } from '../shared/api/contract-client';

/**
 * 서버 전용 API 클라이언트.
 * 계획 2에서 여기에 세션 쿠키 → 토큰 주입과 401 refresh 재시도가 들어간다.
 * 클라이언트 컴포넌트는 이 모듈을 import할 수 없다 ('server-only'가 빌드 단계에서 막는다).
 */
export const apiClient = createContractClient(
  process.env.API_BASE_URL ?? 'http://localhost:3001',
);
```

- [ ] **Step 7: 실패하는 MSW 핸들러 테스트 작성**

`apps/web/src/shared/api/msw/handlers/health.spec.ts`:

```ts
import { healthContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';

describe('health MSW 핸들러', () => {
  it('가로챈 응답이 계약 스키마를 만족한다', async () => {
    const response = await fetch('http://api.test/health');
    const body = await response.json();

    expect(() => healthContract.check.responses[200].parse(body)).not.toThrow();
  });

  it('응답 내용이 핸들러가 선언한 값과 같다', async () => {
    const response = await fetch('http://api.test/health');

    await expect(response.json()).resolves.toEqual({ status: 'ok', database: 'up' });
  });
});
```

- [ ] **Step 8: 테스트가 통과하는지 확인**

Run: `pnpm vitest run --project web`
Expected: PASS — 9 tests passed (formatMoney 7 + MSW 2)

- [ ] **Step 9: Next 앱이 실제로 뜨는지 확인**

Run: `pnpm --filter @commerce/web dev`
브라우저 또는 `curl -s localhost:3000`으로 확인
Expected: `Commerce` 텍스트가 담긴 HTML

확인 후 종료한다.

- [ ] **Step 10: 커밋**

```bash
git add apps/web vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat: Next 앱과 BFF 골격, FSD 레이어, MSW 계약 검증"
```

---

### Task 13: 경계 강제와 verify 파이프라인

규율을 사람의 의지가 아니라 도구가 지키게 만드는 마지막 단계다.
규칙이 실제로 위반을 잡는지 **일부러 어겨서 확인**하는 것이 이 태스크의 핵심이다.

**Files:**
- Create: `.dependency-cruiser.js`
- Create: `README.md`
- Modify: `package.json` (arch 스크립트, verify)
- Modify: `biome.jsonc` (계층별 import 금지 규칙)

**Interfaces:**
- Consumes: 앞선 모든 태스크의 디렉터리 구조
- Produces:
  - `pnpm arch:check` — 위반 시 종료 코드 1
  - `pnpm arch:graph` — `docs/architecture.svg` 생성 (graphviz `dot` 필요)
  - `pnpm verify` — lint + arch + typecheck + test 전체

- [ ] **Step 1: dependency-cruiser 설치와 설정 작성**

Run: `pnpm add -D -w dependency-cruiser@^18.2.0`

`.dependency-cruiser.js`:

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── 백엔드: 헥사고날 ──────────────────────────────────
    {
      name: 'kernel-is-pure',
      comment: '공유 커널은 프레임워크, ORM, DTO, 어댑터, 테스트 더블을 모른다',
      severity: 'error',
      from: { path: 'apps/api/src/shared/kernel' },
      to: {
        path: '(node_modules/@nestjs|node_modules/@prisma|apps/api/src/shared/infrastructure|apps/api/src/shared/testing|packages/contracts)',
      },
    },
    {
      name: 'domain-is-pure',
      comment: '도메인 계층은 프레임워크와 바깥 계층을 모른다',
      severity: 'error',
      from: { path: 'apps/api/src/modules/[^/]+/domain' },
      to: {
        path: '(node_modules/@nestjs|node_modules/@prisma|/application/|/adapters/)',
      },
    },
    {
      name: 'domain-must-not-know-dto',
      comment: '도메인 → DTO 변환은 어댑터의 매퍼가 한다',
      severity: 'error',
      from: { path: '(apps/api/src/modules/[^/]+/domain|apps/api/src/shared/kernel)' },
      to: { path: 'packages/contracts' },
    },
    {
      name: 'application-knows-no-adapters',
      comment: '애플리케이션은 포트 인터페이스만 안다',
      severity: 'error',
      from: { path: 'apps/api/src/modules/[^/]+/application' },
      to: { path: '(/adapters/|node_modules/@prisma)' },
    },
    {
      name: 'no-cross-module-internals',
      comment: '모듈 간 참조는 공개 API(index.ts)로만',
      severity: 'error',
      from: { path: 'apps/api/src/modules/([^/]+)/' },
      to: { path: 'apps/api/src/modules/(?!$1)[^/]+/(domain|application|adapters)' },
    },
    {
      name: 'no-test-doubles-in-production',
      comment: '테스트 fake가 운영 코드에 새어 들어가면 안 된다',
      severity: 'error',
      from: { path: 'apps/api/src', pathNot: '(\\.spec\\.ts$|apps/api/src/shared/testing)' },
      to: { path: 'apps/api/src/shared/testing' },
    },

    // ── 프론트: FSD ──────────────────────────────────────
    {
      name: 'fsd-shared-is-a-leaf',
      severity: 'error',
      from: { path: 'apps/web/src/shared' },
      to: { path: 'apps/web/src/(entities|features|widgets|views)' },
    },
    {
      name: 'fsd-entities-layer-direction',
      severity: 'error',
      from: { path: 'apps/web/src/entities' },
      to: { path: 'apps/web/src/(features|widgets|views)' },
    },
    {
      name: 'fsd-features-layer-direction',
      severity: 'error',
      from: { path: 'apps/web/src/features' },
      to: { path: 'apps/web/src/(widgets|views)' },
    },
    {
      name: 'fsd-no-cross-slice-internals',
      severity: 'error',
      from: { path: 'apps/web/src/features/([^/]+)/' },
      to: { path: 'apps/web/src/features/(?!$1)[^/]+/(ui|model|api)' },
    },
    {
      name: 'no-server-code-in-fsd',
      comment: 'BFF 전용 코드(토큰·세션)가 FSD 레이어로 새면 안 된다',
      severity: 'error',
      from: { path: 'apps/web/src/(entities|features|widgets|shared)' },
      to: { path: 'apps/web/src/server' },
    },

    // ── 경계 전반 ────────────────────────────────────────
    {
      name: 'web-must-not-import-api',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^apps/api' },
    },
    {
      name: 'contracts-is-a-leaf',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-circular',
      comment: '순환 참조 금지 — 특히 모듈 간 역방향 의존은 이벤트로만',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '(node_modules|\\.next|dist|coverage)' },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
```

- [ ] **Step 2: Biome에 계층별 import 금지 규칙 추가**

`biome.jsonc`에 `overrides` 배열을 추가한다 (기존 최상위 키는 그대로 둔다):

```jsonc
{
  "overrides": [
    {
      "includes": ["apps/api/src/shared/kernel/**", "apps/api/src/modules/*/domain/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  {
                    "group": ["@nestjs/*", "@prisma/client", "@commerce/contracts"],
                    "message": "도메인과 커널은 프레임워크·ORM·DTO를 알 수 없습니다."
                  }
                ]
              }
            }
          }
        }
      }
    },
    {
      "includes": ["apps/api/src/modules/*/application/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  {
                    "group": ["@prisma/client", "**/adapters/**"],
                    "message": "application은 포트 인터페이스만 압니다. 구현은 모릅니다."
                  }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

- [ ] **Step 3: 스크립트 추가**

루트 `package.json`의 `scripts`를 아래 항목으로 보강한다:

```json
{
  "arch:check": "depcruise --config .dependency-cruiser.js apps packages",
  "arch:graph": "depcruise --config .dependency-cruiser.js --output-type dot apps packages | dot -Tsvg > docs/architecture.svg",
  "verify": "pnpm lint && pnpm arch:check && pnpm typecheck && pnpm test"
}
```

- [ ] **Step 4: 규칙이 통과하는지 확인**

Run: `pnpm arch:check`
Expected: `no dependency violations found` — 위반 0건

- [ ] **Step 5: 규칙이 실제로 위반을 잡는지 확인**

일부러 커널을 오염시킨다.

```bash
cat > apps/api/src/shared/kernel/violation-probe.ts <<'EOF'
import { Injectable } from '@nestjs/common';

@Injectable()
export class ViolationProbe {}
EOF
```

Run: `pnpm arch:check`
Expected: **FAIL** — `error kernel-is-pure: apps/api/src/shared/kernel/violation-probe.ts → @nestjs/common`
그리고 종료 코드가 0이 아니다.

Biome도 같은 위반을 잡는지 확인한다.

Run: `pnpm lint`
Expected: **FAIL** — `noRestrictedImports` 위반이 `violation-probe.ts`에 보고됨

두 도구 모두 잡는 것을 확인했으면 파일을 지운다.

```bash
rm apps/api/src/shared/kernel/violation-probe.ts
```

Run: `pnpm arch:check && pnpm lint`
Expected: 둘 다 통과

- [ ] **Step 6: 의존성 그래프 생성**

그래프는 검증이 아니라 산출물이므로 **선택 사항**이다. graphviz가 없고 설치 권한도 없으면
건너뛰고 다음 스텝으로 진행한다 (계획 5에서 다시 시도한다).

Run: `dot -V`
- 사용 가능하면 → `pnpm arch:graph` 실행. `docs/architecture.svg`가 생성되고,
  `kernel`에서 `infrastructure`로 향하는 화살표가 **없는지** 확인한다
  (의존성은 안쪽으로만 향해야 한다).
- 사용 불가하면 → 이 스텝을 건너뛰고 보고서에 "graphviz 미설치로 arch:graph 생략"이라고 적는다.
  `sudo`로 설치를 시도하지 않는다.

- [ ] **Step 7: README 작성**

`README.md`:

```markdown
# Commerce — 헥사고날 아키텍처 학습 프로젝트

Next.js + Nest.js + TypeScript로 커머스 주문 파이프라인을 구현한다.
백엔드는 헥사고날 아키텍처(포트 & 어댑터) + DDD, 프론트는 Feature-Sliced Design을 쓰며,
양쪽의 의존성 규칙을 CI에서 강제한다.

## 시작하기

```bash
pnpm install
cp .env.example apps/api/.env
pnpm db:up          # Postgres 17 (Docker)
pnpm db:migrate
pnpm verify         # lint + 아키텍처 검증 + 타입 체크 + 테스트
```

개발 서버:

```bash
pnpm --filter @commerce/api dev    # http://localhost:3001
pnpm --filter @commerce/web dev    # http://localhost:3000
```

## 명령어

| 명령 | 설명 |
|---|---|
| `pnpm verify` | CI가 도는 전부 |
| `pnpm test:unit` | DB 없이 도는 단위 테스트 |
| `pnpm test:int` | 실제 Postgres를 쓰는 통합 테스트 |
| `pnpm arch:check` | 아키텍처 경계 규칙 검증 |
| `pnpm arch:graph` | 의존성 그래프 SVG 생성 |

## 구조

```
apps/api/       Nest — 헥사고날 (domain / application / adapters)
apps/web/       Next — FSD (shared → entities → features → widgets → views) + BFF
packages/contracts/   Zod 계약. DTO만 담으며 도메인 타입은 넣지 않는다
```

의존성 규칙은 `.dependency-cruiser.js`에 있고 `pnpm arch:check`가 강제한다.

## 문서

- 설계 스펙: `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`
- 구현 계획: `docs/superpowers/plans/`
```

- [ ] **Step 8: 전체 파이프라인 확인**

Run: `pnpm db:up && pnpm verify`
Expected: lint, arch:check, typecheck, test 전부 통과.

테스트 집계 기준:
- contracts: 10
- api-unit: 81 (Money 17 + Quantity 14 + 식별자 5 + Duration 7 + DomainError 6 +
  AggregateRoot 5 + MutableClock 6 + Sequential 5 + UuidV7 4 + Passthrough 3 +
  Recording 5 + Registry 4 — 실제 수는 구현하며 달라질 수 있으니 **실패 0건**만 확인한다)
- api-integration: 29
- web: 9

- [ ] **Step 9: 커밋**

```bash
git add .dependency-cruiser.js biome.jsonc package.json README.md
git add docs/architecture.svg 2>/dev/null || true   # graphviz가 없으면 생략됨
git commit -m "chore: 아키텍처 경계 강제와 verify 파이프라인"
```

---

## 완료 기준

이 계획이 끝났을 때 다음이 모두 참이어야 한다.

- [ ] `pnpm verify`가 통과한다
- [ ] `apps/api/src/shared/kernel/**`에 `@nestjs/*`, `@prisma/client`, `@commerce/contracts` import가 0건이고, 일부러 넣으면 Biome와 dependency-cruiser가 **둘 다** 잡는다
- [ ] 통합 테스트가 실제 PostgreSQL 17에서 돌고, 워커별 DB가 `TEMPLATE`로 복제된다
- [ ] outbox 부분 인덱스가 복제된 테스트 DB에도 존재한다
- [ ] **트랜잭션이 롤백되면 outbox 행도 사라진다** (스펙 9.8의 원자성)
- [ ] **릴레이가 이미 발행한 이벤트를 다시 보내지 않는다** (멱등성)
- [ ] 전송이 실패한 이벤트는 미발행으로 남아 다음 라운드에 재시도된다
- [ ] `MutableClock.advanceBy()`로 시간을 앞당길 수 있다 (계획 3의 TTL 테스트가 여기 의존한다)
- [ ] `GET /health`가 `{"status":"ok","database":"up"}`을 반환한다
- [ ] 도메인 예외가 HTTP 상태 코드를 담지 않고, 매핑이 레지스트리에만 존재한다
- [ ] MSW 핸들러가 `@commerce/contracts` 스키마로 응답을 검증한다
- [ ] `docs/architecture.svg`가 생성되고 순환 참조가 없다

## 다음 계획

**계획 2 — Identity + Customer**: 회원가입/로그인/세션/비밀번호 변경, 주소록 CRUD와
기본 배송지, BFF 암호화 쿠키 세션과 401 refresh 재시도.
이 계획에서 만든 `Clock`, `IdGenerator`, `TransactionManager`, `DomainEventPublisher`,
`DomainErrorRegistry`를 그대로 사용한다.
