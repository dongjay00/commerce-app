# Catalog + Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품·SKU·가격을 등록하고, 그 SKU의 재고를 예약·확정·해제·만료할 수 있게 만든다. 그리고 **재고 1개에 동시 예약 50건을 걸어도 정확히 1건만 성공한다는 것을 비관적 락과 낙관적 락 양쪽에서 증명한다.**

**Architecture:** 스펙 §6.4대로 도메인에는 락 코드가 한 줄도 없다 — `StockItem`은 `reserved ≤ onHand` 불변식만 안다. 락은 리포지토리 어댑터의 관심사이고, 그래서 포트 하나에 어댑터 셋(in-memory / 비관적 / 낙관적)이 붙어 **같은 계약 스위트와 같은 동시성 스위트**를 통과한다. 읽기-수정-쓰기 한 사이클 전체를 어댑터가 소유하기 때문에 낙관적 재시도가 어댑터 안에 갇힌다.

**Tech Stack:** Nest.js 12, Prisma 7 + PostgreSQL 17 (`SELECT ... FOR UPDATE`, 낙관적 `version` 컬럼), `@nestjs/schedule`, ts-rest + Zod 3, Vitest, Biome, dependency-cruiser

**Spec:** `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`

**선행 계획:** `docs/superpowers/plans/2026-09-02-foundation-skeleton.md`(완료), `docs/superpowers/plans/2026-09-02-identity-customer.md`(완료, `main` `38bdafb`)

---

## 이 계획의 경계 — 왜 Catalog와 Inventory에서 끊는가

스펙에 남은 컨텍스트는 넷이다: Catalog, Inventory, Payment, Ordering. Ordering의 주문 사가는 나머지 셋에 전부 의존하므로 한 계획에 담으면 30개 태스크를 넘고, 어느 한 조각이 막히면 전부가 멈춘다.

**계획 3(이 문서) = Catalog + Inventory.** 근거 세 가지.

1. **위험이 한 곳에 몰려 있다.** 두 락 어댑터를 같은 동시성 스위트로 비교하는 것은 스펙 전체에서 가장 새로운 작업이고, 이 프로젝트가 반복해서 겪은 "통과하면서 아무것도 검증하지 않는 검사"가 가장 나오기 쉬운 자리다(경합이 실제로 일어나지 않으면 초과 판매 테스트는 조용히 통과한다). 집중이 필요하다.
2. **무게가 맞는다.** 스펙 §4는 Catalog를 "의도적으로 얇게"로 분류한다. 무거운 컨텍스트 하나 + 얇은 컨텍스트 하나는 계획 2(Identity 무거움 + Customer 얇음)에서 잘 작동한 배분이다.
3. **이 조합만으로 완결되는 성공 기준이 있다.** 스펙 §13의 "재고 1개에 동시 예약 50건 → 정확히 1건 성공이 **두 락 전략 모두에서** 통과"와 "예약 TTL이 만료되면 스케줄러가 재고를 자동 회복함"은 Ordering 없이 전부 증명된다.

**계획 4 = Payment + Ordering + 사가.** Cart, Order 상태 머신, `FakePgAdapter`, 이벤트 배선, E2E.

### Ordering 없이 만들 수 없는 것 — 여기서 어디까지 하는가

Inventory의 `ConfirmReservation`/`ReleaseReservation`은 Ordering이 발행하는 `OrderPaid`/`OrderPaymentFailed`를 구독해 실행된다. 그 생산자가 아직 없다.

**유스케이스는 이 계획에서 만들고, 이벤트 구독 어댑터만 계획 4로 넘긴다.** 유스케이스는 Inventory 자신의 로직이라 지금 완전히 테스트할 수 있고, 생산자가 필요한 것은 구독 어댑터 한 파일뿐이다. `ExpireReservations`는 애초에 자기 완결적이다 — 스펙 §6.2가 "설계의 요체"라고 부른 자가치유가 그것이고, 그것만은 Ordering 없이도 끝까지 동작한다.

---

## Global Constraints

계획 1·2에서 그대로 이어지는 제약이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

### 아키텍처 경계

- **도메인 계층(`apps/api/src/modules/*/domain/**`, `apps/api/src/shared/kernel/**`)은 `vitest`를 제외한 어떤 npm 패키지도 import하지 않는다.** `@nestjs/*`, `@prisma/client`, `@commerce/contracts`, `zod` 전부 포함. 공유 커널은 상대 경로로만 닿는다.
- **애플리케이션 계층은 `adapters/**`, `@prisma/client`, `shared/infrastructure/**`, `@commerce/contracts`를 import하지 않는다.** 포트 인터페이스와 자기 모듈의 도메인만 안다.
- **모듈 간 참조는 `modules/<name>/index.ts`로만.** `shared/**`는 어느 모듈도 모른다(`shared-knows-no-modules`). 도메인은 다른 모듈을 공개 API로도 부르지 않는다(`domain-imports-no-other-module`).
- **외래 키는 애그리거트 안에만 건다.** `stock_items.sku_id`, `reservations.sku_id`, `reservations.order_id`에는 FK를 걸지 않는다 — 서로 다른 애그리거트 루트이고 생명주기가 독립적이다(스펙 §5.1). 계획 2가 `sessions.account_id`에 같은 판단을 했다.
- **도메인 예외에 HTTP 상태 코드를 넣지 않는다.** 매핑은 각 모듈의 `*-domain-error-mappings.ts`에서만 한다.
- **모든 새 `DomainError` 하위 클래스는 등록해야 한다.** 등록하지 않으면 예외가 나지 않고 **`{422, DOMAIN_RULE_VIOLATED}` 폴백으로 조용히 틀린 상태 코드가 나간다.**
- **값 객체에는 `of`(인바운드, 실패 시 `DomainError` → 4xx)와 `fromPersistence`(영속 복원, 실패 시 일반 `Error` → 500)를 나눈다.** 깨진 저장 행에 400을 돌려주면 클라이언트에게 "당신 요청이 잘못됐다"고 거짓말하는 것이다. 계획 2의 최종 리뷰가 이 규칙이 절반만 적용된 것을 잡아냈으니, 새 VO는 처음부터 양쪽을 갖춘다.

### 테스트

- **목(mock) 라이브러리를 쓰지 않는다.** `vi.mock`, `vi.spyOn`으로 포트를 대체하는 것 금지. 호출을 관찰해야 하면 기존 in-memory 대역을 spec 파일 안에서 상속한다.
- **같은 계약 스위트를 모든 구현에 돌린다.** `StockRepository`는 구현이 셋이므로 스위트 하나가 셋을 검증한다.
- **트랜잭션 롤백에 의존하는 계약 케이스는 `it.skipIf(runInTransaction === undefined)`로 in-memory에서 명시적으로 건너뛴다.** `PassthroughTransactionManager`는 롤백하지 않으므로 거기서 돌리면 항상 통과하는 무의미한 테스트가 된다. 조용히 빠뜨리지 말고 눈에 보이게 건너뛴다.
- **시간은 `Clock` 포트로만 읽는다.** TTL 만료 테스트가 15분을 실제로 기다리지 않는 유일한 이유다. Vitest fake timer 금지 — 전역을 오염시켜 Prisma의 내부 타이머와 충돌한다.
- **테스트 DB는 `TEMPLATE` 복제로 워커별 격리**하고 파일 간에는 `TRUNCATE ... RESTART IDENTITY CASCADE`로 정리한다. **테스트를 트랜잭션으로 감싸 롤백하는 방식은 절대 금지** — 같은 트랜잭션 안에서는 동시성 경합을 재현할 수 없고, 이 계획의 핵심 산출물이 바로 그 경합이다.
- **커넥션 풀은 20이어야 한다.** `apps/api/test/setup/database.ts`가 `PrismaPg`에 `max: 20`을 준다. **스펙 §9.6은 `?connection_limit=20`을 붙이라고 적었지만 그것은 틀렸다** — Prisma 7의 드라이버 어댑터 아래서 `connection_limit`은 Prisma 엔진 파라미터라 `pg` 드라이버가 무시한다. 계획 1의 최종 리뷰가 확인한 사항이다. 풀이 작으면 요청이 풀에서 직렬화되어 **경합이 발생하지 않고 동시성 테스트가 거짓 통과한다.**
- 커버리지: `modules/*/domain/**` lines 95 / branches 90, `modules/*/application/**` lines 90 / branches 85. 어댑터에는 임계값이 없다.
- **Vitest 3.2.7은 `coverage.all`이 켜져 있다.** 런타임에 로드되지 않는 파일은 0%로 집계된다. 포트 파일(타입 + `Symbol` 하나)은 `import type`으로만 쓰이면 로드되지 않으므로, 모듈마다 `application/ports/port-tokens.spec.ts`를 두어 모든 토큰을 **값으로** import한다. 계획 2가 identity·customer에 같은 파일을 두었으니 그 형태를 따른다.
- **각 태스크는 "이 검사가 무엇을 잡는지 증명하라" 스텝을 갖는다.** 절차는 항상 같다: 운영 코드를 의도적으로 한 줄 바꾼다 → 지목된 테스트가 지목된 이유로 실패하는지 확인한다 → 되돌리고 다시 통과하는지 확인한다. **예상과 다르게 나오면 그것이 발견이다** — 보고서에 적고 넘어가지 않는다. 되돌리지 않은 채 다음 스텝으로 가지 않는다.

### 도구·설치

- **설치 명령에는 반드시 버전을 고정한다.** 계획 1에서 버전 함정이 네 번 물었다.
- `zod`는 `^3.25.76`, `@ts-rest/core`는 `3.52.1`, `prisma`/`@prisma/client`/`@prisma/adapter-pg`는 `^7.10.0`에 고정돼 있다. 움직이지 않는다.
- **루트에서 `pnpm install`/`pnpm add -w`를 실행한 뒤에는 반드시 `pnpm db:generate`를 다시 돌린다.** 루트 설치가 생성된 Prisma 클라이언트를 무효화해 무관해 보이는 "모듈을 찾을 수 없음"으로 테스트가 깨진다.
- **Nest가 주입하는 클래스는 값(value) import여야 하고 `// biome-ignore lint/style/useImportType: <이유>`를 단다.** 자동 수정이 `import type`으로 바꾸면 `design:paramtypes`가 `Object`가 되어 **DI가 조용히 깨진다** — 타입체크·린트·테스트가 전부 통과하고 서버를 띄웠을 때만 드러난다.
- **`@Inject(TOKEN)` 파라미터 데코레이터를 쓰려면 `biome.jsonc`의 `javascript.parser.unsafeParameterDecoratorsEnabled`가 필요하다.** 계획 2가 이미 켜뒀다.
- **`apps/api`는 `zod`를 직접 import하지 않는다.** 계약 스키마가 필요하면 구조적 타입으로 받는다 — `ZodValidationPipe`가 쓰는 `SchemaParser<T> { parse(input: unknown): T }`가 그것이다.
- **금액은 `bigint` 최소 단위 정수**로만 다룬다. DB에는 `*_amount`(BigInt) + `*_currency`(String) 두 컬럼.

### 검증

- 태스크를 끝낼 때마다 `pnpm verify`(= `lint` → `arch:check` → `typecheck` → `build` → `test:coverage`)가 exit 0이어야 한다. `build` 단계는 `apps/web`의 `next build`까지 돈다 — **의도된 것이다.** 계획 2의 BFF 접착제 파일 세 개(라우트 핸들러 2개 + `session.ts`)에 닿는 유일한 자동 검사가 그 단계다.
- `pnpm db:up`으로 Postgres 17 컨테이너가 떠 있어야 통합 테스트가 돈다.

---

## 스펙 대비 이 계획의 보완 사항과 편차

### 보완 1 — `StockRepository`는 `find`/`save`가 아니라 `mutate`를 노출한다

스펙 §6.4는 "락은 리포지토리 어댑터의 관심사"이고 낙관적 어댑터가 "version 컬럼 + 재시도"를 한다고 적었다. 그런데 포트를 `findBySkuId` + `save`로 쪼개면 **낙관적 재시도를 어댑터 안에 가둘 수 없다.** 버전 충돌이 나면 다시 읽고 **도메인 판단을 다시 해야** 하는데, `save`만 재시도하면 낡은 데이터로 내린 결정을 그대로 다시 쓰게 된다. 재시도를 유스케이스로 올리면 이번엔 락 전략이 애플리케이션 계층으로 새어 나온다.

그래서 포트가 읽기-수정-쓰기 한 사이클을 통째로 받는다.

```ts
mutate<T>(skuId: SkuId, tx: TransactionContext, change: (stock: StockItem) => T): Promise<T>
```

비관적 어댑터는 `SELECT ... FOR UPDATE`로 잠그고 `change`를 한 번 실행한다. 낙관적 어댑터는 읽고 `change`를 실행하고 `WHERE version = <읽은 값>`으로 UPDATE한 뒤, 0행이면 **처음부터 다시** 한다. 유스케이스는 `stocks.mutate(skuId, tx, (stock) => stock.reserve(...))` 한 줄이고 어느 전략이 꽂혔는지 모른다.

### 보완 2 — 낙관적 어댑터는 재시도 횟수를 노출한다

스펙 §6.4가 README 벤치마크에 "재시도 횟수"를 싣기로 했다. 측정하려면 어댑터가 세어야 한다. `OptimisticStockRepository`에 `readonly retries: number` 카운터를 둔다. 비관적 어댑터에는 없다 — 재시도를 하지 않기 때문이고, 두 어댑터의 표면이 다른 것이 그 차이를 드러낸다.

### 편차 1 — 스펙 §9.6의 `?connection_limit=20`은 틀렸다

Prisma 7의 드라이버 어댑터 아래서 `connection_limit`은 Prisma 엔진 파라미터라 `pg` 드라이버가 무시한다. 계획 1의 최종 리뷰가 확인했고, `test/setup/database.ts`는 이미 `PrismaPg`에 `max: 20`을 준다. 이 계획은 그 코드를 따르고 스펙 문장은 따르지 않는다. **동시성 테스트 전체가 이 값에 걸려 있다** — 풀이 작으면 경합이 아예 발생하지 않는다.

### 편차 2 — 이벤트 구독 어댑터는 계획 4로 넘긴다

`inventory/adapters/in/events/`는 만들지 않는다. `OrderPaid`/`OrderPaymentFailed`/`OrderCancelled`의 생산자가 아직 없어, 지금 만들면 아무것도 구독하지 않는 배선만 남는다. 유스케이스(`ConfirmReservation`/`ReleaseReservation`)는 만들고 직접 테스트한다.

### 편차 3 — Catalog에 관리자 인증을 걸지 않는다

스펙 §5.5는 "관리자만 상품 등록 가능"을 어댑터 가드의 예로 든다. 그런데 이 프로젝트에는 역할(role) 개념이 없다 — `Principal`은 `accountId`와 `customerId`만 갖는다. 역할을 지금 만들면 Identity에 되돌아가 계정 모델을 바꿔야 하고, 그것은 이 계획의 범위 밖이다. **상품 등록·가격 변경 엔드포인트는 `AccessTokenGuard`만 걸어 인증된 사용자면 통과시키고**, 그 사실을 컨트롤러 주석에 명시한다. 역할 기반 인가는 백로그다.

### 계획 1·2가 남긴 이월 항목 중 이 계획이 처리하는 것

| 항목 | 어디서 |
|---|---|
| `OutboxRelay`에 프로덕션 호출자가 없다 (계획 1부터 이월) | 태스크 15 |
| `@nestjs/schedule`이 아직 의존성이 아니다 | 태스크 15 |
| `relayOnce()`에 `FOR UPDATE SKIP LOCKED`가 없어 인스턴스 둘이면 중복 발송 → **구독자 멱등성이 요구사항이 된다** | 태스크 15에 문서화, 멱등성은 계획 4의 구독자 책임 |
| `Money.multiply(factor: number)`가 스펙 §6.5의 `multiply(qty: Quantity)`와 다르다 | **계획 4로 이월** — 주문 라인이 처음 생기는 곳이 거기다. Catalog의 `Price`는 곱셈을 하지 않는다 |

---

### 편차 4 — `Reservation`은 `StockItem` 안이 아니라 별개의 애그리거트 루트다

스펙이 두 곳에서 서로 다른 말을 한다. §5.1의 애그리거트 표는 `StockItem`의 내부 구성으로 `Reservation[]`을 적었지만, §7.5는 `ReservationRepository`를 독립된 아웃바운드 포트로 나열하고 §10.8은 `reservations.expires_at`에 인덱스를 걸어 "만료 스케줄러가 스캔한다"고 적었다.

**둘 다 참일 수 없다.** 예약이 `StockItem` 안에만 있으면 `expires_at`으로 전역 스캔을 할 수 없다 — SKU를 하나씩 열어봐야 하고, 만료 스케줄러는 어느 SKU가 만료 대상인지 미리 모른다.

이 계획은 **리포지토리 쪽을 따른다**: `Reservation`은 자기 루트이고, `StockItem.reserved`는 같은 트랜잭션 안에서 함께 갱신되는 비정규화 카운터다. 지켜야 할 불변식(`available ≥ 0`)은 여전히 `StockItem` 하나에 있고, 그것이 락이 걸리는 지점이다.

대가: 예약 생성과 `reserved` 증가가 같은 트랜잭션에 있어야 하고, 그렇지 않으면 카운터가 진실과 어긋난다. 태스크 8이 그 원자성을 테스트로 고정한다.

---

## File Structure

### 계획 1·2 산출물 중 수정하는 것

| 파일 | 무엇을 |
|---|---|
| `apps/api/prisma/schema.prisma` | 모델 4종(`Product`, `Sku`, `StockItem`, `Reservation`) |
| `packages/contracts/src/index.ts` / `api.contract.ts` | 새 계약 2종 재수출 |
| `apps/api/src/app.module.ts` / `app.module.spec.ts` | 두 모듈 등록 + DI·매핑 검증 |
| `apps/api/src/shared/shared.module.ts` | `ScheduleModule.forRoot()` + 릴레이 스케줄러 |
| `apps/api/package.json` | `@nestjs/schedule@^12.0.1` |
| `README.md` | 락 전략 벤치마크 표 |

### modules/catalog — 스펙이 "의도적으로 얇게"라고 못박은 컨텍스트

| 파일 | 책임 |
|---|---|
| `domain/price.ts` | 가격 VO. `Money`를 감싸 0 이하를 거부한다 |
| `domain/sku.ts` | SKU 엔티티. 코드 + 가격 |
| `domain/product.ts` | Product 애그리거트 루트. SKU 목록과 상태 전이 |
| `domain/catalog.errors.ts` | |
| `application/ports/out/{product.repository,product.query}.ts` | 쓰기는 애그리거트, 조회는 DTO 직결(스펙 §7.2) |
| `application/ports/in/{register-product,update-price}.usecase.ts` + `queries/{get-product,search-products}.query.ts` | |
| `application/services/*.service.ts` | |
| `adapters/out/persistence/{prisma-product.repository,prisma-product.query,product.mapper}.ts` | |
| `adapters/in/http/{product.controller,catalog-domain-error-mappings}.ts` | |
| `testing/{in-memory-product.repository,in-memory-product.query,product-repository.contract,catalog.fixtures}.ts` | |
| `catalog.module.ts` / `index.ts` | 공개 API — Ordering이 계획 4에서 가격 ACL로 쓴다 |

### modules/inventory — 이 계획의 무게중심

| 파일 | 책임 |
|---|---|
| `domain/stock-item.ts` | **락 코드가 한 줄도 없다.** `reserved ≤ onHand` 불변식만 |
| `domain/reservation.ts` | 예약 애그리거트. TTL 만료·확정·해제 상태 전이 |
| `domain/stock.errors.ts` / `stock.events.ts` | `InsufficientStockError`, `StockReservationExpired` |
| `application/ports/out/stock.repository.ts` | **`mutate`가 읽기-수정-쓰기를 통째로 받는다** — 보완 1 참고 |
| `application/ports/out/reservation.repository.ts` | `expires_at` 스캔이 여기 있다 |
| `application/ports/in/{reserve-stock,confirm-reservation,release-reservation,expire-reservations}.usecase.ts` + `queries/get-stock.query.ts` | |
| `application/services/*.service.ts` | |
| `adapters/out/persistence/pessimistic-stock.repository.ts` | `SELECT ... FOR UPDATE`. **기본값** |
| `adapters/out/persistence/optimistic-stock.repository.ts` | `version` + 재시도. 비교군. `retries` 카운터 노출 |
| `adapters/out/persistence/{prisma-reservation.repository,stock.mapper,reservation.mapper}.ts` | |
| `adapters/in/http/{stock.controller,inventory-domain-error-mappings}.ts` | 관리자 재고 조회 |
| `adapters/in/scheduler/reservation-expiry.scheduler.ts` | TTL 자가치유 |
| `testing/{in-memory-stock.repository,in-memory-reservation.repository,stock-repository.contract,reservation-repository.contract,inventory.fixtures}.ts` | 계약 스위트가 **세 구현**에 돈다 |
| `testing/stock-concurrency.contract.ts` | 동시성 스위트. 두 Prisma 어댑터에 돈다 |
| `inventory.module.ts` / `index.ts` | |

### 공유 인프라

| 파일 | 책임 |
|---|---|
| `shared/infrastructure/outbox/outbox-relay.scheduler.ts` | 계획 1이 만든 `OutboxRelay`에 드디어 프로덕션 호출자를 준다 |

### packages/contracts

| 파일 | 책임 |
|---|---|
| `src/catalog/product.contract.ts` | 상품 등록·가격 변경·조회·검색 |
| `src/inventory/stock.contract.ts` | 재고 조회 |

---

## 태스크 목록

| # | 태스크 | 산출물 |
|---|---|---|
| 1 | Catalog 도메인 | `Price`, `Sku`, `Product`, errors |
| 2 | Catalog 애플리케이션 | 포트 4종, 유스케이스 4종, fake, 계약 스위트 |
| 3 | 영속 스키마 | 테이블 4종 + `reservations.expires_at` 인덱스 + 인덱스 감시 |
| 4 | Catalog 영속 어댑터 | Prisma 리포지토리 + 조회 + 매퍼 |
| 5 | Catalog 계약·컨트롤러·배선 | |
| 6 | Inventory 도메인 | `StockItem`(락 없음), `Reservation`, events |
| 7 | Inventory 애플리케이션 — 포트와 fake | `mutate` 포트, in-memory 3종, 계약 스위트 2종 |
| 8 | Inventory 애플리케이션 — 예약·확정·해제 | 원자성(예약 행 + `reserved` 카운터) 고정 |
| 9 | Inventory 애플리케이션 — TTL 만료 | 자가치유. 스펙 §6.2의 5단계 |
| 10 | `PrismaReservationRepository` | 매퍼 + 계약 테스트 |
| 11 | `PessimisticStockRepository` | `SELECT ... FOR UPDATE` + 계약 테스트 |
| 12 | `OptimisticStockRepository` | `version` + 재시도 + `retries` 카운터 + 계약 테스트 |
| 13 | **동시성 스위트** | 두 어댑터 × (50/1, 30/10). 초과 판매 0 |
| 14 | Inventory 계약·컨트롤러·배선 | |
| 15 | 스케줄러 2종 | 예약 만료 + Outbox 릴레이(첫 프로덕션 호출자) |
| 16 | 벤치마크와 마무리 | README 표, 완료 기준 점검 |

의존: 1 → 2 → 3 → 4 → 5, 그리고 3 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16.
태스크 3(스키마)은 Catalog와 Inventory 테이블을 한 마이그레이션에 함께 만든다 — 애그리거트 간 FK가 없으므로 순서 제약이 없고, 마이그레이션을 두 번 쪼갤 이유도 없다.

---

### Task 1: Catalog 도메인 — `Price` / `Sku` / `Product`

**Files:**
- Create: `apps/api/src/modules/catalog/domain/catalog.errors.ts`
- Create: `apps/api/src/modules/catalog/domain/price.ts` + `price.spec.ts`
- Create: `apps/api/src/modules/catalog/domain/sku.ts`
- Create: `apps/api/src/modules/catalog/domain/product.ts` + `product.spec.ts`

**Interfaces:**
- Consumes: `DomainError`(`shared/kernel/domain-error.ts`), `Money`/`Currency`/`MoneyDto`(`shared/kernel/money.ts`), `ProductId`/`SkuId`(`shared/kernel/identifiers.ts` — `.of` 인바운드, `.fromPersistence` 복원)
- Produces:
  - `Price.of(money: Money): Price`, `Price.fromPersistence(amount: bigint, currency: Currency): Price`, `price.money`, `price.equals(other)`
  - `Sku.create({ id, code, price }): Sku`, `Sku.rehydrate({ id, code, price }): Sku`, `sku.withPrice(next: Price): Sku`, `sku.id/code/price`
  - `Product.register({ id, name, skus, now }): Product`, `Product.rehydrate({ id, name, status, skus, createdAt }): Product`, `product.id/name/status/createdAt`, `product.skus: readonly Sku[]`, `product.findSku(skuId): Sku`, `product.changePrice(skuId, price): void`
  - `type ProductStatus = 'ACTIVE' | 'ARCHIVED'`
  - `InvalidPriceError`(`CODE='INVALID_PRICE'`), `InvalidProductError`(`CODE='INVALID_PRODUCT'`), `DuplicateSkuCodeError`(`CODE='DUPLICATE_SKU_CODE'`), `SkuNotFoundError`(`CODE='SKU_NOT_FOUND'`), `CorruptedPriceError`/`CorruptedProductError`(일반 `Error`)

**설계 결정 — 상태 전이 메서드를 만들지 않는다.** 스펙 §10.8이 `products.status` 컬럼을 요구하고 §7.6의 인바운드 목록에는 `RegisterProduct`/`UpdatePrice`/조회 둘뿐이다. 상태를 바꾸는 유스케이스가 없으므로 `activate()`/`archive()`도 만들지 않는다 — 호출자 없는 메서드는 죽은 코드다. `register`는 `'ACTIVE'`로 만들고, `rehydrate`는 저장된 값을 그대로 복원한다. `'ARCHIVED'` 값은 검색 필터가 실제로 걸러내는지 확인하는 데 쓰이며(태스크 4), 그 상태의 상품은 `rehydrate`로만 만들어진다. 전이 유스케이스는 백로그다.

**설계 결정 — `Sku`는 불변이다.** `withPrice`가 새 인스턴스를 돌려주고 `Product`가 목록의 자리를 교체한다. 계획 2가 `SavedAddress`에서 배운 것이다: 내부 엔티티에 public 변경 메서드를 두면 애그리거트 밖에서 불변식을 깰 수 있고, 주석은 그것을 막지 못한다.

- [ ] **Step 1: `Price`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/catalog/domain/price.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Money } from '../../../shared/kernel/money';
import { CorruptedPriceError, InvalidPriceError } from './catalog.errors';
import { Price } from './price';

const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

describe('Price.of', () => {
  it('양수 금액으로 가격을 만든다', () => {
    expect(Price.of(Money.of(1500n)).money.amount).toBe(1500n);
  });

  it('통화를 보존한다', () => {
    expect(Price.of(Money.of(1500n, 'USD')).money.currency).toBe('USD');
  });

  it('0원을 거부한다', () => {
    // Money는 0을 허용해야 한다(환불 계산의 중간값). 가격은 다르다 —
    // 0원짜리 판매 상품은 재고와 결제 경로 전체에서 의미가 무너진다.
    expect(() => Price.of(Money.of(0n))).toThrow(InvalidPriceError);
  });

  it('음수를 거부한다', () => {
    expect(() => Price.of(Money.of(-1n))).toThrow(InvalidPriceError);
  });

  it('실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => Price.of(Money.of(0n))).toThrow(DomainErrorConstructor);
  });
});

describe('Price.fromPersistence', () => {
  it('저장된 값을 복원한다', () => {
    const price = Price.fromPersistence(1500n, 'KRW');
    expect(price.money.amount).toBe(1500n);
    expect(price.money.currency).toBe('KRW');
  });

  it('깨진 저장 값의 실패는 DomainError가 아니다', () => {
    // 저장된 가격이 0이면 우리 데이터가 깨진 것이지 요청이 잘못된 게 아니다.
    // DomainError면 예외 필터가 400을 내보내 클라이언트에게 거짓을 말한다.
    expect(() => Price.fromPersistence(0n, 'KRW')).toThrow(CorruptedPriceError);
    expect(() => Price.fromPersistence(0n, 'KRW')).not.toThrow(DomainErrorConstructor);
  });
});

describe('Price.equals', () => {
  it('금액과 통화가 같으면 참이다', () => {
    expect(Price.of(Money.of(100n)).equals(Price.of(Money.of(100n)))).toBe(true);
  });

  it('통화가 다르면 거짓이다', () => {
    expect(Price.of(Money.of(100n, 'KRW')).equals(Price.of(Money.of(100n, 'USD')))).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/catalog/domain/price.spec.ts`
Expected: FAIL — `price.ts` / `catalog.errors.ts`가 없다.

- [ ] **Step 3: `catalog.errors.ts`를 만든다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 가격이 0 이하다. `Money`는 0과 음수를 허용해야 한다 — 환불 계산의 중간값이 그렇다.
 * 판매 가격은 다르다: 0원짜리 상품은 재고·결제 경로 전체에서 의미가 무너진다.
 * 그 차이가 `Price`가 `Money` 위에 존재하는 유일한 이유다.
 */
export class InvalidPriceError extends DomainError {
  static readonly CODE = 'INVALID_PRICE';
  readonly code = InvalidPriceError.CODE;

  constructor(amount: bigint) {
    super(`가격은 0보다 커야 합니다: ${amount}`);
  }
}

/** 상품 이름이 비어 있다. */
export class InvalidProductError extends DomainError {
  static readonly CODE = 'INVALID_PRODUCT';
  readonly code = InvalidProductError.CODE;

  constructor(reason: string) {
    super(`상품을 만들 수 없습니다: ${reason}`);
  }
}

/**
 * 한 상품 안에 같은 SKU 코드가 둘이다. 코드는 사람이 읽고 입력하는 식별자라
 * 중복되면 "어느 쪽 가격인가"를 아무도 답할 수 없다.
 */
export class DuplicateSkuCodeError extends DomainError {
  static readonly CODE = 'DUPLICATE_SKU_CODE';
  readonly code = DuplicateSkuCodeError.CODE;

  constructor(code: string) {
    super(`SKU 코드가 중복됩니다: ${code}`);
  }
}

/**
 * 그 상품에 없는 SKU다. 다른 상품의 SKU ID를 넣었을 때도 이것이 난다 —
 * 404로 답해 "그 ID는 존재하지만 이 상품 것이 아니다"를 흘리지 않는다.
 * 계획 2의 `AddressNotFoundError`와 같은 판단이다.
 */
export class SkuNotFoundError extends DomainError {
  static readonly CODE = 'SKU_NOT_FOUND';
  readonly code = SkuNotFoundError.CODE;

  constructor(skuId: string) {
    super(`SKU를 찾을 수 없습니다: ${skuId}`);
  }
}

/**
 * 저장된 가격이 0 이하다. 정상 경로로는 불가능하다 — `Price.of`가 막기 때문이다.
 * 도달했다면 데이터가 손상된 것이고 사용자가 고칠 수 없으므로 `DomainError`가 아니다.
 */
export class CorruptedPriceError extends Error {
  constructor(amount: bigint) {
    super(`저장된 가격이 0 이하입니다: ${amount}`);
    this.name = 'CorruptedPriceError';
  }
}

/** 저장된 상품 행이 불변식을 어긴 상태다(SKU 없음, 코드 중복 등). */
export class CorruptedProductError extends Error {
  constructor(productId: string, reason: string) {
    super(`저장된 상품 ${productId}이(가) 손상되었습니다: ${reason}`);
    this.name = 'CorruptedProductError';
  }
}
```

- [ ] **Step 4: `price.ts`를 구현한다**

```ts
import type { Currency } from '../../../shared/kernel/money';
import { Money } from '../../../shared/kernel/money';
import { CorruptedPriceError, InvalidPriceError } from './catalog.errors';

/**
 * 판매 가격 값 객체.
 *
 * `Money`를 그대로 쓰지 않는 이유는 하나뿐이다: **판매 가격은 0보다 커야 한다.**
 * `Money`는 0과 음수를 허용해야 하고(환불·차감의 중간값), 그 관대함이 상품 가격에
 * 그대로 흘러들면 0원 상품이 재고와 결제 경로를 통과한다.
 */
export class Price {
  private constructor(readonly money: Money) {}

  /** 인바운드 경로. 실패는 사용자 입력 오류(400). */
  static of(money: Money): Price {
    if (money.amount <= 0n) {
      throw new InvalidPriceError(money.amount);
    }
    return new Price(money);
  }

  /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
  static fromPersistence(amount: bigint, currency: Currency): Price {
    if (amount <= 0n) {
      throw new CorruptedPriceError(amount);
    }
    return new Price(Money.of(amount, currency));
  }

  equals(other: Price): boolean {
    return this.money.equals(other.money);
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/catalog/domain/price.spec.ts`
Expected: PASS (9개)

- [ ] **Step 6: `sku.ts`를 구현한다**

`Sku`에는 전용 spec 파일을 두지 않는다 — 모든 동작이 `product.spec.ts`에서 애그리거트를 통해 실행되고, 엔티티 단독으로는 지킬 불변식이 없다(코드 유일성은 목록을 봐야 알 수 있어 `Product`의 몫이다).

```ts
import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Price } from './price';

/**
 * SKU 엔티티. **불변이다** — `withPrice`가 새 인스턴스를 돌려주고 `Product`가
 * 목록의 자리를 교체한다.
 *
 * 계획 2가 `SavedAddress`에서 배운 것을 처음부터 적용한다: 내부 엔티티에 public
 * 변경 메서드를 두면 애그리거트 밖에서 목록을 얻어 불변식을 깰 수 있고, "이건
 * 애그리거트만 부르세요"라는 주석은 그것을 막지 못한다. 타입 시스템이 막게 한다.
 */
export class Sku {
  private constructor(
    readonly id: SkuId,
    readonly code: string,
    readonly price: Price,
  ) {}

  static create(params: { id: SkuId; code: string; price: Price }): Sku {
    return new Sku(params.id, params.code, params.price);
  }

  static rehydrate(params: { id: SkuId; code: string; price: Price }): Sku {
    return new Sku(params.id, params.code, params.price);
  }

  withPrice(next: Price): Sku {
    return new Sku(this.id, this.code, next);
  }
}
```

- [ ] **Step 7: `Product`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/catalog/domain/product.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import {
  CorruptedProductError,
  DuplicateSkuCodeError,
  InvalidProductError,
  SkuNotFoundError,
} from './catalog.errors';
import { Price } from './price';
import { Product } from './product';
import { Sku } from './sku';

const PRODUCT_ID = ProductId.of('018f2b1c-4a5d-7e6f-8a9b-0c1da0000001');
const SKU_A = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const SKU_B = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000002');
const MISSING_SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c009999');
const NOW = new Date('2026-03-01T10:00:00.000Z');

function sku(id = SKU_A, code = 'RED-M', amount = 1000n): Sku {
  return Sku.create({ id, code, price: Price.of(Money.of(amount)) });
}

describe('Product.register', () => {
  it('상품과 SKU 목록을 만든다', () => {
    const product = Product.register({
      id: PRODUCT_ID,
      name: '티셔츠',
      skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
      now: NOW,
    });
    expect(product.name).toBe('티셔츠');
    expect(product.skus.map((s) => s.code)).toEqual(['RED-M', 'RED-L']);
  });

  it('ACTIVE 상태로 만들어진다', () => {
    // 상태를 바꾸는 유스케이스가 없으므로(스펙 §7.6) 등록 즉시 판매 가능해야 한다.
    expect(Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [sku()], now: NOW }).status).toBe(
      'ACTIVE',
    );
  });

  it('생성 시각을 주입된 값으로 쓴다 — new Date()를 부르지 않는다', () => {
    expect(
      Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [sku()], now: NOW }).createdAt,
    ).toEqual(NOW);
  });

  it('이름의 앞뒤 공백을 제거한다', () => {
    expect(
      Product.register({ id: PRODUCT_ID, name: '  티셔츠  ', skus: [sku()], now: NOW }).name,
    ).toBe('티셔츠');
  });

  it('빈 이름을 거부한다', () => {
    expect(() =>
      Product.register({ id: PRODUCT_ID, name: '   ', skus: [sku()], now: NOW }),
    ).toThrow(InvalidProductError);
  });

  it('SKU가 하나도 없으면 거부한다', () => {
    // SKU 없는 상품은 살 수 없다. 재고도 가격도 SKU에 붙는다.
    expect(() => Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [], now: NOW })).toThrow(
      InvalidProductError,
    );
  });

  it('SKU 코드가 중복되면 거부한다', () => {
    expect(() =>
      Product.register({
        id: PRODUCT_ID,
        name: '티셔츠',
        skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-M')],
        now: NOW,
      }),
    ).toThrow(DuplicateSkuCodeError);
  });

  it('SKU 목록을 복사한다 — 원본 배열을 나중에 바꿔도 상품은 안 바뀐다', () => {
    const skus = [sku()];
    const product = Product.register({ id: PRODUCT_ID, name: '티셔츠', skus, now: NOW });
    skus.push(sku(SKU_B, 'RED-L'));
    expect(product.skus).toHaveLength(1);
  });
});

describe('Product.findSku', () => {
  const product = Product.register({
    id: PRODUCT_ID,
    name: '티셔츠',
    skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
    now: NOW,
  });

  it('ID로 SKU를 찾는다', () => {
    expect(product.findSku(SKU_B).code).toBe('RED-L');
  });

  it('없는 SKU면 SkuNotFoundError다', () => {
    expect(() => product.findSku(MISSING_SKU)).toThrow(SkuNotFoundError);
  });
});

describe('Product.changePrice', () => {
  function aProduct(): Product {
    return Product.register({
      id: PRODUCT_ID,
      name: '티셔츠',
      skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
      now: NOW,
    });
  }

  it('지정한 SKU의 가격만 바꾼다', () => {
    const product = aProduct();
    product.changePrice(SKU_A, Price.of(Money.of(1800n)));

    expect(product.findSku(SKU_A).price.money.amount).toBe(1800n);
    expect(product.findSku(SKU_B).price.money.amount).toBe(1200n);
  });

  it('SKU의 코드와 ID는 그대로다', () => {
    const product = aProduct();
    product.changePrice(SKU_A, Price.of(Money.of(1800n)));
    expect(product.findSku(SKU_A).code).toBe('RED-M');
  });

  it('없는 SKU면 SkuNotFoundError이고 다른 가격은 그대로다', () => {
    const product = aProduct();
    expect(() => product.changePrice(MISSING_SKU, Price.of(Money.of(1800n)))).toThrow(
      SkuNotFoundError,
    );
    expect(product.findSku(SKU_A).price.money.amount).toBe(1000n);
  });
});

describe('Product.rehydrate', () => {
  it('저장된 상태를 그대로 복원한다', () => {
    const product = Product.rehydrate({
      id: PRODUCT_ID,
      name: '티셔츠',
      status: 'ARCHIVED',
      skus: [Sku.rehydrate({ id: SKU_A, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') })],
      createdAt: NOW,
    });
    expect(product.status).toBe('ARCHIVED');
    expect(product.skus).toHaveLength(1);
  });

  it('SKU가 없는 저장 행은 CorruptedProductError다 — DomainError가 아니다', () => {
    // 정상 경로로는 불가능하다(register가 막는다). 도달했다면 데이터가 깨진 것이므로 500이다.
    expect(() =>
      Product.rehydrate({
        id: PRODUCT_ID,
        name: '티셔츠',
        status: 'ACTIVE',
        skus: [],
        createdAt: NOW,
      }),
    ).toThrow(CorruptedProductError);
  });

  it('코드가 중복된 저장 행도 CorruptedProductError다', () => {
    expect(() =>
      Product.rehydrate({
        id: PRODUCT_ID,
        name: '티셔츠',
        status: 'ACTIVE',
        skus: [
          Sku.rehydrate({ id: SKU_A, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') }),
          Sku.rehydrate({ id: SKU_B, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') }),
        ],
        createdAt: NOW,
      }),
    ).toThrow(CorruptedProductError);
  });
});
```

> **UUID 리터럴은 반드시 유효한 16진수여야 한다.** `SkuId.of` 등이 `/^[0-9a-f]{8}-...$/i`로 검증하므로 `cust`나 `prod` 같은 읽기 좋은 접두사를 넣으면 즉시 던진다 — 계획 2에서 브리프의 리터럴에 `cust`/`acct`가 들어가 태스크가 한 번 막혔다. 구분이 필요하면 `a`, `c`, `5c`(sku), `5e`(reservation)처럼 16진수 안에서 고른다.

- [ ] **Step 8: `product.ts`를 구현한다**

```ts
import type { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import {
  CorruptedProductError,
  DuplicateSkuCodeError,
  InvalidProductError,
  SkuNotFoundError,
} from './catalog.errors';
import type { Price } from './price';
import type { Sku } from './sku';

/**
 * 상태 전이 메서드를 두지 않는다 — 스펙 §7.6의 인바운드 목록에 상태를 바꾸는
 * 유스케이스가 없다. `'ARCHIVED'`는 `rehydrate`로만 만들어지고, 검색이 그 값을
 * 걸러내는지 확인하는 데 쓰인다.
 */
export type ProductStatus = 'ACTIVE' | 'ARCHIVED';

function assertSkuInvariants(skus: readonly Sku[], onViolation: (reason: string) => never): void {
  if (skus.length === 0) {
    onViolation('SKU가 하나도 없습니다');
  }
  const codes = new Set<string>();
  for (const sku of skus) {
    if (codes.has(sku.code)) {
      onViolation(`SKU 코드가 중복됩니다: ${sku.code}`);
    }
    codes.add(sku.code);
  }
}

/**
 * 상품 애그리거트 루트.
 *
 * `AggregateRoot`를 상속하지 않는다 — 스펙 §5.6의 이벤트 목록에 catalog가 발행하는
 * 이벤트가 없다. 상속만 해두면 리포지토리가 매번 빈 `pullEvents()`를 부르는 죽은
 * 배관이 남는다. 계획 2의 `Customer`와 같은 판단이다.
 */
export class Product {
  private constructor(
    readonly id: ProductId,
    readonly name: string,
    readonly status: ProductStatus,
    private readonly items: Sku[],
    readonly createdAt: Date,
  ) {}

  static register(params: {
    id: ProductId;
    name: string;
    skus: Sku[];
    now: Date;
  }): Product {
    const name = params.name.trim();
    if (name.length === 0) {
      throw new InvalidProductError('이름이 비어 있습니다');
    }
    // 인바운드 경로의 위반은 사용자가 고칠 수 있으므로 DomainError로 던진다.
    assertSkuInvariants(params.skus, (reason) => {
      if (reason.startsWith('SKU 코드가 중복됩니다')) {
        throw new DuplicateSkuCodeError(reason.split(': ')[1] ?? '');
      }
      throw new InvalidProductError(reason);
    });
    // 배열을 복사한다. 호출자가 나중에 push해도 상품이 따라 바뀌면 안 된다.
    return new Product(params.id, name, 'ACTIVE', [...params.skus], params.now);
  }

  static rehydrate(params: {
    id: ProductId;
    name: string;
    status: ProductStatus;
    skus: Sku[];
    createdAt: Date;
  }): Product {
    // 복원 경로의 위반은 데이터 손상이므로 DomainError가 아니다 — 500이 정직하다.
    assertSkuInvariants(params.skus, (reason) => {
      throw new CorruptedProductError(params.id, reason);
    });
    return new Product(params.id, params.name, params.status, [...params.skus], params.createdAt);
  }

  get skus(): readonly Sku[] {
    return this.items;
  }

  findSku(skuId: SkuId): Sku {
    const found = this.items.find((sku) => sku.id === skuId);
    if (found === undefined) {
      throw new SkuNotFoundError(skuId);
    }
    return found;
  }

  /** `Sku`가 불변이므로 목록의 자리를 새 인스턴스로 교체한다. */
  changePrice(skuId: SkuId, price: Price): void {
    const current = this.findSku(skuId);
    this.items[this.items.indexOf(current)] = current.withPrice(price);
  }
}
```

- [ ] **Step 9: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/catalog/domain/`
Expected: PASS

- [ ] **Step 10: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다. 하나씩 하고 매번 되돌린다.

**(a) 인바운드와 복원의 실패 분류가 실제로 갈리는가**
`price.ts`의 `fromPersistence`에서 `throw new CorruptedPriceError(amount)`를 `throw new InvalidPriceError(amount)`로 바꾼다.
Expected: FAIL — `'깨진 저장 값의 실패는 DomainError가 아니다'`가 실패한다. 이 회귀는 **깨진 저장 행에 400을 돌려주는** 것이고, 계획 2의 최종 리뷰가 매퍼에서 잡아낸 것과 같은 종류다.
되돌린다.

**(b) SKU 목록 복사가 실제로 일어나는가**
`product.ts`의 `register`에서 `[...params.skus]`를 `params.skus`로 바꾼다.
Expected: FAIL — `'SKU 목록을 복사한다'`가 실패한다.
되돌린다.

**(c) `changePrice`가 다른 SKU를 건드리지 않는가**
`changePrice`의 마지막 줄을 `this.items.forEach((_, i) => { this.items[i] = this.items[i].withPrice(price); });`로 바꾼다(전부 바꾼다).
Expected: FAIL — `'지정한 SKU의 가격만 바꾼다'`가 `SKU_B`의 가격이 1200이 아니라며 실패한다. **다른 두 테스트는 통과한다는 것도 확인할 것** — 대상 SKU만 보는 단언이었다면 이 버그는 통과했다.
되돌린다.

- [ ] **Step 11: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`와 `lint`가 새 도메인 디렉터리에 순수성 규칙을 적용한다.

```bash
git add apps/api/src/modules/catalog/domain
git commit -m "feat(catalog): Price·Sku·Product 도메인 모델을 추가한다"
```

---

### Task 2: Catalog 애플리케이션 — 포트, 유스케이스, fake

**Files:**
- Modify: `apps/api/src/modules/catalog/domain/catalog.errors.ts` (`ProductNotFoundError` 추가)
- Create: `apps/api/src/modules/catalog/application/ports/out/product.repository.ts`
- Create: `apps/api/src/modules/catalog/application/ports/out/product.query.ts`
- Create: `apps/api/src/modules/catalog/application/ports/in/register-product.usecase.ts`
- Create: `apps/api/src/modules/catalog/application/ports/in/update-price.usecase.ts`
- Create: `apps/api/src/modules/catalog/application/ports/in/queries/get-product.query.ts`
- Create: `apps/api/src/modules/catalog/application/ports/in/queries/search-products.query.ts`
- Create: `apps/api/src/modules/catalog/application/ports/port-tokens.spec.ts`
- Create: `apps/api/src/modules/catalog/application/services/register-product.service.ts` + spec
- Create: `apps/api/src/modules/catalog/application/services/update-price.service.ts` + spec
- Create: `apps/api/src/modules/catalog/application/services/get-product.service.ts` + spec
- Create: `apps/api/src/modules/catalog/application/services/search-products.service.ts` + spec
- Create: `apps/api/src/modules/catalog/testing/{in-memory-product.repository.ts, in-memory-product.query.ts, product-repository.contract.ts, in-memory-product.repository.spec.ts, catalog.fixtures.ts}`

**Interfaces:**
- Consumes: 태스크 1의 도메인, `Clock`/`IdGenerator`/`TransactionManager`(`shared/kernel/ports/`), `MoneyDto`/`Money`(`shared/kernel/money.ts`), `MutableClock`/`SequentialIdGenerator`/`PassthroughTransactionManager`(`shared/testing/`)
- Produces:
  - `ProductRepository { findById(id, tx?); save(product, tx?) }`, `PRODUCT_REPOSITORY`
  - `ProductQuery { findById(productId): Promise<ProductView | null>; search(criteria): Promise<ProductView[]> }`, `PRODUCT_QUERY`
  - `ProductView { id: string; name: string; status: string; skus: SkuView[] }`, `SkuView { id: string; code: string; amount: string; currency: string }`
  - `SearchCriteria { keyword?: string; limit: number; offset: number }`
  - `RegisterProductUseCase { execute(command): Promise<{ productId: string }> }`, `REGISTER_PRODUCT_USECASE`
  - `UpdatePriceUseCase { execute(command): Promise<void> }`, `UPDATE_PRICE_USECASE`
  - `GetProductQuery { execute({ productId }): Promise<ProductView> }`, `GET_PRODUCT_QUERY`
  - `SearchProductsQuery { execute(criteria): Promise<ProductView[]> }`, `SEARCH_PRODUCTS_QUERY`
  - `ProductNotFoundError`(`CODE='PRODUCT_NOT_FOUND'`)
  - 생성자: `RegisterProductService(products, transactions, clock, ids)`, `UpdatePriceService(products, transactions)`, `GetProductService(query)`, `SearchProductsService(query)`

**설계 결정 — `ProductView`는 애플리케이션의 읽기 모델이고 계약의 DTO가 아니다.** 계획 2가 `AddressView`에서 정한 것과 같다: `@commerce/contracts`를 애플리케이션이 import하면 와이어 계약이 바뀔 때마다 유스케이스가 깨진다. 컨트롤러가 옮긴다.

**설계 결정 — Ordering이 쓸 `findSkuPrices`는 지금 만들지 않는다.** 스펙 §7.4의 `CatalogPriceProvider` ACL이 그것을 부를 예정이지만 호출자가 없는 조회 메서드는 YAGNI다. 계획 4가 Ordering을 만들 때 catalog를 다시 열어 한 메서드를 더한다.

- [ ] **Step 1: 아웃바운드 포트 두 개를 만든다**

`product.repository.ts`:

```ts
import type { ProductId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Product } from '../../../domain/product';

/**
 * 쓰기 전용 포트 — 애그리거트를 반환한다(스펙 §7.2).
 * `save`는 SKU 목록까지 함께 저장한다. `Sku`는 애그리거트 안이라 따로 저장할 방법이
 * 없어야 하고, 어댑터는 애그리거트에서 사라진 SKU 행을 지우는 것까지 책임진다.
 */
export interface ProductRepository {
  findById(id: ProductId, tx?: TransactionContext): Promise<Product | null>;
  save(product: Product, tx?: TransactionContext): Promise<void>;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
```

`product.query.ts`:

```ts
import type { ProductId } from '../../../../../shared/kernel/identifiers';

export interface SkuView {
  readonly id: string;
  readonly code: string;
  readonly amount: string;
  readonly currency: string;
}

/**
 * 읽기 전용 모델. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다(스펙 §7.2).
 * `@commerce/contracts`의 DTO를 쓰지 않는 이유는 애플리케이션 계층이 와이어 계약에
 * 묶이지 않기 위해서다 — 컨트롤러가 옮긴다.
 */
export interface ProductView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly skus: SkuView[];
}

export interface SearchCriteria {
  readonly keyword?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ProductQuery {
  findById(productId: ProductId): Promise<ProductView | null>;
  /** ACTIVE 상품만 돌려준다. 정렬은 이름 오름차순으로 고정한다. */
  search(criteria: SearchCriteria): Promise<ProductView[]>;
}

export const PRODUCT_QUERY = Symbol('ProductQuery');
```

- [ ] **Step 2: 인바운드 포트 네 개를 만든다**

`register-product.usecase.ts`:

```ts
import type { MoneyDto } from '../../../../../shared/kernel/money';

export interface RegisterProductCommand {
  readonly name: string;
  readonly skus: ReadonlyArray<{ readonly code: string; readonly price: MoneyDto }>;
}

export interface RegisterProductUseCase {
  execute(command: RegisterProductCommand): Promise<{ productId: string }>;
}

export const REGISTER_PRODUCT_USECASE = Symbol('RegisterProductUseCase');
```

`update-price.usecase.ts`:

```ts
import type { MoneyDto } from '../../../../../shared/kernel/money';

export interface UpdatePriceCommand {
  readonly productId: string;
  readonly skuId: string;
  readonly price: MoneyDto;
}

export interface UpdatePriceUseCase {
  execute(command: UpdatePriceCommand): Promise<void>;
}

export const UPDATE_PRICE_USECASE = Symbol('UpdatePriceUseCase');
```

`queries/get-product.query.ts`:

```ts
import type { ProductView } from '../../out/product.query';

export interface GetProductQuery {
  /** 없으면 `ProductNotFoundError`를 던진다 — null을 흘리지 않는다. */
  execute(command: { readonly productId: string }): Promise<ProductView>;
}

export const GET_PRODUCT_QUERY = Symbol('GetProductQuery');
```

`queries/search-products.query.ts`:

```ts
import type { ProductView, SearchCriteria } from '../../out/product.query';

export interface SearchProductsQuery {
  execute(criteria: SearchCriteria): Promise<ProductView[]>;
}

export const SEARCH_PRODUCTS_QUERY = Symbol('SearchProductsQuery');
```

- [ ] **Step 3: `port-tokens.spec.ts`를 만든다**

`apps/api/src/modules/identity/application/ports/port-tokens.spec.ts`를 읽고 그 형태를 그대로 따른다. 여섯 토큰(`PRODUCT_REPOSITORY`, `PRODUCT_QUERY`, `REGISTER_PRODUCT_USECASE`, `UPDATE_PRICE_USECASE`, `GET_PRODUCT_QUERY`, `SEARCH_PRODUCTS_QUERY`)을 **값으로** import해 (1) `symbol`인지 (2) `.description`이 포트 이름과 정확히 일치하는지 (3) 서로 구별되는지 확인한다.

설명 문자열 단언이 핵심이다. Nest는 심볼 동일성으로 해석하므로 `session.repository.ts`에 `Symbol('AccountRepository')`가 복붙돼도 배선은 정상 동작하지만, 모든 DI 실패 메시지가 엉뚱한 포트 이름을 대게 된다 — 한 시간을 태우고 아무 흔적도 남기지 않는 종류의 함정이다.

이 파일이 필요한 두 번째 이유는 커버리지다. Vitest 3.2.7은 `coverage.all`이 켜져 있어 런타임에 로드되지 않는 파일이 0%로 잡히는데, 포트 파일은 `import type`으로만 쓰이면 로드되지 않는다.

- [ ] **Step 4: 계약 스위트와 fake를 쓴다**

`product-repository.contract.ts`는 아래를 확인한다. 각 항목에 왜 필요한지 주석을 남긴다.

```ts
import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { ProductRepository } from '../application/ports/out/product.repository';
import { Price } from '../domain/price';
import { Product } from '../domain/product';
import { Sku } from '../domain/sku';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function aProduct(suffix: string, skuCount = 2): Product {
  const skus = Array.from({ length: skuCount }, (_, index) =>
    Sku.create({
      id: SkuId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d5c${suffix}${index}`),
      code: `CODE-${index}`,
      price: Price.of(Money.of(BigInt(1000 + index * 100))),
    }),
  );
  return Product.register({
    id: ProductId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1da0${suffix}0`),
    name: `상품-${suffix}`,
    skus,
    now: NOW,
  });
}

export function productRepositoryContract(
  name: string,
  createRepo: () => Promise<ProductRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  describe(`ProductRepository 계약 — ${name}`, () => {
    it('저장한 상품을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0001');
      await repo.save(product);
      expect((await repo.findById(product.id))?.name).toBe('상품-0001');
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(ProductId.of('018f2b1c-4a5d-7e6f-8a9b-0c1da0999900'))).toBeNull();
    });

    it('SKU 목록이 애그리거트와 함께 저장되고 복원된다', async () => {
      const repo = await createRepo();
      const product = aProduct('0002');
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.skus.map((s) => s.code)).toEqual(['CODE-0', 'CODE-1']);
    });

    it('가격의 금액과 통화가 왕복해도 보존된다', async () => {
      // 금액 버그는 커머스에서 가장 비싼 버그다(스펙 §6.5). bigint가 문자열이나
      // number를 거쳐 돌아오면 큰 값에서 조용히 정밀도를 잃는다.
      const repo = await createRepo();
      const product = Product.register({
        id: ProductId.of('018f2b1c-4a5d-7e6f-8a9b-0c1da0000300'),
        name: '고가 상품',
        skus: [
          Sku.create({
            id: SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000300'),
            code: 'BIG',
            price: Price.of(Money.of(9007199254740993n)), // Number.MAX_SAFE_INTEGER + 2
          }),
        ],
        now: NOW,
      });
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.skus[0]?.price.money.amount).toBe(9007199254740993n);
      expect(loaded?.skus[0]?.price.money.currency).toBe('KRW');
    });

    it('생성 시각과 상태가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const product = aProduct('0004');
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.createdAt).toEqual(NOW);
      expect(loaded?.status).toBe('ACTIVE');
    });

    it('가격을 바꿔 다시 저장하면 갱신된다 — 행이 늘지 않는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0005');
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      loaded?.changePrice(loaded.skus[0]!.id, Price.of(Money.of(7777n)));
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(product.id);
      expect(reloaded?.skus).toHaveLength(2);
      expect(reloaded?.findSku(product.skus[0]!.id).price.money.amount).toBe(7777n);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0006');
      await repo.save(product);

      product.changePrice(product.skus[0]!.id, Price.of(Money.of(1n)));

      const loaded = await repo.findById(product.id);
      expect(loaded?.findSku(product.skus[0]!.id).price.money.amount).toBe(1000n);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 저장한 상품이 남지 않는다',
      async () => {
        // in-memory에서는 건너뛴다 — PassthroughTransactionManager는 롤백하지 않으므로
        // 여기서 돌리면 항상 통과하는 무의미한 테스트가 된다. 조용히 빠뜨리지 않고
        // 눈에 보이게 건너뛰는 것이 요점이다.
        const runner = runInTransaction;
        if (!runner) return;
        const repo = await createRepo();
        const product = aProduct('0007');

        await expect(
          runner(async (tx) => {
            await repo.save(product, tx);
            throw new Error('의도적 롤백');
          }),
        ).rejects.toThrow('의도적 롤백');

        expect(await repo.findById(product.id)).toBeNull();
      },
    );
  });
}
```

`in-memory-product.repository.ts`는 `Product.rehydrate`로 깊은 복사를 한다 — `Sku`가 불변이라 인스턴스는 공유해도 되지만, **배열과 `Product` 인스턴스는 새로 만들어야** 저장 후 원본 변경이 새어 들어오지 않는다.

`in-memory-product.query.ts`는 리포지토리를 감싸 `ProductView`로 옮기고, `search`는 `status === 'ACTIVE'`만 남기고 이름 오름차순으로 정렬한 뒤 `offset`/`limit`을 적용한다.

`in-memory-product.repository.spec.ts`:

```ts
import { productRepositoryContract } from './product-repository.contract';
import { InMemoryProductRepository } from './in-memory-product.repository';

productRepositoryContract('in-memory', async () => new InMemoryProductRepository());
```

- [ ] **Step 5: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/catalog/`
Expected: FAIL — fake 클래스들이 없다.

- [ ] **Step 6: fake를 구현하고 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/catalog/`
Expected: PASS — 계약 7개 통과 + 롤백 1개 스킵.

- [ ] **Step 7: 유스케이스 네 개를 구현한다**

`register-product.service.ts`:

```ts
import { ProductId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Price } from '../../domain/price';
import { Product } from '../../domain/product';
import { Sku } from '../../domain/sku';
import type { ProductRepository } from '../ports/out/product.repository';
import type {
  RegisterProductCommand,
  RegisterProductUseCase,
} from '../ports/in/register-product.usecase';

export class RegisterProductService implements RegisterProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: RegisterProductCommand): Promise<{ productId: string }> {
    // 값 객체 생성이 트랜잭션 밖이다 — 성공할 수 없는 요청 때문에 트랜잭션을 열지 않는다.
    const skus = command.skus.map((input) =>
      Sku.create({
        id: SkuId.of(this.ids.nextId()),
        code: input.code,
        price: Price.of(Money.fromDto(input.price)),
      }),
    );
    const product = Product.register({
      id: ProductId.of(this.ids.nextId()),
      name: command.name,
      skus,
      now: this.clock.now(),
    });

    await this.transactions.run(async (tx) => {
      await this.products.save(product, tx);
    });

    return { productId: product.id };
  }
}
```

`update-price.service.ts`는 불러오기 → `changePrice` → 저장을 한 트랜잭션으로 묶고, 없는 상품이면 `ProductNotFoundError`를 던진다. `ProductNotFoundError`는 `catalog.errors.ts`에 추가한다(`CODE='PRODUCT_NOT_FOUND'`, 404).

`get-product.service.ts`는 조회 포트에 위임하고 `null`이면 `ProductNotFoundError`를 던진다. `search-products.service.ts`는 그대로 위임한다.

- [ ] **Step 8: 유스케이스 spec을 쓴다**

계획 2의 `apps/api/src/modules/identity/application/services/*.spec.ts` 형태를 따른다 — fake를 조립하는 `build()` 헬퍼, 시나리오별 `it`. 각 서비스마다 아래를 덮는다.

`register-product.service.spec.ts`:
- 상품과 SKU가 저장되고 `productId`가 돌아온다
- 생성 시각이 주입된 `Clock`의 값이다
- SKU ID가 주입된 `IdGenerator`에서 나온다(순번 fake라 값을 단언할 수 있다)
- 가격 DTO의 문자열 금액이 `bigint`로 변환돼 저장된다
- 빈 이름이면 `InvalidProductError`이고 **아무것도 저장되지 않는다**
- SKU 코드가 중복이면 `DuplicateSkuCodeError`이고 아무것도 저장되지 않는다
- 잘못된 형식의 금액 문자열(`'007'`)이면 `InvalidMoneyError`다

`update-price.service.spec.ts`:
- 지정한 SKU의 가격만 바뀌고 저장본에 반영된다(메모리 인스턴스가 아니라 리포지토리를 다시 읽어 확인한다)
- 없는 상품이면 `ProductNotFoundError`
- 없는 SKU면 `SkuNotFoundError`이고 저장본은 그대로다
- 0원이면 `InvalidPriceError`이고 저장본은 그대로다

`get-product.service.spec.ts` / `search-products.service.spec.ts`:
- 조회 포트의 결과를 그대로 돌려준다
- 없는 상품이면 `ProductNotFoundError`
- 검색이 `ARCHIVED` 상품을 제외한다
- 검색이 이름 오름차순으로 정렬된다

- [ ] **Step 9: 이 검사가 무엇을 잡는지 증명한다**

**(a) 값 객체 생성이 트랜잭션 밖인가**
`register-product.service.ts`에서 `skus` 생성과 `Product.register` 호출을 `transactions.run` **안**으로 옮긴다.
Expected: 단위 테스트는 `PassthroughTransactionManager`를 쓰므로 **전부 통과한다.** 이것이 단위 테스트의 한계이고, 알아두는 것이 이 프루브의 목적이다. 관측 결과를 보고서에 적는다.
되돌린다.

**(b) 실패 시 아무것도 저장되지 않는가**
`Product.register` 호출을 `try { ... } catch { }`로 감싸 예외를 삼키고 부분 저장을 하게 만든다 — 구체적으로는 `register`가 던져도 빈 SKU 목록으로 상품을 저장하도록 고친다.
Expected: FAIL — `'빈 이름이면 InvalidProductError이고 아무것도 저장되지 않는다'`가 실패한다.
되돌린다.

**(c) fake의 깊은 복사가 실제로 있는가**
`InMemoryProductRepository`의 `save`가 `Product.rehydrate(...)` 대신 인자를 그대로 저장하게 바꾼다.
Expected: FAIL — 계약의 `'저장 후 원본을 변경해도 저장본은 바뀌지 않는다'`가 실패한다.
되돌린다.

- [ ] **Step 10: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/catalog
git commit -m "feat(catalog): 상품 등록·가격 변경 유스케이스와 계약 테스트를 통과하는 fake를 추가한다"
```

---

### Task 3: 영속 스키마 — 상품·SKU·재고·예약

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_catalog_inventory/migration.sql`
- Modify: `apps/api/test/schema/indexes.integration.spec.ts`

**Interfaces:**
- Produces (태스크 4·10·11·12의 매퍼가 이 컬럼 이름에 의존한다):
  - `products(id, name, status, created_at)`
  - `skus(id, product_id, code, price_amount, price_currency)` + `(product_id, code)` 유니크 + `product_id` 인덱스, `product_id` FK `onDelete: Cascade`
  - `stock_items(sku_id PK, on_hand, reserved, version)`
  - `reservations(id, sku_id, order_id, quantity, status, expires_at, created_at)` + **`expires_at` 인덱스** + `sku_id` 인덱스 + `order_id` 인덱스
  - Prisma 모델명 `Product`, `Sku`, `StockItem`, `Reservation`

**외래 키를 어디에 거는가 — 계획 2가 정한 규칙 그대로.** `skus.product_id`에는 FK를 건다(`Sku`는 `Product` 애그리거트 **안**이라 상품이 사라지면 함께 사라져야 한다, `onDelete: Cascade`). `stock_items.sku_id`, `reservations.sku_id`, `reservations.order_id`에는 **걸지 않는다** — 서로 다른 애그리거트 루트이고, 특히 `orders` 테이블은 계획 4까지 존재하지도 않는다. `Session` 모델에 남긴 것과 같은 주석을 `StockItem`/`Reservation`에도 남긴다.

**`stock_items.version`은 낙관적 어댑터 전용이다.** 비관적 어댑터는 이 컬럼을 읽지도 쓰지도 않는다 — 그래야 두 어댑터를 같은 스키마로 비교할 수 있다(스펙 §10.8). 이 사실을 모델 주석에 적는다.

- [ ] **Step 1: 인덱스 감시 테스트를 먼저 확장한다**

`apps/api/test/schema/indexes.integration.spec.ts`는 계획 2가 만든 파일이고, 부분 인덱스가 마이그레이션에서 사라지는 것을 감시한다. 여기에 `reservations.expires_at` 인덱스에 대한 `describe` 블록을 더한다.

이 인덱스는 부분 인덱스가 아니지만 **만료 스케줄러가 전역 스캔에 쓰는 유일한 진입점**이다(스펙 §10.8). 사라져도 기능 테스트는 전부 통과하고 스캔만 느려진다 — 정확히 이 감시가 존재하는 이유다.

```ts
describe('예약 만료 스캔 인덱스', () => {
  it('reservations_expires_at_idx가 존재한다', async () => {
    const def = await indexDefinition('reservations_expires_at_idx');
    expect(def).not.toBeNull();
    expect(def).toContain('expires_at');
  });

  it('만료 스캔 쿼리가 순차 스캔이 아니라 인덱스를 탄다', async () => {
    // 인덱스가 "존재한다"와 "쓰인다"는 다른 명제다. 스케줄러는 PENDING이면서
    // expires_at이 지난 행만 찾는데, 그 조건이 인덱스를 타는지는 별개 문제다.
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO reservations (id, sku_id, order_id, quantity, status, expires_at, created_at)
      SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'PENDING',
             now() + (n || ' seconds')::interval, now()
        FROM generate_series(1, 5000) AS n
    `);
    await db.$executeRawUnsafe('ANALYZE reservations');

    const plan = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`
      EXPLAIN SELECT id FROM reservations
        WHERE status = 'PENDING' AND expires_at <= now()
        ORDER BY expires_at ASC
        LIMIT 100
    `);
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(planText).toContain('reservations_expires_at_idx');
  });
});
```

**이 EXPLAIN 쿼리는 태스크 9의 `PrismaReservationRepository.findExpired`가 실제로 내는 쿼리와 같은 모양이어야 한다.** 계획 2의 태스크 9에서 프루브 쿼리가 실제 릴레이 쿼리와 달라 Important 지적을 받았다 — 이름이 검증 내용보다 많은 것을 약속하는 검사였다. 태스크 9를 구현할 때 이 쿼리와 대조하고, 어긋나면 **여기를 실제 쿼리에 맞춘다.**

플래너가 순차 스캔을 고르면 행 수를 20000으로 올린다. 그래도 인덱스를 타지 않으면 **테스트를 지우지 말고** `expect(planText).not.toContain('Seq Scan on reservations')`로 약화시키되 이유를 주석으로 남기고 보고한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm db:up && pnpm test:int apps/api/test/schema/indexes.integration.spec.ts`
Expected: FAIL — `reservations` 테이블이 없다.

- [ ] **Step 3: `schema.prisma`에 모델 4종을 추가한다**

```prisma
/// catalog 컨텍스트의 상품. status 전이 유스케이스는 이 계획에 없다 —
/// 'ARCHIVED'는 검색 필터가 걸러내는지 확인하는 데 쓰인다.
model Product {
  id        String   @id @db.Uuid
  name      String
  status    String
  createdAt DateTime @map("created_at") @db.Timestamptz(3)
  skus      Sku[]

  @@map("products")
}

/// Product 애그리거트 **안**의 엔티티. 상품이 사라지면 함께 사라진다.
/// (product_id, code) 유니크는 "한 상품 안에서 SKU 코드는 유일하다"는
/// 도메인 불변식의 마지막 방어선이다 — 동시 등록은 도메인만으로 막을 수 없다.
model Sku {
  id            String  @id @db.Uuid
  productId     String  @map("product_id") @db.Uuid
  code          String
  priceAmount   BigInt  @map("price_amount")
  priceCurrency String  @map("price_currency")
  product       Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, code])
  @@index([productId])
  @@map("skus")
}

/// inventory 컨텍스트의 재고. SKU당 한 행이라 sku_id가 PK다.
///
/// sku_id에 외래 키를 걸지 않는다 — StockItem과 Sku는 서로 다른 컨텍스트의
/// 애그리거트 루트이고 생명주기가 독립적이다(스펙 §5.1). 계획 2가
/// sessions.account_id에 같은 판단을 했다.
///
/// version은 **낙관적 락 어댑터 전용**이다. 비관적 어댑터는 이 컬럼을 읽지도
/// 쓰지도 않는다 — 그래야 두 어댑터를 같은 스키마 위에서 비교할 수 있다.
model StockItem {
  skuId   String @id @map("sku_id") @db.Uuid
  onHand  Int    @map("on_hand")
  reserved Int
  version Int    @default(0)

  @@map("stock_items")
}

/// 예약. **StockItem 안이 아니라 자기 애그리거트 루트다** — 만료 스케줄러가
/// expires_at으로 SKU를 가로질러 전역 스캔해야 하기 때문이다(스펙 §10.8).
/// stock_items.reserved는 같은 트랜잭션에서 함께 갱신되는 비정규화 카운터다.
///
/// order_id에 외래 키가 없다: orders 테이블은 계획 4까지 존재하지 않고,
/// Order와 Reservation은 다른 컨텍스트의 애그리거트 루트다.
model Reservation {
  id        String    @id @db.Uuid
  skuId     String    @map("sku_id") @db.Uuid
  orderId   String    @map("order_id") @db.Uuid
  quantity  Int
  status    String
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(3)
  createdAt DateTime  @map("created_at") @db.Timestamptz(3)

  /// TTL 자가치유가 이 인덱스를 스캔한다(스펙 §6.2의 5단계).
  @@index([expiresAt], map: "reservations_expires_at_idx")
  @@index([skuId])
  @@index([orderId])
  @@map("reservations")
}
```

- [ ] **Step 4: 마이그레이션을 `--create-only`로 만들고 검사한다**

```bash
pnpm --filter @commerce/api exec prisma migrate dev --create-only --name catalog_inventory
```

**`--create-only`가 필수다.** 생성된 SQL을 **읽는다.** `DROP INDEX "outbox_unpublished_idx"`나 `DROP INDEX "saved_addresses_default_idx"` 같은 줄이 있으면 **삭제한다** — 부분 인덱스는 Prisma 스키마 언어로 표현할 수 없어 원시 SQL에만 존재하고, `migrate dev`가 "스키마에 없는 인덱스"라며 DROP을 제안할 수 있다. 그런 줄이 있었다면 그 사실을 보고서에 **눈에 띄게** 적을 것 — 계획 2의 M8이 우려한 바로 그 현상이 실제로 일어난 것이다.

`@@index([expiresAt], map: "reservations_expires_at_idx")`가 생성된 SQL에서 그 이름으로 나오는지 확인한다. 이름이 다르면 감시 테스트가 찾지 못한다.

- [ ] **Step 5: 적용하고 통과를 확인한다**

```bash
pnpm db:migrate
pnpm db:generate
pnpm test:int apps/api/test/schema/indexes.integration.spec.ts
```

Expected: PASS — 기존 6개 + 새 2개.

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) 만료 인덱스 소실을 잡는가**
마이그레이션에서 `reservations_expires_at_idx`를 만드는 `CREATE INDEX` 줄을 주석 처리한다. 템플릿 DB를 지우고 다시 만들어야 반영된다.

```bash
docker exec commerce-db psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'commerce_test%'"
docker exec commerce-db psql -U postgres -c "DROP DATABASE IF EXISTS commerce_test_template"
pnpm test:int apps/api/test/schema/indexes.integration.spec.ts
```

Expected: FAIL — 존재 테스트가 `null`이라며 실패하고, EXPLAIN 테스트도 인덱스 이름을 찾지 못해 실패한다.
되돌리고 같은 절차로 다시 통과하는지 확인한다.

**(b) 기존 부분 인덱스 두 개가 여전히 살아 있는가**
되돌린 뒤 전체 인덱스 스위트를 다시 돌려 계획 1·2의 `outbox_unpublished_idx`와 `saved_addresses_default_idx` 테스트가 모두 통과하는지 확인한다. 새 마이그레이션이 그것들을 지우지 않았다는 증거다.

- [ ] **Step 7: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/prisma apps/api/test/schema
git commit -m "feat(db): 상품·SKU·재고·예약 테이블과 만료 스캔 인덱스 감시를 추가한다"
```

---

### Task 4: Catalog 영속 어댑터 — Prisma 리포지토리와 조회

**Files:**
- Create: `apps/api/src/modules/catalog/adapters/out/persistence/product.mapper.ts` + spec
- Create: `apps/api/src/modules/catalog/adapters/out/persistence/prisma-product.repository.ts`
- Create: `apps/api/src/modules/catalog/adapters/out/persistence/prisma-product.query.ts`
- Create: `apps/api/src/modules/catalog/adapters/out/persistence/prisma-product.repository.integration.spec.ts`
- Create: `apps/api/src/modules/catalog/adapters/out/persistence/prisma-product.query.integration.spec.ts`

**Interfaces:**
- Consumes: `ProductRepository`/`ProductQuery` 포트(태스크 2), `productRepositoryContract`(태스크 2), `asPrismaClient`(`shared/infrastructure/prisma/prisma-transaction-manager.ts`), `PrismaTransactionManager`, `testDb()`(`apps/api/test/setup/database.ts`), 태스크 3의 Prisma 모델
- Produces: `toProductDomain(row)`, `toProductRow(product)`, `toSkuRows(product)`, `PrismaProductRepository(prisma)`, `PrismaProductQuery(prisma)`

**이 태스크가 반드시 지켜야 하는 것**

1. **매퍼는 `ProductId.fromPersistence` / `SkuId.fromPersistence` / `Price.fromPersistence`를 쓴다.** `.of`를 쓰면 깨진 저장 행이 400을 내고 클라이언트에게 "당신 요청이 잘못됐다"고 거짓말한다. 계획 2의 최종 리뷰가 이 규칙이 매퍼에서 절반만 지켜진 것(ID는 맞고 VO는 틀림)을 잡아냈다 — 여기서는 처음부터 전부 맞춘다.
2. **`save`는 애그리거트에서 사라진 SKU 행을 지운다.** upsert만 하면 지운 SKU가 다음 조회에서 되살아난다. "애그리거트를 저장한다"는 말의 실제 의미가 그것이다.
3. **`price_amount`는 `BigInt` 컬럼이고 매퍼는 `bigint`를 그대로 넘긴다.** `Number`를 거치면 `Number.MAX_SAFE_INTEGER`를 넘는 금액에서 조용히 정밀도를 잃는다. 계약 테스트에 `9007199254740993n` 케이스가 있는 이유다.
4. **`PrismaProductQuery.search`는 `status = 'ACTIVE'`만 돌려주고 이름 오름차순으로 정렬한다.** 정렬을 지정하지 않으면 Postgres는 아무것도 보장하지 않고 목록이 새로고침마다 뒤바뀐다.

- [ ] **Step 1: 계약 스위트를 Prisma 위에 돌리는 통합 spec을 쓴다**

```ts
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { testDb } from '../../../../../../test/setup/database';
import { productRepositoryContract } from '../../../testing/product-repository.contract';
import { PrismaProductRepository } from './prisma-product.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다(testing/in-memory-product.repository.spec.ts).
// 두 구현이 같은 계약을 통과해야 fake가 실물과 드리프트할 수 없다.
productRepositoryContract(
  'prisma',
  async () => new PrismaProductRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
```

Run: `pnpm test:int apps/api/src/modules/catalog`
Expected: FAIL — 클래스가 없다.

- [ ] **Step 2: 매퍼를 구현한다**

```ts
import { ProductId, SkuId } from '../../../../../shared/kernel/identifiers';
import type { Currency } from '../../../../../shared/kernel/money';
import { Price } from '../../../domain/price';
import { Product, type ProductStatus } from '../../../domain/product';
import { Sku } from '../../../domain/sku';

export interface SkuRow {
  id: string;
  productId: string;
  code: string;
  priceAmount: bigint;
  priceCurrency: string;
}

export interface ProductRow {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  skus: SkuRow[];
}

/**
 * 저장된 행 → 애그리거트.
 *
 * 식별자도 가격도 `fromPersistence`를 쓴다. `.of`를 쓰면 깨진 행을 만났을 때
 * `DomainError`가 나가 400이 되고, 클라이언트는 자기 요청이 잘못됐다고 듣는다.
 * 실제로는 우리 데이터가 깨진 것이므로 500이 정직하다.
 */
export function toProductDomain(row: ProductRow): Product {
  return Product.rehydrate({
    id: ProductId.fromPersistence(row.id),
    name: row.name,
    status: row.status as ProductStatus,
    skus: row.skus.map((sku) =>
      Sku.rehydrate({
        id: SkuId.fromPersistence(sku.id),
        code: sku.code,
        price: Price.fromPersistence(sku.priceAmount, sku.priceCurrency as Currency),
      }),
    ),
    createdAt: row.createdAt,
  });
}

export function toProductRow(product: Product): Omit<ProductRow, 'skus'> {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    createdAt: product.createdAt,
  };
}

export function toSkuRows(product: Product): SkuRow[] {
  return product.skus.map((sku) => ({
    id: sku.id,
    productId: product.id,
    code: sku.code,
    // bigint를 그대로 넘긴다. Number를 거치면 큰 금액에서 정밀도를 잃는다.
    priceAmount: sku.price.money.amount,
    priceCurrency: sku.price.money.currency,
  }));
}
```

`product.mapper.spec.ts`는 왕복 보존, `fromPersistence` 사용(깨진 UUID/0원 가격이 `DomainError`가 **아닌** 예외를 던진다), 복원된 애그리거트가 미커밋 이벤트를 갖지 않는다는 것(=`Product`가 `AggregateRoot`를 상속하지 않으므로 해당 없음 — 대신 `status`와 `createdAt` 보존)을 확인한다.

- [ ] **Step 3: `prisma-product.repository.ts`를 구현한다**

`findById`는 `include: { skus: true }`로 읽는다. `save`는 세 단계다.

```ts
async save(product: Product, tx?: TransactionContext): Promise<void> {
  const client = this.client(tx);
  const row = toProductRow(product);
  const skuRows = toSkuRows(product);

  await client.product.upsert({
    where: { id: row.id },
    create: row,
    update: { name: row.name, status: row.status },
  });

  // 애그리거트에서 사라진 SKU를 지운다. upsert만 하면 지운 SKU가 다음 조회에서
  // 되살아난다. notIn이 빈 배열이면 그 상품의 SKU 전부가 지워지는데, 그것이
  // "SKU가 하나도 없는 애그리거트"를 저장하는 올바른 결과다 — 다만 Product의
  // 불변식이 그 상태를 애초에 막으므로 실제로는 도달하지 않는다.
  await client.sku.deleteMany({
    where: { productId: row.id, id: { notIn: skuRows.map((sku) => sku.id) } },
  });

  for (const skuRow of skuRows) {
    await client.sku.upsert({ where: { id: skuRow.id }, create: skuRow, update: skuRow });
  }
}
```

- [ ] **Step 4: `prisma-product.query.ts`를 구현한다**

```ts
async search(criteria: SearchCriteria): Promise<ProductView[]> {
  const rows = await this.prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      ...(criteria.keyword === undefined
        ? {}
        : { name: { contains: criteria.keyword, mode: 'insensitive' as const } }),
    },
    include: { skus: { orderBy: { code: 'asc' } } },
    // 정렬을 지정하지 않으면 Postgres는 순서를 보장하지 않고 목록이 새로고침마다
    // 뒤바뀐다. 이름이 같을 수 있으므로 id를 2차 키로 둬 안정 정렬을 만든다.
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: criteria.offset,
    take: criteria.limit,
  });
  return rows.map(toProductView);
}
```

`toProductView`는 `bigint`를 `.toString()`으로 옮긴다 — JSON에 `bigint`가 없다.

- [ ] **Step 5: 조회 어댑터의 통합 spec을 쓴다**

`prisma-product.query.integration.spec.ts`는 아래를 확인한다.
- ID로 조회하면 SKU까지 함께 나온다
- 없는 ID는 `null`
- 금액이 문자열로 나오고 큰 값(`9007199254740993`)의 정밀도가 보존된다
- **`ARCHIVED` 상품은 검색에서 제외된다** (`rehydrate` + 리포지토리로 시딩)
- 이름 오름차순으로 정렬되고, 같은 이름이면 id로 안정 정렬된다
- `keyword`가 이름 부분 일치로 걸러내고 대소문자를 무시한다
- `offset`/`limit`이 동작한다

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/catalog`
Expected: PASS — 계약 8개(롤백 포함) + 조회 7개.

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) SKU 삭제 동기화가 실제로 있는가**
`prisma-product.repository.ts`의 `deleteMany` 블록을 지운다.
Expected: 계약의 `'가격을 바꿔 다시 저장하면 갱신된다 — 행이 늘지 않는다'`는 SKU를 지우지 않으므로 통과할 수 있다. **그렇다면 계약에 판별하는 케이스가 없다는 뜻이다** — 그 경우 SKU를 하나 지운 뒤 재저장하고 다시 읽어 사라졌는지 확인하는 케이스를 계약에 추가하고, 그 케이스가 실패하는 것을 확인한 뒤 **남겨둔다.** 계획 2의 태스크 14에서 같은 상황(프루브가 우연히 통과)이 발생했고 그때 추가한 케이스가 진짜 결함을 잡았다.

> `Product`의 불변식이 SKU 0개를 막으므로 "SKU를 하나 지운다"는 SKU 2개짜리 상품에서만 가능하다. 계약의 `aProduct` 헬퍼가 기본 2개를 만드는 이유다.

되돌린다.

**(b) `bigint` 정밀도가 실제로 보존되는가**
`product.mapper.ts`의 `priceAmount: sku.price.money.amount`를 `priceAmount: BigInt(Number(sku.price.money.amount))`로 바꾼다.
Expected: FAIL — 계약의 `'가격의 금액과 통화가 왕복해도 보존된다'`가 `9007199254740993n`이 `9007199254740992n`으로 돌아왔다며 실패한다. **in-memory 쪽은 통과한다** — 매퍼를 거치지 않기 때문이다. 그 비대칭이 계약을 두 구현에 돌리는 이유다.
되돌린다.

**(c) 검색의 상태 필터가 실제로 있는가**
`prisma-product.query.ts`의 `status: 'ACTIVE'`를 지운다.
Expected: FAIL — `'ARCHIVED 상품은 검색에서 제외된다'`가 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/catalog
git commit -m "feat(catalog): Prisma 상품 리포지토리와 조회 어댑터를 추가한다"
```

---

### Task 5: Catalog 계약·컨트롤러·모듈 배선

**Files:**
- Create: `packages/contracts/src/catalog/product.contract.ts` + spec
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/api.contract.ts`
- Create: `apps/api/src/modules/catalog/adapters/in/http/product.controller.ts`
- Create: `apps/api/src/modules/catalog/adapters/in/http/catalog-domain-error-mappings.ts`
- Create: `apps/api/src/modules/catalog/adapters/in/http/product.controller.integration.spec.ts`
- Create: `apps/api/src/modules/catalog/catalog.module.ts`, `apps/api/src/modules/catalog/index.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`

**Interfaces:**
- Consumes: 태스크 2의 유스케이스 토큰, 태스크 4의 어댑터, `AccessTokenGuard`/`CurrentPrincipal`/`ZodValidationPipe`(`shared/infrastructure/http/`, 전부 `SharedModule`이 export), `moneyDtoSchema`/`errorDtoSchema`/`ErrorCode`(`@commerce/contracts`)
- Produces: `productContract`, `CatalogModule`, `catalog/index.ts`(계획 4의 Ordering이 가격 ACL로 쓴다)

**계약 설계**

```ts
export const skuDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(50),
  price: moneyDtoSchema,
}).strict();

export const productDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  skus: z.array(skuDtoSchema),
}).strict();

export const registerProductBodySchema = z.object({
  name: z.string().min(1).max(200),
  skus: z.array(z.object({ code: z.string().min(1).max(50), price: moneyDtoSchema }).strict()).min(1),
}).strict();

export const updatePriceBodySchema = z.object({ price: moneyDtoSchema }).strict();
```

**모든 스키마에 `.strict()`를 붙인다.** non-strict zod 객체는 알 수 없는 키를 오류가 아니라 **조용히 버린다** — 드리프트가 한 방향으로만 잡힌다.

`skus`의 `.min(1)`은 형식 검증인가 도메인 규칙인가? **형식이다.** "빈 배열은 이 요청의 형태가 아니다"는 전송 계약의 문제이고, "SKU 없는 상품은 존재할 수 없다"는 `Product.register`가 지킨다. 둘 다 있는 것이 맞고, 계획 2가 비밀번호 길이에서 내린 판단(정책은 도메인, 형태는 Zod)과 모순되지 않는다 — 저기서는 **정책 숫자**가 Zod로 샜던 것이고 여기서는 배열의 형태다. 이 구분을 계약 파일 주석에 적는다.

응답 맵에는 각 라우트가 실제로 낼 수 있는 상태를 전부 적는다. 계획 2에서 `400`을 빠뜨려 최종 리뷰가 잡아냈고, BFF가 그 맵을 읽어 클라이언트를 만든다.

| 라우트 | 상태 |
|---|---|
| `POST /products` | 201, 400(`VALIDATION_FAILED`/`INVALID_PRODUCT`/`INVALID_PRICE`), 401, 409(`DUPLICATE_SKU_CODE`) |
| `PUT /products/:productId/skus/:skuId/price` | 204, 400, 401, 404(`PRODUCT_NOT_FOUND`/`SKU_NOT_FOUND`) |
| `GET /products/:productId` | 200, 400, 404 |
| `GET /products` | 200, 400 |

- [ ] **Step 1: 계약과 그 spec을 쓴다**

`product.contract.spec.ts`는 계획 2의 `auth.contract.spec.ts` 형태를 따른다: 정상 파싱, 추가 필드 거부(`.strict()`가 실제로 동작하는지), 빈 SKU 배열 거부, 금액이 정규화된 정수 문자열이 아니면 거부(`moneyDtoSchema`가 이미 그것을 한다 — 여기서는 그 규칙이 계약에 실제로 연결됐는지 확인한다).

- [ ] **Step 2: `.strict()`가 무엇을 잡는지 증명한다**

`productDtoSchema`에서 `.strict()`를 지운다.
Expected: FAIL — `'계약에 없는 필드를 거부한다'`만 실패하고 나머지는 통과한다. `.strict()` 없이는 zod가 알 수 없는 키를 조용히 버리므로 오류가 나지 않는다.
되돌린다.

- [ ] **Step 3: 컨트롤러를 만든다**

```ts
@Controller('products')
export class ProductController {
  constructor(
    @Inject(REGISTER_PRODUCT_USECASE) private readonly registerProduct: RegisterProductUseCase,
    @Inject(UPDATE_PRICE_USECASE) private readonly updatePrice: UpdatePriceUseCase,
    @Inject(GET_PRODUCT_QUERY) private readonly getProduct: GetProductQuery,
    @Inject(SEARCH_PRODUCTS_QUERY) private readonly searchProducts: SearchProductsQuery,
  ) {}
  ...
}
```

**쓰기 두 엔드포인트에는 `@UseGuards(AccessTokenGuard)`를 건다.** 스펙 §5.5는 "관리자만 상품 등록 가능"을 어댑터 가드의 예로 들지만 이 프로젝트에 역할 개념이 없다 — `Principal`은 `accountId`와 `customerId`만 갖는다. **인증만 걸고 인가는 걸지 않으며, 그 사실을 컨트롤러 주석에 명시한다.** 역할을 지금 만들면 Identity의 계정 모델로 되돌아가야 하고 그것은 이 계획의 범위 밖이다.

조회 두 엔드포인트에는 가드를 걸지 않는다 — 상품 목록은 로그인 없이 볼 수 있어야 한다.

`GET /products`의 쿼리 파라미터(`keyword`, `limit`, `offset`)는 문자열로 도착하므로 `ZodValidationPipe`에 `z.coerce.number()`를 쓴 스키마를 붙인다. `limit`의 상한(100)을 계약에 둔다 — 없으면 `limit=1000000` 한 방으로 DB를 훑게 된다.

- [ ] **Step 4: 에러 매핑을 등록한다**

```ts
export function registerCatalogDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(InvalidPriceError.CODE, { status: 400, code: ErrorCode.VALIDATION_FAILED });
  registry.register(InvalidProductError.CODE, { status: 400, code: ErrorCode.VALIDATION_FAILED });
  registry.register(DuplicateSkuCodeError.CODE, { status: 409, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(SkuNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(ProductNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
}
```

**등록하지 않은 `DomainError`는 예외를 내지 않는다** — 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 틀린 상태 코드가 나간다. `app.module.spec.ts`가 조립된 레지스트리를 직접 resolve해 다섯 매핑을 확인한다.

- [ ] **Step 5: 모듈을 배선한다**

`catalog.module.ts`는 계획 2의 `customer.module.ts` 형태를 그대로 따른다 — `useFactory` + 위치 인자 `inject:` 배열, 생성자에서 `registerCatalogDomainErrors(registry)` 호출. **`inject:` 배열이 생성자 인자 순서와 위치별로 일치해야 한다** — 같은 타입 둘이 뒤바뀌면 타입 검사는 통과하고 런타임에만 깨진다.

`catalog/index.ts`는 `CatalogModule`만 내보낸다. 계획 4가 가격 ACL을 붙일 때 조회 포트를 여기에 더한다.

- [ ] **Step 6: 통합 테스트를 쓴다**

단위 테스트가 구조적으로 볼 수 없는 것만 덮는다.
- 상품 등록 → 201, 응답 본문을 `productContract.register.responses[201]` 스키마로 파싱한다(**서버를 자기 계약에 묶는다** — 함수 반환값은 excess property 검사가 걸리지 않아 필드가 새어도 타입 검사가 통과한다. 계획 2의 최종 리뷰가 잡은 항목이다)
- 토큰 없이 등록 → 401, 메시지가 가드의 것(`'인증 토큰이 없습니다.'`)인지 단언해 데코레이터의 401과 구분한다
- SKU 코드 중복 → 409 `DOMAIN_RULE_VIOLATED`
- 0원 가격 → 400 `VALIDATION_FAILED`
- 가격 변경 → 204, 다시 조회하면 바뀌어 있다
- 다른 상품의 SKU ID로 가격 변경 → 404
- 경로 파라미터가 uuid가 아니면 → 400
- 검색이 `ARCHIVED`를 제외한다

통합 spec은 `afterAll`에서 `process.env['DATABASE_URL']`을 복원한다 — 워커 단위라 이후 spec에 샌다.

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 가드가 실제로 걸려 있는가**
`@UseGuards(AccessTokenGuard)`를 등록 엔드포인트에서 지운다.
Expected: 401은 여전히 날 수 있다 — `@CurrentPrincipal()`을 쓰지 않는 엔드포인트라면 가드가 유일한 방어선이므로 **200이 나야 한다.** 등록 엔드포인트가 `principal`을 쓰지 않는다면 이 프루브가 진짜 판별력을 갖는다. 관측 결과를 그대로 적는다.
되돌린다.

**(b) 에러 매핑 누락을 잡는가**
`DuplicateSkuCodeError` 등록을 주석 처리한다.
Expected: FAIL — `app.module.spec.ts`가 폴백 `{422, DOMAIN_RULE_VIOLATED}`를 받아 실패하고, 통합 테스트의 409 케이스도 422를 받아 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 순환 없음을 확인한다 — catalog는 어느 모듈도 import하지 않는다.

```bash
git add apps/api/src packages/contracts/src
git commit -m "feat(catalog): 상품 계약과 컨트롤러를 배선한다"
```

---

### Task 6: Inventory 도메인 — `StockItem`과 `Reservation`

**Files:**
- Create: `apps/api/src/modules/inventory/domain/stock.errors.ts`
- Create: `apps/api/src/modules/inventory/domain/stock.events.ts`
- Create: `apps/api/src/modules/inventory/domain/stock-item.ts` + `stock-item.spec.ts`
- Create: `apps/api/src/modules/inventory/domain/reservation.ts` + `reservation.spec.ts`

**Interfaces:**
- Consumes: `AggregateRoot`/`DomainEvent`(`shared/kernel/`), `Quantity`(`shared/kernel/quantity.ts` — `of`는 0 이상, `positive`는 1 이상, `minus`는 음수가 되면 `NegativeQuantityError`), `Duration`, `SkuId`/`OrderId`/`ReservationId`
- Produces:
  - `StockItem.create({ skuId, onHand }): StockItem`, `StockItem.rehydrate({ skuId, onHand, reserved }): StockItem`
  - `stockItem.skuId/onHand/reserved`, `stockItem.available: Quantity`
  - `stockItem.reserve(qty: Quantity): void`, `.confirm(qty): void`, `.release(qty): void`, `.restock(qty): void`
  - `Reservation.create({ id, skuId, orderId, quantity, now, ttl }): Reservation`, `Reservation.rehydrate({ id, skuId, orderId, quantity, status, expiresAt, createdAt }): Reservation`
  - `reservation.confirm(now): boolean`, `.release(now): boolean`, `.expire(now): boolean`, `.isExpiredAt(now): boolean`
  - `type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED'`
  - `InsufficientStockError`(`CODE='INSUFFICIENT_STOCK'`), `ReservationConflictError`(`CODE='RESERVATION_CONFLICT'`), `StockCounterMismatchError`/`CorruptedStockError`(일반 `Error`)
  - `STOCK_RESERVATION_EXPIRED = 'inventory.StockReservationExpired'`, `stockReservationExpired(reservation, occurredAt): DomainEvent`

**설계 결정 넷 — 테스트가 이것들을 고정한다**

1. **`StockItem`에 `version` 필드가 없다.** 스펙 §10.8이 `stock_items.version`을 낙관적 어댑터 전용이라고 못박았다. 도메인 객체가 그 값을 들고 있으면 도메인이 락 전략을 아는 것이고, 그러면 §6.4의 "도메인에는 락 코드가 없다"가 거짓이 된다. 낙관적 어댑터는 읽은 버전을 **자기 클로저 안에** 붙잡아 두고 `UPDATE ... WHERE version = <붙잡은 값>`에 쓴다. 도메인은 그런 컬럼이 있는지도 모른다.

2. **`StockItem.reserve`는 `Reservation`을 만들지 않는다.** 스펙 §6.4의 코드 조각은 `reserve(orderId, qty, ttl): Reservation`으로 되어 있지만, 편차 4대로 `Reservation`이 별개 애그리거트가 되면서 생성 책임이 유스케이스로 간다. `StockItem`은 카운터와 불변식만 안다.

3. **확정·해제가 `reserved`보다 큰 수량을 받으면 `DomainError`가 아니다.** `Quantity.minus`는 음수가 되면 `NegativeQuantityError`(409, 사용자가 만들 수 있는 충돌)를 던지는데, 여기서는 그 분류가 틀렸다 — 예약 행과 카운터가 어긋났다는 뜻이고 사용자가 고칠 수 없다. 그래서 `minus`를 부르기 **전에** 명시적으로 검사해 `StockCounterMismatchError`(일반 `Error` → 500)를 던진다.

4. **`Reservation`의 전이 메서드는 `boolean`을 돌려준다.** Outbox는 at-least-once라 `OrderPaid`가 두 번 배달될 수 있고(스펙 §6.3), 그러면 `confirm`이 두 번 불린다. 두 번째는 **아무것도 하지 않고 `false`**를 돌려주며, 유스케이스는 그 값으로 재고 카운터를 또 건드릴지 결정한다. 되돌릴 수 없는 상태(RELEASED/EXPIRED)에서의 확정은 진짜 충돌이므로 던진다.

- [ ] **Step 1: `StockItem`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/inventory/domain/stock-item.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import { CorruptedStockError, InsufficientStockError, StockCounterMismatchError } from './stock.errors';
import { StockItem } from './stock-item';

const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;
const SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const q = (n: number) => Quantity.of(n);

function stock(onHand: number, reserved = 0): StockItem {
  return StockItem.rehydrate({ skuId: SKU, onHand: q(onHand), reserved: q(reserved) });
}

describe('StockItem.create', () => {
  it('예약 0으로 시작한다', () => {
    const item = StockItem.create({ skuId: SKU, onHand: q(10) });
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(0);
    expect(item.available.value).toBe(10);
  });

  it('재고 0으로도 만들 수 있다', () => {
    // 품절 상태의 SKU도 재고 행은 존재해야 한다 — 없으면 "품절"과 "그런 SKU 없음"을
    // 구분할 수 없다.
    expect(StockItem.create({ skuId: SKU, onHand: q(0) }).available.value).toBe(0);
  });
});

describe('StockItem.available', () => {
  it('보유 - 예약이다', () => {
    expect(stock(10, 3).available.value).toBe(7);
  });

  it('전부 예약되면 0이다', () => {
    expect(stock(10, 10).available.value).toBe(0);
  });
});

describe('StockItem.reserve', () => {
  it('가용 재고 안에서 예약하면 reserved가 는다', () => {
    const item = stock(10);
    item.reserve(q(3));
    expect(item.reserved.value).toBe(3);
    expect(item.available.value).toBe(7);
    expect(item.onHand.value).toBe(10); // 예약은 아직 차감이 아니다
  });

  it('가용 재고를 정확히 다 쓰는 예약은 허용된다', () => {
    const item = stock(10, 4);
    item.reserve(q(6));
    expect(item.available.value).toBe(0);
  });

  it('가용 재고를 넘으면 InsufficientStockError다', () => {
    const item = stock(10, 8);
    expect(() => item.reserve(q(3))).toThrow(InsufficientStockError);
  });

  it('실패한 예약은 카운터를 바꾸지 않는다', () => {
    // 검사가 갱신보다 먼저 일어나야 한다. 순서가 뒤집히면 실패한 예약이
    // 재고를 갉아먹고, 그 손실은 TTL로도 회수되지 않는다(예약 행이 없으므로).
    const item = stock(10, 8);
    expect(() => item.reserve(q(3))).toThrow();
    expect(item.reserved.value).toBe(8);
  });

  it('InsufficientStockError는 DomainError다 — 사용자가 겪는 정상적인 경합 결과다', () => {
    const item = stock(1);
    expect(() => item.reserve(q(2))).toThrow(DomainErrorConstructor);
  });

  it('오류가 요청량과 가용량을 함께 담는다', () => {
    // 프론트가 "3개 요청, 1개 남음"을 보여주려면 둘 다 필요하다.
    const item = stock(1);
    const error = (() => {
      try {
        item.reserve(q(3));
        return null;
      } catch (caught) {
        return caught as InsufficientStockError;
      }
    })();
    expect(error?.requested.value).toBe(3);
    expect(error?.available.value).toBe(1);
    expect(error?.skuId).toBe(SKU);
  });
});

describe('StockItem.confirm', () => {
  it('예약을 실제 차감으로 바꾼다', () => {
    const item = stock(10, 3);
    item.confirm(q(3));
    expect(item.onHand.value).toBe(7);
    expect(item.reserved.value).toBe(0);
    expect(item.available.value).toBe(7);
  });

  it('예약의 일부만 확정할 수 있다', () => {
    const item = stock(10, 5);
    item.confirm(q(2));
    expect(item.onHand.value).toBe(8);
    expect(item.reserved.value).toBe(3);
  });

  it('예약보다 많이 확정하면 StockCounterMismatchError다 — DomainError가 아니다', () => {
    // 예약 행과 카운터가 어긋났다는 뜻이고 사용자가 고칠 수 없다.
    // Quantity.minus에 맡기면 NegativeQuantityError(409)가 나가는데 그 분류는 틀렸다.
    const item = stock(10, 2);
    expect(() => item.confirm(q(3))).toThrow(StockCounterMismatchError);
    expect(() => item.confirm(q(3))).not.toThrow(DomainErrorConstructor);
  });

  it('실패한 확정은 카운터를 바꾸지 않는다', () => {
    const item = stock(10, 2);
    expect(() => item.confirm(q(3))).toThrow();
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(2);
  });
});

describe('StockItem.release', () => {
  it('예약을 되돌린다 — 보유량은 그대로다', () => {
    const item = stock(10, 3);
    item.release(q(3));
    expect(item.reserved.value).toBe(0);
    expect(item.onHand.value).toBe(10);
    expect(item.available.value).toBe(10);
  });

  it('예약보다 많이 해제하면 StockCounterMismatchError다', () => {
    const item = stock(10, 2);
    expect(() => item.release(q(3))).toThrow(StockCounterMismatchError);
  });
});

describe('StockItem.restock', () => {
  it('보유량을 늘린다', () => {
    const item = stock(10, 3);
    item.restock(q(5));
    expect(item.onHand.value).toBe(15);
    expect(item.available.value).toBe(12);
  });
});

describe('StockItem.rehydrate', () => {
  it('저장된 카운터를 그대로 복원한다', () => {
    const item = stock(10, 4);
    expect(item.onHand.value).toBe(10);
    expect(item.reserved.value).toBe(4);
  });

  it('예약이 보유량보다 큰 저장 행은 CorruptedStockError다', () => {
    // available이 음수인 재고는 존재할 수 없다. 도달했다면 데이터가 깨진 것이다.
    expect(() =>
      StockItem.rehydrate({ skuId: SKU, onHand: q(3), reserved: q(5) }),
    ).toThrow(CorruptedStockError);
  });

  it('CorruptedStockError는 DomainError가 아니다', () => {
    expect(() =>
      StockItem.rehydrate({ skuId: SKU, onHand: q(3), reserved: q(5) }),
    ).not.toThrow(DomainErrorConstructor);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/inventory/domain/stock-item.spec.ts`
Expected: FAIL — 파일이 없다.

- [ ] **Step 3: `stock.errors.ts`를 구현한다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';
import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';

/**
 * 가용 재고보다 많이 예약하려 했다. **정상적인 경합 결과다** — 인기 상품에서
 * 동시 주문이 몰리면 대부분의 요청이 이것으로 끝나는 것이 옳은 동작이다.
 * 그래서 `DomainError`이고 409로 나간다.
 *
 * 요청량과 가용량을 함께 담는 이유: 프론트가 "3개 요청하셨지만 1개 남았습니다"를
 * 보여주려면 둘 다 필요하고, 메시지 문자열을 파싱하게 만들면 안 된다.
 */
export class InsufficientStockError extends DomainError {
  static readonly CODE = 'INSUFFICIENT_STOCK';
  readonly code = InsufficientStockError.CODE;

  constructor(
    readonly skuId: SkuId,
    readonly requested: Quantity,
    readonly available: Quantity,
  ) {
    super(`재고가 부족합니다: ${requested.value}개 요청, ${available.value}개 가용`);
  }
}

/**
 * 되돌릴 수 없는 상태의 예약에 확정이나 해제를 시도했다.
 * 이벤트 재배달로 인한 중복 호출은 이 예외가 아니라 no-op으로 처리된다 —
 * `Reservation`의 전이 메서드가 `false`를 돌려준다. 이 예외는 진짜 충돌
 * (이미 확정된 예약을 해제하려는 등)에만 쓴다.
 */
export class ReservationConflictError extends DomainError {
  static readonly CODE = 'RESERVATION_CONFLICT';
  readonly code = ReservationConflictError.CODE;

  constructor(reservationId: string, from: string, to: string) {
    super(`예약 ${reservationId}을(를) ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
  }
}

/**
 * 확정·해제하려는 수량이 예약된 수량보다 크다. 예약 행과 `stock_items.reserved`
 * 카운터가 어긋났다는 뜻이고, 편차 4가 감수하기로 한 비정규화의 대가가 드러난
 * 자리다. 사용자가 고칠 수 없으므로 `DomainError`가 아니다 — 500이 정직하다.
 *
 * `Quantity.minus`에 맡기지 않는 이유가 이것이다: 그쪽은 `NegativeQuantityError`
 * (409, 사용자가 만들 수 있는 충돌)를 던지는데 여기서는 그 분류가 틀렸다.
 */
export class StockCounterMismatchError extends Error {
  constructor(skuId: string, reserved: number, requested: number) {
    super(`재고 카운터가 어긋났습니다 (${skuId}): 예약 ${reserved}개, 요청 ${requested}개`);
    this.name = 'StockCounterMismatchError';
  }
}

/** 저장된 재고 행이 `reserved > onHand`다. 정상 경로로는 불가능하다. */
export class CorruptedStockError extends Error {
  constructor(skuId: string, onHand: number, reserved: number) {
    super(`저장된 재고가 손상되었습니다 (${skuId}): 보유 ${onHand}개, 예약 ${reserved}개`);
    this.name = 'CorruptedStockError';
  }
}
```

- [ ] **Step 4: `stock-item.ts`를 구현한다**

```ts
import type { SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import {
  CorruptedStockError,
  InsufficientStockError,
  StockCounterMismatchError,
} from './stock.errors';

/**
 * 재고 애그리거트 루트.
 *
 * **락 코드가 한 줄도 없다** (스펙 §6.4). 이 클래스가 아는 것은 `reserved ≤ onHand`
 * 하나뿐이고, 그 불변식을 동시 요청 사이에서 지키는 것은 리포지토리 어댑터의 일이다 —
 * 그래서 포트 하나에 어댑터가 셋(in-memory / 비관적 / 낙관적) 붙는다.
 *
 * `version` 필드가 없는 것도 같은 이유다. 낙관적 어댑터가 읽은 버전을 자기 클로저에
 * 붙잡아 두고 `UPDATE ... WHERE version = <붙잡은 값>`에 쓴다. 도메인은 그런 컬럼이
 * 있는지도 모르고, 그래야 두 어댑터가 같은 도메인 코드를 공유한다.
 *
 * `AggregateRoot`를 상속하지 않는다 — 재고 변경 자체를 구독하는 곳이 없다.
 * Inventory가 발행하는 유일한 이벤트는 `StockReservationExpired`이고 그것은
 * `Reservation`이 낸다.
 */
export class StockItem {
  private constructor(
    readonly skuId: SkuId,
    private onHandValue: Quantity,
    private reservedValue: Quantity,
  ) {}

  static create(params: { skuId: SkuId; onHand: Quantity }): StockItem {
    return new StockItem(params.skuId, params.onHand, Quantity.ZERO);
  }

  static rehydrate(params: { skuId: SkuId; onHand: Quantity; reserved: Quantity }): StockItem {
    if (params.reserved.isGreaterThan(params.onHand)) {
      throw new CorruptedStockError(params.skuId, params.onHand.value, params.reserved.value);
    }
    return new StockItem(params.skuId, params.onHand, params.reserved);
  }

  get onHand(): Quantity {
    return this.onHandValue;
  }

  get reserved(): Quantity {
    return this.reservedValue;
  }

  get available(): Quantity {
    return this.onHandValue.minus(this.reservedValue);
  }

  /** 예약은 차감이 아니다 — `onHand`는 그대로 두고 `reserved`만 늘린다. */
  reserve(quantity: Quantity): void {
    // 검사가 갱신보다 먼저다. 순서가 뒤집히면 실패한 예약이 재고를 갉아먹고,
    // 예약 행이 없으므로 TTL로도 회수되지 않는다.
    if (quantity.isGreaterThan(this.available)) {
      throw new InsufficientStockError(this.skuId, quantity, this.available);
    }
    this.reservedValue = this.reservedValue.plus(quantity);
  }

  /** 예약을 실제 차감으로 바꾼다. 보유량과 예약량이 함께 준다. */
  confirm(quantity: Quantity): void {
    this.assertReservedCovers(quantity);
    this.onHandValue = this.onHandValue.minus(quantity);
    this.reservedValue = this.reservedValue.minus(quantity);
  }

  /** 예약을 되돌린다. 보유량은 건드리지 않는다. */
  release(quantity: Quantity): void {
    this.assertReservedCovers(quantity);
    this.reservedValue = this.reservedValue.minus(quantity);
  }

  restock(quantity: Quantity): void {
    this.onHandValue = this.onHandValue.plus(quantity);
  }

  private assertReservedCovers(quantity: Quantity): void {
    if (quantity.isGreaterThan(this.reservedValue)) {
      throw new StockCounterMismatchError(this.skuId, this.reservedValue.value, quantity.value);
    }
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/inventory/domain/stock-item.spec.ts`
Expected: PASS

- [ ] **Step 6: `Reservation`의 실패 테스트를 쓰고 구현한다**

`reservation.spec.ts`가 덮어야 할 것 — 각 항목이 왜 필요한지 주석을 단다.

- `create`가 `PENDING`이고 `expiresAt = now + ttl`이며 `createdAt = now`다
- `create`는 이벤트를 쌓지 않는다
- `isExpiredAt`이 반열린 구간이다: `expiresAt` 직전은 살아 있고 `expiresAt` 정각은 만료다
- `confirm(now)`가 `PENDING`에서 `true`를 돌려주고 상태가 `CONFIRMED`가 된다
- **`confirm`을 두 번 부르면 두 번째는 `false`를 돌려주고 상태가 그대로다** — Outbox가 at-least-once라 이벤트가 두 번 배달되는 것이 정상이다(스펙 §6.3)
- `RELEASED`인 예약에 `confirm`하면 `ReservationConflictError`다
- `EXPIRED`인 예약에 `confirm`하면 `ReservationConflictError`다 — TTL이 이미 재고를 돌려줬는데 확정하면 초과 판매가 된다
- `release(now)`가 `PENDING`에서 `true`, 두 번째는 `false`
- `CONFIRMED`인 예약에 `release`하면 `ReservationConflictError`다
- `EXPIRED`인 예약에 `release`하면 `false`다 — 만료가 이미 해제를 했으므로 멱등하게 넘어간다
- `expire(now)`가 `PENDING`에서 `true`이고 **`StockReservationExpired` 이벤트를 쌓는다**
- 이벤트 payload가 JSON 직렬화 가능한 원시 값만 담는다(`reservationId`, `skuId`, `orderId`, `quantity`) — outbox의 payload가 JsonB라 값 객체를 넣으면 `{}`로 조용히 직렬화된다
- `expire`를 두 번 부르면 두 번째는 `false`이고 **이벤트를 또 쌓지 않는다**
- `CONFIRMED`인 예약에 `expire`하면 `false`이고 이벤트가 없다 — 결제가 끝난 예약을 TTL이 뒤늦게 만료시키면 안 된다
- `rehydrate`는 이벤트를 쌓지 않는다

`ReservationStatus` 전이표를 `reservation.ts`의 doc 주석에 표로 남긴다.

| 현재 | `confirm` | `release` | `expire` |
|---|---|---|---|
| PENDING | → CONFIRMED, `true` | → RELEASED, `true` | → EXPIRED, `true` + 이벤트 |
| CONFIRMED | `false` (멱등) | **던진다** | `false` |
| RELEASED | **던진다** | `false` (멱등) | `false` |
| EXPIRED | **던진다** | `false` | `false` |

`stock.events.ts`:

```ts
import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { Reservation } from './reservation';

export const STOCK_RESERVATION_EXPIRED = 'inventory.StockReservationExpired';

/**
 * 예약이 TTL로 만료됐다. 계획 4의 Ordering이 구독해 주문을 실패 처리한다.
 *
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload 컬럼이
 * JsonB이고, 값 객체를 그대로 넣으면 직렬화가 `{}`가 되어 조용히 빈 이벤트가 발행된다.
 */
export function stockReservationExpired(
  reservation: Pick<Reservation, 'id' | 'skuId' | 'orderId' | 'quantity'>,
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: STOCK_RESERVATION_EXPIRED,
    aggregateType: 'Reservation',
    aggregateId: reservation.id,
    occurredAt,
    payload: {
      reservationId: reservation.id,
      skuId: reservation.skuId,
      orderId: reservation.orderId,
      quantity: reservation.quantity.value,
    },
  };
}
```

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

네 가지를 각각 증명한다.

**(a) 예약 검사가 갱신보다 먼저인가**
`stock-item.ts`의 `reserve`에서 `if (quantity.isGreaterThan(this.available))` 블록을 `this.reservedValue = ...` **뒤로** 옮긴다.
Expected: FAIL — `'실패한 예약은 카운터를 바꾸지 않는다'`가 실패한다. 이 회귀는 **실패한 예약이 재고를 영구히 갉아먹게** 만든다 — 예약 행이 만들어지지 않으므로 TTL 자가치유도 회수하지 못한다.
되돌린다.

**(b) 카운터 불일치가 500으로 가는가**
`assertReservedCovers`를 지워 `Quantity.minus`가 알아서 던지게 둔다.
Expected: FAIL — `'예약보다 많이 확정하면 StockCounterMismatchError다'`와 `.not.toThrow(DomainError)` 단언이 실패한다(`NegativeQuantityError`가 나온다). 이 회귀는 데이터 손상을 409로 보고해 클라이언트가 재시도하게 만든다.
되돌린다.

**(c) 멱등성이 실제로 있는가**
`reservation.ts`의 `confirm`에서 `CONFIRMED`일 때 `false`를 돌려주는 분기를 지우고 던지게 만든다.
Expected: FAIL — `'confirm을 두 번 부르면 두 번째는 false'`가 실패한다. 이 회귀는 **at-least-once 배달이 정상 동작하는 시스템에서 주문 하나를 실패시킨다.**
되돌린다.

**(d) 만료 이벤트가 한 번만 나는가**
`expire`에서 `PENDING` 검사를 지워 항상 이벤트를 쌓게 만든다.
Expected: FAIL — `'expire를 두 번 부르면 이벤트를 또 쌓지 않는다'`와 `'CONFIRMED인 예약에 expire하면 이벤트가 없다'`가 실패한다. 후자가 특히 중요하다 — 결제가 끝난 예약을 만료 이벤트로 알리면 Ordering이 성공한 주문을 실패 처리한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/inventory/domain
git commit -m "feat(inventory): StockItem과 Reservation 도메인 모델을 추가한다"
```

---

### Task 7: Inventory 애플리케이션 — 포트와 fake

**Files:**
- Create: `apps/api/src/modules/inventory/application/ports/out/stock.repository.ts`
- Create: `apps/api/src/modules/inventory/application/ports/out/reservation.repository.ts`
- Create: `apps/api/src/modules/inventory/application/ports/port-tokens.spec.ts`
- Create: `apps/api/src/modules/inventory/testing/in-memory-stock.repository.ts`
- Create: `apps/api/src/modules/inventory/testing/in-memory-reservation.repository.ts`
- Create: `apps/api/src/modules/inventory/testing/stock-repository.contract.ts`
- Create: `apps/api/src/modules/inventory/testing/reservation-repository.contract.ts`
- Create: `apps/api/src/modules/inventory/testing/in-memory-stock.repository.spec.ts`
- Create: `apps/api/src/modules/inventory/testing/in-memory-reservation.repository.spec.ts`
- Create: `apps/api/src/modules/inventory/testing/inventory.fixtures.ts`
- Modify: `apps/api/src/modules/inventory/domain/stock.errors.ts` (`StockNotFoundError` 추가)

**Interfaces:**
- Produces (태스크 8·9·11·12가 전부 이 시그니처에 의존한다):
  - `StockRepository`:
    - `mutate<T>(skuId, tx, change: (stock: StockItem) => T): Promise<T>`
    - `findBySkuId(skuId, tx?): Promise<StockItem | null>`
    - `create(stock, tx?): Promise<void>`
    - `STOCK_REPOSITORY`
  - `ReservationRepository`:
    - `findById(id, tx?): Promise<Reservation | null>`
    - `save(reservation, tx?): Promise<void>`
    - `findExpired(now: Date, limit: number, tx?): Promise<Reservation[]>`
    - `RESERVATION_REPOSITORY`
  - `StockNotFoundError`(`CODE='STOCK_NOT_FOUND'`)
  - fake: `InMemoryStockRepository`, `InMemoryReservationRepository`
  - 계약: `stockRepositoryContract(name, createRepo, runInTransaction?)`, `reservationRepositoryContract(name, createRepo, runInTransaction?)`

**`mutate`가 이 계획에서 가장 중요한 설계 결정이다 — 보완 1을 여기서 코드로 만든다**

포트를 `findBySkuId` + `save`로 쪼개면 낙관적 재시도를 어댑터 안에 가둘 수 없다. 버전 충돌이 나면 **다시 읽고 도메인 판단을 다시 해야** 하는데, `save`만 재시도하면 낡은 데이터로 내린 결정을 그대로 다시 쓴다. 재시도를 유스케이스로 올리면 이번엔 락 전략이 애플리케이션 계층으로 샌다.

그래서 포트가 읽기-수정-쓰기 한 사이클을 통째로 받는다. 유스케이스는 이렇게 쓴다.

```ts
const reservation = await this.stocks.mutate(skuId, tx, (stock) => {
  stock.reserve(quantity);              // 여기서 InsufficientStockError가 날 수 있다
  return Reservation.create({ ... });
});
```

세 어댑터가 같은 계약을 통과하되 안쪽은 전혀 다르다.

| 어댑터 | `mutate`의 내부 |
|---|---|
| in-memory | 맵에서 꺼내 `change` 실행 후 되돌려 넣는다 |
| 비관적 | `SELECT ... FOR UPDATE`로 행을 잠그고 `change`를 한 번 실행한다 |
| 낙관적 | 읽고 `change` 실행, `UPDATE ... WHERE version = <읽은 값>`, 0행이면 **처음부터 다시** |

**`change`가 던지면 아무것도 저장되지 않는다.** 재고 부족으로 예약이 거절될 때가 그 경로이고, 계약이 그것을 고정한다.

- [ ] **Step 1: 포트 두 개와 `StockNotFoundError`를 만든다**

`stock.repository.ts`:

```ts
import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { StockItem } from '../../../domain/stock-item';

export interface StockRepository {
  /**
   * `skuId`의 재고를 읽어 `change`를 적용하고 저장한 뒤, `change`의 반환값을 돌려준다.
   *
   * **읽기-수정-쓰기 한 사이클을 통째로 어댑터가 소유한다.** 이 형태가 아니면
   * 낙관적 재시도를 어댑터 안에 가둘 수 없다 — 버전이 충돌하면 다시 읽고 도메인
   * 판단을 다시 해야 하는데, `save`만 재시도하면 낡은 데이터로 내린 결정을 그대로
   * 다시 쓰게 된다. 재시도를 유스케이스로 올리면 락 전략이 애플리케이션으로 샌다.
   *
   * `change`가 던지면 아무것도 저장되지 않는다. 재고 부족으로 예약이 거절되는 경로가
   * 그것이다.
   *
   * `tx`가 필수인 이유: 재고 카운터 갱신과 예약 행 생성은 같은 트랜잭션이어야 한다.
   * 갈라지면 카운터와 예약이 어긋나고, 그 손상은 `StockCounterMismatchError`(500)로만
   * 드러난다.
   */
  mutate<T>(skuId: SkuId, tx: TransactionContext, change: (stock: StockItem) => T): Promise<T>;

  /** 조회 전용. 잠그지 않는다. */
  findBySkuId(skuId: SkuId, tx?: TransactionContext): Promise<StockItem | null>;

  /** 초기 시딩. 이미 있으면 던진다. */
  create(stock: StockItem, tx?: TransactionContext): Promise<void>;
}

export const STOCK_REPOSITORY = Symbol('StockRepository');
```

`reservation.repository.ts`:

```ts
import type { ReservationId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Reservation } from '../../../domain/reservation';

export interface ReservationRepository {
  findById(id: ReservationId, tx?: TransactionContext): Promise<Reservation | null>;
  save(reservation: Reservation, tx?: TransactionContext): Promise<void>;

  /**
   * `expires_at <= now`이면서 아직 `PENDING`인 예약을 오래된 것부터 최대 `limit`개.
   *
   * TTL 자가치유가 이것을 스캔한다(스펙 §6.2의 5단계). `limit`이 있는 이유는
   * 스케줄러가 한 번에 처리할 양을 제한해야 하기 때문이다 — 장애 후 만료가 수만 건
   * 밀려 있을 때 한 트랜잭션에 다 넣으면 그 트랜잭션이 영원히 끝나지 않는다.
   */
  findExpired(now: Date, limit: number, tx?: TransactionContext): Promise<Reservation[]>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');
```

`stock.errors.ts`에 추가:

```ts
/**
 * 그 SKU의 재고 행이 없다. 카탈로그에 SKU는 있는데 재고를 한 번도 등록하지 않은
 * 경우가 대부분이다. 사용자 입장에서는 살 수 없는 상품이므로 404다.
 */
export class StockNotFoundError extends DomainError {
  static readonly CODE = 'STOCK_NOT_FOUND';
  readonly code = StockNotFoundError.CODE;

  constructor(skuId: string) {
    super(`재고를 찾을 수 없습니다: ${skuId}`);
  }
}
```

- [ ] **Step 2: `port-tokens.spec.ts`를 만든다**

계획 2의 identity/customer와 같은 형태. 이 태스크 시점에는 아웃바운드 토큰 둘뿐이고, 태스크 8·9가 인바운드 토큰을 더할 때마다 이 파일을 확장한다.

- [ ] **Step 3: `stock-repository.contract.ts`를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../shared/kernel/quantity';
import type { StockRepository } from '../application/ports/out/stock.repository';
import { InsufficientStockError, StockNotFoundError } from '../domain/stock.errors';
import { StockItem } from '../domain/stock-item';

const q = (n: number) => Quantity.of(n);
const sku = (suffix: string) => SkuId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d5c${suffix}`);

/**
 * `StockRepository`의 계약. **세 구현이 통과해야 한다** — in-memory fake, 비관적
 * Prisma 어댑터, 낙관적 Prisma 어댑터. 락 전략이 다르다는 것이 관측 가능한 동작의
 * 차이로 새어 나오면 안 된다는 것이 이 스위트의 주장이다.
 *
 * `createRepo`는 매 테스트마다 **비어 있는** 리포지토리를 돌려줘야 한다.
 * `runInTransaction`이 없으면 롤백 케이스를 건너뛴다.
 */
export function stockRepositoryContract(
  name: string,
  createRepo: () => Promise<StockRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  // 트랜잭션 없이 mutate를 부르기 위한 최소 러너. in-memory는 tx를 무시하고,
  // Prisma 어댑터는 진짜 트랜잭션을 연다.
  const run = <T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> =>
    runInTransaction ? runInTransaction(work) : work({} as TransactionContext);

  describe(`StockRepository 계약 — ${name}`, () => {
    it('생성한 재고를 SKU ID로 찾는다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000001'), onHand: q(10) }));

      const found = await repo.findBySkuId(sku('000001'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(0);
    });

    it('없는 SKU는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findBySkuId(sku('009999'))).toBeNull();
    });

    it('보유량과 예약량이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000002'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('000002'), tx, (stock) => stock.reserve(q(4))));

      const found = await repo.findBySkuId(sku('000002'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(4);
      expect(found?.available.value).toBe(6);
    });

    it('mutate가 change의 반환값을 그대로 돌려준다', async () => {
      // 예약 유스케이스가 mutate 안에서 Reservation을 만들어 돌려받는다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000003'), onHand: q(10) }));

      const result = await run((tx) =>
        repo.mutate(sku('000003'), tx, (stock) => {
          stock.reserve(q(2));
          return `예약됨:${stock.reserved.value}`;
        }),
      );
      expect(result).toBe('예약됨:2');
    });

    it('없는 SKU를 mutate하면 StockNotFoundError다', async () => {
      const repo = await createRepo();
      await expect(
        run((tx) => repo.mutate(sku('009998'), tx, (stock) => stock.reserve(q(1)))),
      ).rejects.toThrow(StockNotFoundError);
    });

    it('change가 던지면 아무것도 저장되지 않는다', async () => {
      // 재고 부족으로 예약이 거절되는 경로다. 여기서 부분 저장이 일어나면
      // 실패한 예약이 재고를 갉아먹는다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000004'), onHand: q(3) }));

      await expect(
        run((tx) => repo.mutate(sku('000004'), tx, (stock) => stock.reserve(q(5)))),
      ).rejects.toThrow(InsufficientStockError);

      const found = await repo.findBySkuId(sku('000004'));
      expect(found?.reserved.value).toBe(0);
      expect(found?.onHand.value).toBe(3);
    });

    it('연속된 mutate가 누적된다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000005'), onHand: q(10) }));

      await run((tx) => repo.mutate(sku('000005'), tx, (stock) => stock.reserve(q(2))));
      await run((tx) => repo.mutate(sku('000005'), tx, (stock) => stock.reserve(q(3))));

      expect((await repo.findBySkuId(sku('000005')))?.reserved.value).toBe(5);
    });

    it('확정은 보유량과 예약량을 함께 줄인다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000006'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('000006'), tx, (stock) => stock.reserve(q(4))));
      await run((tx) => repo.mutate(sku('000006'), tx, (stock) => stock.confirm(q(4))));

      const found = await repo.findBySkuId(sku('000006'));
      expect(found?.onHand.value).toBe(6);
      expect(found?.reserved.value).toBe(0);
    });

    it('해제는 예약량만 줄인다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000007'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('000007'), tx, (stock) => stock.reserve(q(4))));
      await run((tx) => repo.mutate(sku('000007'), tx, (stock) => stock.release(q(4))));

      const found = await repo.findBySkuId(sku('000007'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(0);
    });

    it('같은 SKU를 두 번 create하면 던진다', async () => {
      // 재고 행이 조용히 덮어써지면 관리자가 입고를 두 번 눌렀을 때 보유량이 사라진다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000008'), onHand: q(10) }));
      await expect(
        repo.create(StockItem.create({ skuId: sku('000008'), onHand: q(99) })),
      ).rejects.toThrow();
    });

    it('mutate가 돌려준 StockItem을 나중에 바꿔도 저장본은 안 바뀐다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('000009'), onHand: q(10) }));

      const escaped = await run((tx) =>
        repo.mutate(sku('000009'), tx, (stock) => {
          stock.reserve(q(1));
          return stock; // 애그리거트를 밖으로 내보낸다 — 하면 안 되는 일이지만 막을 수는 없다
        }),
      );
      escaped.reserve(q(5));

      expect((await repo.findBySkuId(sku('000009')))?.reserved.value).toBe(1);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 재고 변경이 남지 않는다',
      async () => {
        const runner = runInTransaction;
        if (!runner) return;
        const repo = await createRepo();
        await repo.create(StockItem.create({ skuId: sku('000010'), onHand: q(10) }));

        await expect(
          runner(async (tx) => {
            await repo.mutate(sku('000010'), tx, (stock) => stock.reserve(q(3)));
            throw new Error('의도적 롤백');
          }),
        ).rejects.toThrow('의도적 롤백');

        expect((await repo.findBySkuId(sku('000010')))?.reserved.value).toBe(0);
      },
    );
  });
}
```

- [ ] **Step 4: `reservation-repository.contract.ts`를 쓴다**

아래를 덮는다. 각 항목에 이유 주석을 단다.
- 저장한 예약을 ID로 찾는다 / 없는 ID는 `null`
- 상태·수량·`expiresAt`·`createdAt`·`orderId`·`skuId`가 왕복해도 보존된다
- 확정한 예약을 다시 저장하면 갱신된다(행이 늘지 않는다)
- 복원된 예약은 미커밋 이벤트를 갖지 않는다 — 갖는다면 조회할 때마다 만료 이벤트가 outbox에 다시 들어간다
- **`findExpired`가 `expires_at <= now`이면서 `PENDING`인 것만 돌려준다** — `CONFIRMED`/`RELEASED`/`EXPIRED`는 제외된다
- `findExpired`가 아직 만료되지 않은 예약을 제외한다
- `findExpired`가 `expires_at` 오름차순으로 돌려준다(오래된 것부터 처리해야 밀린 큐가 줄어든다)
- `findExpired`의 `limit`이 동작한다
- 롤백 케이스(`skipIf`)

- [ ] **Step 5: fake 두 개를 구현하고 통과를 확인한다**

`InMemoryStockRepository.mutate`는 저장본을 **복사해** `change`에 넘기고, 성공하면 그 복사본을 되돌려 넣는다. 원본을 넘기면 `change`가 던졌을 때 부분 변경이 남아 계약의 `'change가 던지면 아무것도 저장되지 않는다'`가 깨진다.

Run: `pnpm vitest run --project api-unit apps/api/src/modules/inventory/`
Expected: PASS — 재고 계약 11개 + 예약 계약 9개(각각 롤백 1개는 스킵).

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) `mutate`의 원자성이 실제로 있는가**
`InMemoryStockRepository.mutate`가 복사본이 아니라 저장본을 그대로 `change`에 넘기게 바꾼다.
Expected: FAIL — `'change가 던지면 아무것도 저장되지 않는다'`가 실패한다.
되돌린다.

**(b) `findExpired`의 상태 필터가 있는가**
`InMemoryReservationRepository.findExpired`에서 `status === 'PENDING'` 조건을 지운다.
Expected: FAIL — `'PENDING인 것만 돌려준다'`가 실패한다. 이 회귀는 **이미 확정된 예약을 TTL이 만료시켜 재고를 두 번 돌려주게** 만든다 — 초과 판매의 직행 경로다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): 재고·예약 포트와 계약 테스트를 통과하는 fake를 추가한다"
```

---

### Task 8: Inventory 애플리케이션 — 예약·확정·해제

**Files:**
- Modify: `apps/api/src/modules/inventory/domain/stock.errors.ts` (`ReservationNotFoundError` 추가 — `CODE='RESERVATION_NOT_FOUND'`, `DomainError`, 404)
- Create: `apps/api/src/modules/inventory/application/ports/in/reserve-stock.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/ports/in/confirm-reservation.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/ports/in/release-reservation.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/services/reserve-stock.service.ts` + spec
- Create: `apps/api/src/modules/inventory/application/services/confirm-reservation.service.ts` + spec
- Create: `apps/api/src/modules/inventory/application/services/release-reservation.service.ts` + spec
- Modify: `apps/api/src/modules/inventory/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces:
  - `ReserveStockUseCase { execute({ skuId: string; orderId: string; quantity: number }): Promise<{ reservationId: string; expiresAt: Date }> }`, `RESERVE_STOCK_USECASE`
  - `ConfirmReservationUseCase { execute({ reservationId: string }): Promise<void> }`, `CONFIRM_RESERVATION_USECASE`
  - `ReleaseReservationUseCase { execute({ reservationId: string }): Promise<void> }`, `RELEASE_RESERVATION_USECASE`
  - 생성자: `ReserveStockService(stocks, reservations, transactions, clock, ids, reservationTtl)`, `ConfirmReservationService(stocks, reservations, transactions, clock)`, `ReleaseReservationService(stocks, reservations, transactions, clock)`
  - `ReservationNotFoundError`(`CODE='RESERVATION_NOT_FOUND'`)

**이 태스크가 고정하는 성질**

1. **예약 행 생성과 `reserved` 카운터 증가는 같은 트랜잭션이다.** 편차 4가 감수하기로 한 비정규화의 대가가 여기서 청구된다. 갈라지면 카운터와 예약이 어긋나고 그 손상은 `StockCounterMismatchError`(500)로만 드러난다.
2. **TTL은 유스케이스가 아니라 생성자로 주입된다.** 스펙 §6.2의 15분이 기본값이고, 테스트는 짧은 TTL을 넣어 만료를 즉시 재현한다. 하드코딩하면 만료 테스트가 15분을 기다려야 한다.
3. **확정과 해제는 멱등하다.** `reservation.confirm(now)`가 `false`를 돌려주면 **재고 카운터를 건드리지 않고 그대로 끝낸다.** Outbox가 at-least-once라 같은 이벤트가 두 번 오는 것이 정상이고, 그때 카운터를 두 번 줄이면 재고가 조용히 사라진다.
4. **`ReservationNotFoundError`는 404다.** 이벤트 핸들러가 없는 예약 ID를 받는 것은 정상 경로에서 일어나지 않으므로, 이것이 나면 데이터가 어긋난 것이거나 잘못된 요청이다.

- [ ] **Step 1: `ReserveStockService`를 구현한다**

```ts
export class ReserveStockService implements ReserveStockUseCase {
  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly reservationTtl: Duration,
  ) {}

  async execute(command: ReserveStockCommand): Promise<{ reservationId: string; expiresAt: Date }> {
    const skuId = SkuId.of(command.skuId);
    const orderId = OrderId.of(command.orderId);
    const quantity = Quantity.positive(command.quantity);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      // 카운터 증가와 예약 행 생성이 한 트랜잭션 안에 있다. 갈라지면 둘이 어긋난다.
      const reservation = await this.stocks.mutate(skuId, tx, (stock) => {
        stock.reserve(quantity); // 재고 부족이면 여기서 InsufficientStockError
        return Reservation.create({
          id: ReservationId.of(this.ids.nextId()),
          skuId,
          orderId,
          quantity,
          now,
          ttl: this.reservationTtl,
        });
      });
      await this.reservations.save(reservation, tx);
      return { reservationId: reservation.id, expiresAt: reservation.expiresAt };
    });
  }
}
```

- [ ] **Step 2: `ConfirmReservationService` / `ReleaseReservationService`를 구현한다**

둘은 같은 골격이고 도메인 메서드와 재고 연산만 다르다.

```ts
async execute(command: { reservationId: string }): Promise<void> {
  const id = ReservationId.of(command.reservationId);
  const now = this.clock.now();

  await this.transactions.run(async (tx) => {
    const reservation = await this.reservations.findById(id, tx);
    if (reservation === null) {
      throw new ReservationNotFoundError(id);
    }

    // 전이가 실제로 일어났을 때만 재고를 건드린다. 이벤트가 두 번 배달되면
    // 두 번째는 false가 돌아오고, 여기서 카운터를 또 줄이면 재고가 사라진다.
    if (!reservation.confirm(now)) {
      return;
    }

    await this.stocks.mutate(reservation.skuId, tx, (stock) => stock.confirm(reservation.quantity));
    await this.reservations.save(reservation, tx);
  });
}
```

- [ ] **Step 3: spec 세 개를 쓴다**

계획 2의 서비스 spec 형태를 따른다. 덮어야 할 것:

`reserve-stock.service.spec.ts`
- 예약이 저장되고 재고 카운터가 늘어난다(저장본을 다시 읽어 확인한다)
- `expiresAt`이 주입된 `Clock` + 주입된 TTL이다
- `reservationId`가 주입된 `IdGenerator`에서 나온다
- **재고 부족이면 `InsufficientStockError`이고 예약 행이 하나도 저장되지 않는다**
- 수량 0이면 `QuantityBelowMinimumError`(`Quantity.positive`가 던진다)이고 아무것도 저장되지 않는다
- 없는 SKU면 `StockNotFoundError`
- 가용 재고를 정확히 다 쓰는 예약은 성공한다

`confirm-reservation.service.spec.ts`
- 확정하면 예약 상태가 `CONFIRMED`가 되고 보유량·예약량이 함께 준다
- **두 번 확정해도 재고가 한 번만 줄어든다** — 이벤트 재배달 시나리오
- 없는 예약이면 `ReservationNotFoundError`
- 이미 해제된 예약을 확정하면 `ReservationConflictError`이고 재고는 그대로다

`release-reservation.service.spec.ts`
- 해제하면 예약 상태가 `RELEASED`가 되고 예약량만 준다(보유량은 그대로)
- **두 번 해제해도 재고가 한 번만 돌아온다**
- 이미 확정된 예약을 해제하면 `ReservationConflictError`이고 재고는 그대로다

- [ ] **Step 4: 이 검사가 무엇을 잡는지 증명한다**

**(a) 멱등성이 카운터까지 지키는가**
`confirm-reservation.service.ts`의 `if (!reservation.confirm(now)) { return; }`를 `reservation.confirm(now);`로 바꾼다(반환값을 무시한다).
Expected: FAIL — `'두 번 확정해도 재고가 한 번만 줄어든다'`가 실패한다. 이 회귀는 **정상 동작하는 at-least-once 배달에서 재고를 조용히 사라지게** 만든다.
되돌린다.

**(b) 예약과 카운터가 같은 트랜잭션인가**
`reserve-stock.service.ts`에서 `await this.reservations.save(reservation, tx)`의 `, tx`를 지운다.
Expected: 단위 테스트는 `PassthroughTransactionManager`를 쓰므로 **전부 통과한다.** 그 사실을 확인하고 보고서에 적는다 — 이 성질은 태스크 11·12의 통합 테스트(진짜 롤백)에서만 검증된다. 계약 스위트의 롤백 케이스가 그 자리다.
되돌린다.

**(c) 실패한 예약이 재고를 갉아먹지 않는가**
`stock-item.ts`의 `reserve`에서 검사를 갱신 뒤로 옮긴다(태스크 6의 프루브 (a)와 같은 변경).
Expected: FAIL — `'재고 부족이면 InsufficientStockError이고 예약 행이 하나도 저장되지 않는다'`가 재고 카운터가 늘어난 채라며 실패한다. **태스크 6에서는 도메인 단위로, 여기서는 유스케이스 전체로 같은 성질이 두 번 고정된다는 것을 확인한다.**
되돌린다.

- [ ] **Step 5: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): 재고 예약·확정·해제 유스케이스를 추가한다"
```

---

### Task 9: Inventory 애플리케이션 — TTL 자가치유

**Files:**
- Create: `apps/api/src/modules/inventory/application/ports/in/expire-reservations.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/services/expire-reservations.service.ts` + spec
- Modify: `apps/api/src/modules/inventory/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces: `ExpireReservationsUseCase { execute(): Promise<number> }`(만료 처리한 건수를 돌려준다), `EXPIRE_RESERVATIONS_USECASE`, 생성자 `ExpireReservationsService(stocks, reservations, events, transactions, clock, batchSize)`

**이것이 스펙 §6.2가 "설계의 요체"라고 부른 5단계다**

> 어느 단계든 유실되면 → TTL 만료 스케줄러가 예약을 자동 해제
>
> **5번이 설계의 요체다.** 보상 트랜잭션 자체가 실패해도(서버가 죽어도) TTL이 결국 재고를 회복시킨다. **보상 로직을 신뢰할 수 없다는 전제로 설계한다.**

그래서 이 유스케이스는 다른 어떤 것에도 의존하지 않는다. Ordering이 죽어 있어도, 이벤트가 유실돼도, 결제 콜백이 영영 오지 않아도 재고는 돌아온다.

**설계 결정 — 예약 하나당 트랜잭션 하나다.** 배치 전체를 한 트랜잭션에 넣으면 (1) 한 건이 실패할 때 이미 회복시킨 재고까지 되돌아가고 (2) 밀린 만료가 수만 건일 때 그 트랜잭션이 끝나지 않는다. 계획 1의 `OutboxRelay`가 행 단위로 실패를 격리한 것과 같은 판단이다 — 그때 배운 것은 "한 건의 영구 실패가 뒤의 전부를 막으면 안 된다"였다.

**설계 결정 — 이벤트는 만료와 같은 트랜잭션에서 outbox에 넣는다.** `reservation.expire(now)`가 쌓은 이벤트를 `events.publish(reservation.pullEvents(), tx)`로 보낸다. 갈라지면 재고는 돌아왔는데 Ordering은 주문이 실패한 줄 모르고 영원히 `PENDING_PAYMENT`로 남는다(스펙 §6.3).

- [ ] **Step 1: 실패 테스트를 쓴다**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Duration } from '../../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { Reservation } from '../../domain/reservation';
import { STOCK_RESERVATION_EXPIRED } from '../../domain/stock.events';
import { StockItem } from '../../domain/stock-item';
import { InMemoryReservationRepository } from '../../testing/in-memory-reservation.repository';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import { ExpireReservationsService } from './expire-reservations.service';

const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.minutes(15);
const SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const q = (n: number) => Quantity.of(n);

function build(batchSize = 100) {
  const stocks = new InMemoryStockRepository();
  const reservations = new InMemoryReservationRepository();
  const events = new RecordingEventPublisher();
  const clock = new MutableClock(NOW);
  const service = new ExpireReservationsService(
    stocks,
    reservations,
    events,
    new PassthroughTransactionManager(),
    clock,
    batchSize,
  );
  return { service, stocks, reservations, events, clock };
}

async function seed(
  stocks: InMemoryStockRepository,
  reservations: InMemoryReservationRepository,
  suffix: string,
  quantity: number,
): Promise<Reservation> {
  const existing = await stocks.findBySkuId(SKU);
  if (existing === null) {
    await stocks.create(StockItem.create({ skuId: SKU, onHand: q(100) }));
  }
  await stocks.mutate(SKU, {} as never, (stock) => stock.reserve(q(quantity)));
  const reservation = Reservation.create({
    id: ReservationId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d5e${suffix}`),
    skuId: SKU,
    orderId: OrderId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d0e${suffix}`),
    quantity: q(quantity),
    now: NOW,
    ttl: TTL,
  });
  reservation.pullEvents();
  await reservations.save(reservation);
  return reservation;
}

describe('ExpireReservationsService', () => {
  it('아직 만료되지 않았으면 아무것도 하지 않는다', async () => {
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '000001', 3);

    clock.advanceBy(Duration.minutes(14));
    expect(await service.execute()).toBe(0);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(3);
  });

  it('TTL이 지나면 예약을 만료시키고 재고를 되돌린다', async () => {
    // 스펙 §6.2의 5단계. 보상 트랜잭션이 전부 실패해도 이것이 재고를 회복시킨다.
    const { service, stocks, reservations, clock } = build();
    const reservation = await seed(stocks, reservations, '000002', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(1);

    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
    expect((await stocks.findBySkuId(SKU))?.onHand.value).toBe(100); // 보유량은 안 건드린다
    expect((await reservations.findById(reservation.id))?.status).toBe('EXPIRED');
  });

  it('만료마다 StockReservationExpired를 트랜잭션과 함께 발행한다', async () => {
    // tx가 없으면 재고는 돌아왔는데 Ordering은 주문 실패를 모르고 영원히
    // PENDING_PAYMENT로 남는다(스펙 §6.3).
    const { service, stocks, reservations, events, clock } = build();
    const reservation = await seed(stocks, reservations, '000003', 3);

    clock.advanceBy(Duration.minutes(16));
    await service.execute();

    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.eventType).toBe(STOCK_RESERVATION_EXPIRED);
    expect(events.published[0]?.payload).toEqual({
      reservationId: reservation.id,
      skuId: SKU,
      orderId: reservation.orderId,
      quantity: 3,
    });
    expect(events.publishCalls[0]?.tx).toBeDefined();
  });

  it('이미 확정된 예약은 만료시키지 않는다', async () => {
    // 결제가 끝난 예약을 TTL이 뒤늦게 만료시키면 재고가 두 번 돌아가고
    // Ordering은 성공한 주문을 실패로 처리한다.
    const { service, stocks, reservations, clock } = build();
    const reservation = await seed(stocks, reservations, '000004', 3);
    reservation.confirm(NOW);
    await stocks.mutate(SKU, {} as never, (stock) => stock.confirm(q(3)));
    await reservations.save(reservation);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(0);
    expect((await reservations.findById(reservation.id))?.status).toBe('CONFIRMED');
  });

  it('두 번 돌려도 재고가 한 번만 돌아온다', async () => {
    // 스케줄러는 겹쳐 돌 수 있다. 두 번째 실행은 이미 EXPIRED인 예약을 보지 않아야 한다.
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '000005', 3);

    clock.advanceBy(Duration.minutes(16));
    await service.execute();
    expect(await service.execute()).toBe(0);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });

  it('여러 건을 한 번에 만료시킨다', async () => {
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '000006', 2);
    await seed(stocks, reservations, '000007', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(2);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });

  it('batchSize를 넘겨 받지 않는다', async () => {
    // 장애 후 만료가 수만 건 밀려 있을 때 한 번에 다 처리하려 들면
    // 그 실행이 끝나지 않고 다음 주기가 겹쳐 들어온다.
    const { service, stocks, reservations, clock } = build(1);
    await seed(stocks, reservations, '000008', 2);
    await seed(stocks, reservations, '000009', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(1);
    expect(await service.execute()).toBe(1);
  });

  it('한 건이 실패해도 나머지는 처리한다', async () => {
    // 예약 하나당 트랜잭션 하나인 이유다. 한 건의 영구 실패가 뒤의 전부를 막으면
    // 밀린 만료가 영원히 풀리지 않는다 — 계획 1의 OutboxRelay가 행 단위로 실패를
    // 격리한 것과 같은 판단이다.
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '000010', 2);
    const doomed = await seed(stocks, reservations, '000011', 3);
    // 재고 카운터를 어긋나게 만들어 이 건만 StockCounterMismatchError가 나게 한다.
    await stocks.mutate(SKU, {} as never, (stock) => stock.release(q(3)));

    clock.advanceBy(Duration.minutes(16));
    const expired = await service.execute();

    expect(expired).toBe(1);
    expect((await reservations.findById(doomed.id))?.status).toBe('PENDING');
  });
});
```

- [ ] **Step 2: 실패를 확인하고 구현한다**

```ts
export class ExpireReservationsService implements ExpireReservationsUseCase {
  private readonly logger = new Logger(ExpireReservationsService.name);

  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly batchSize: number = 100,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const expired = await this.reservations.findExpired(now, this.batchSize);

    let released = 0;
    for (const reservation of expired) {
      try {
        // 예약 하나당 트랜잭션 하나. 배치 전체를 묶으면 한 건의 실패가 이미
        // 회복시킨 재고까지 되돌리고, 밀린 만료가 수만 건일 때 끝나지 않는다.
        await this.transactions.run(async (tx) => {
          if (!reservation.expire(now)) {
            return;
          }
          await this.stocks.mutate(reservation.skuId, tx, (stock) =>
            stock.release(reservation.quantity),
          );
          await this.reservations.save(reservation, tx);
          // 같은 트랜잭션에서 outbox에 넣는다. 갈라지면 재고는 돌아왔는데
          // Ordering은 주문 실패를 모르고 영원히 PENDING_PAYMENT로 남는다.
          await this.events.publish(reservation.pullEvents(), tx);
        });
        released += 1;
      } catch (error) {
        // 한 건의 실패가 나머지를 막지 않는다. 다음 주기가 다시 시도한다 —
        // 예약은 여전히 PENDING이고 expires_at도 그대로이므로 스캔에 또 걸린다.
        this.logger.error(
          `예약 만료 처리 실패 (reservationId=${reservation.id}): ${String(error)}`,
        );
      }
    }
    return released;
  }
}
```

`Logger`는 `@nestjs/common`에서 온다 — `application/**`이 `@nestjs/*`를 import해도 되는가? **된다.** 경계 규칙(`application-knows-no-adapters`)이 막는 것은 `adapters/**`, `@prisma/client`, `shared/infrastructure/**`이고, 스펙 §7.7이 "로거는 포트가 아니다. Nest Logger를 직접 쓴다"고 명시했다. 다만 `pnpm arch:check`가 이 import를 실제로 허용하는지 **첫 실행에서 확인하고**, 막힌다면 로깅을 스케줄러 어댑터(태스크 15)로 올리고 유스케이스는 실패 건수를 반환값에 담는 형태로 바꾼 뒤 그 사실을 보고한다.

- [ ] **Step 3: 이 검사가 무엇을 잡는지 증명한다**

**(a) 확정된 예약을 만료시키지 않는가**
`reservation.ts`의 `expire`에서 `PENDING` 검사를 지운다.
Expected: FAIL — `'이미 확정된 예약은 만료시키지 않는다'`가 실패한다. 이 회귀는 **결제가 끝난 주문의 재고를 두 번 돌려주고** Ordering에 거짓 실패를 알린다.
되돌린다.

**(b) 건별 실패 격리가 실제로 있는가**
`execute`의 `try`/`catch`를 걷어낸다.
Expected: FAIL — `'한 건이 실패해도 나머지는 처리한다'`가 예외가 밖으로 새어 실패한다.
되돌린다.

**(c) 이벤트가 트랜잭션과 함께 나가는가**
`events.publish(reservation.pullEvents(), tx)`에서 `, tx`를 지운다.
Expected: FAIL — `'트랜잭션과 함께 발행한다'`가 `publishCalls[0].tx`가 `undefined`라며 실패한다.
되돌린다.

- [ ] **Step 4: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): TTL 만료 자가치유 유스케이스를 추가한다"
```

---

### Task 10: `PrismaReservationRepository`

**Files:**
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/reservation.mapper.ts` + spec
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/prisma-reservation.repository.ts`
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/prisma-reservation.repository.integration.spec.ts`

**Interfaces:**
- Consumes: `ReservationRepository` 포트, `reservationRepositoryContract`(태스크 7), `asPrismaClient`, `PrismaTransactionManager`, `testDb()`
- Produces: `toReservationDomain(row)`, `toReservationRow(reservation)`, `PrismaReservationRepository(prisma)`

**`findExpired`가 이 태스크의 핵심이다.** 태스크 3이 `reservations_expires_at_idx`를 만들고 EXPLAIN 프루브로 감시하는데, **그 프루브의 쿼리와 이 메서드가 내는 쿼리가 같은 모양이어야 한다.** 계획 2의 태스크 9에서 프루브가 실제 릴레이 쿼리와 달라 Important 지적을 받았다 — 이름이 검증 내용보다 많은 것을 약속하는 검사였다.

```ts
async findExpired(now: Date, limit: number, tx?: TransactionContext): Promise<Reservation[]> {
  const rows = await this.client(tx).reservation.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },   // 오래된 것부터 — 밀린 큐가 줄어드는 방향
    take: limit,
  });
  return rows.map(toReservationDomain);
}
```

- [ ] **Step 1: 계약을 Prisma 위에 돌리는 통합 spec을 쓰고 실패를 확인한다**

```ts
reservationRepositoryContract(
  'prisma',
  async () => new PrismaReservationRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
```

- [ ] **Step 2: 매퍼를 구현한다**

`ReservationId.fromPersistence` / `SkuId.fromPersistence` / `OrderId.fromPersistence`를 쓴다 — `.of`를 쓰면 깨진 저장 행이 400을 내고 클라이언트에게 거짓말한다. `quantity`는 `Quantity.of(row.quantity)`로 복원한다(0도 유효한 값이지만 예약은 1 이상이므로 손상 감지가 필요하면 `positive`를 쓰되, 그러면 실패가 `QuantityBelowMinimumError`(422 DomainError)가 되어 분류가 틀린다 — **`of`를 쓰고, 0인 예약 행은 도메인이 아니라 데이터 문제라는 판단을 주석에 적는다**).

`reservation.mapper.spec.ts`는 왕복 보존, `null`이 아닌 모든 필드 보존, 깨진 UUID가 `DomainError`가 **아닌** 예외를 던짐, 복원된 예약이 미커밋 이벤트를 갖지 않음을 확인한다.

- [ ] **Step 3: 리포지토리를 구현하고 통과를 확인한다**

`save`는 `upsert`다. `findById`는 `findUnique`.

Run: `pnpm test:int apps/api/src/modules/inventory`
Expected: PASS — 예약 계약 9개(롤백 포함).

- [ ] **Step 4: EXPLAIN 프루브와 실제 쿼리를 대조한다**

`apps/api/test/schema/indexes.integration.spec.ts`의 만료 스캔 EXPLAIN 쿼리를 열어 `findExpired`가 내는 것과 대조한다. `WHERE`, `ORDER BY`, `LIMIT`이 전부 같아야 한다. 다르면 **프루브를 실제 쿼리에 맞춘다** — 코드가 아니라 검사를 고친다. 무엇이 달랐는지 보고서에 적는다.

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 상태 필터가 있는가**
`findExpired`의 `status: 'PENDING'`을 지운다.
Expected: FAIL — 계약의 `'PENDING인 것만 돌려준다'`가 **Prisma 쪽에서 실패하고 in-memory 쪽은 통과한다**(fake는 자기 필터를 그대로 갖고 있으므로). 그 비대칭을 확인한다.
되돌린다.

**(b) 정렬이 있는가**
`orderBy`를 지운다.
Expected: `'expires_at 오름차순으로 돌려준다'`가 실패하거나 불안정해진다. 불안정하기만 하면 시드 행을 20개로 늘려 결정적으로 실패하게 만든다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): Prisma 예약 리포지토리를 추가한다"
```

---

### Task 11: `PessimisticStockRepository` — `SELECT ... FOR UPDATE`

**Files:**
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/stock.mapper.ts` + spec
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/pessimistic-stock.repository.ts`
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/pessimistic-stock.repository.integration.spec.ts`

**Interfaces:**
- Produces: `toStockDomain(row)`, `PessimisticStockRepository(prisma)`, `StockRow { skuId: string; onHand: number; reserved: number }`

**이것이 기본 전략이다.** 스펙 §6.4: "기본값을 비관적 락으로 두는 이유는 인기 상품 경합에서 낙관적 락은 재시도가 폭주하는데 재고 차감은 짧고 명확한 임계 구역이라 비관적 락이 더 맞기 때문이다."

- [ ] **Step 1: 계약을 이 어댑터에 돌리는 통합 spec을 쓴다**

```ts
stockRepositoryContract(
  'pessimistic',
  async () => new PessimisticStockRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
```

- [ ] **Step 2: `mutate`를 구현한다**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
// ...

interface StockRow {
  skuId: string;
  onHand: number;
  reserved: number;
}

export class PessimisticStockRepository implements StockRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * `SELECT ... FOR UPDATE`로 행을 잠그고 `change`를 정확히 한 번 실행한다.
   *
   * 잠금은 **트랜잭션이 끝날 때까지** 유지된다 — 그래서 `tx`가 필수다.
   * 트랜잭션 밖에서 `FOR UPDATE`를 걸면 문장이 끝나는 즉시 잠금이 풀려
   * 아무것도 지키지 못한다.
   *
   * `version` 컬럼을 읽지도 쓰지도 않는다. 스펙 §10.8이 그 컬럼을 낙관적
   * 어댑터 전용으로 못박았고, 두 어댑터를 같은 스키마 위에서 비교하려면
   * 이쪽이 그것을 무시해야 한다.
   */
  async mutate<T>(
    skuId: SkuId,
    tx: TransactionContext,
    change: (stock: StockItem) => T,
  ): Promise<T> {
    const client = asPrismaClient(tx);

    // Prisma의 쿼리 빌더에는 FOR UPDATE가 없다. 원시 SQL이 유일한 방법이다.
    const rows = await client.$queryRaw<StockRow[]>`
      SELECT sku_id AS "skuId", on_hand AS "onHand", reserved
        FROM stock_items
       WHERE sku_id = ${skuId}::uuid
         FOR UPDATE
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new StockNotFoundError(skuId);
    }

    const stock = toStockDomain(row);
    // change가 던지면 여기서 빠져나가고 UPDATE에 도달하지 않는다 —
    // 재고 부족으로 예약이 거절되는 경로가 그것이다.
    const result = change(stock);

    await client.stockItem.update({
      where: { skuId },
      data: { onHand: stock.onHand.value, reserved: stock.reserved.value },
    });
    return result;
  }

  async findBySkuId(skuId: SkuId, tx?: TransactionContext): Promise<StockItem | null> {
    const row = await this.client(tx).stockItem.findUnique({ where: { skuId } });
    return row === null ? null : toStockDomain(row);
  }

  async create(stock: StockItem, tx?: TransactionContext): Promise<void> {
    // create는 이미 있으면 P2002로 던진다 — 계약의 '두 번 create하면 던진다'가 그것이다.
    await this.client(tx).stockItem.create({
      data: { skuId: stock.skuId, onHand: stock.onHand.value, reserved: stock.reserved.value },
    });
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
```

- [ ] **Step 3: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/inventory`
Expected: PASS — 재고 계약 12개(롤백 포함)가 이 어댑터에서도 통과한다.

- [ ] **Step 4: 손상된 행이 500으로 가는지 확인하는 어댑터 전용 테스트를 더한다**

계약 스위트는 정상 데이터만 다룬다. 손상된 행은 원시 SQL로만 만들 수 있으므로 여기서 확인한다.

```ts
it('reserved > on_hand인 저장 행을 읽으면 CorruptedStockError다 — DomainError가 아니다', async () => {
  const db = await testDb();
  await db.$executeRawUnsafe(`
    INSERT INTO stock_items (sku_id, on_hand, reserved, version)
    VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d5cbad001', 3, 5, 0)
  `);
  const repo = new PessimisticStockRepository(db);

  await expect(
    repo.findBySkuId(SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5cbad001')),
  ).rejects.toThrow(CorruptedStockError);
});
```

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) `FOR UPDATE`가 실제로 있는가**
`$queryRaw`에서 `FOR UPDATE`를 지운다.
Expected: **계약 스위트는 전부 통과한다.** 계약은 순차 호출만 하므로 잠금이 없어도 결과가 같다. 이것을 확인하는 것이 이 프루브의 목적이다 — **`FOR UPDATE`의 존재를 증명하는 것은 태스크 13의 동시성 스위트뿐이다.** 관측 결과를 보고서에 적는다.
되돌린다.

**(b) `change` 실패 시 저장되지 않는가**
`const result = change(stock);`를 `let result; try { result = change(stock); } catch { result = undefined as T; }`로 바꿔 예외를 삼킨다.
Expected: FAIL — 계약의 `'change가 던지면 아무것도 저장되지 않는다'`가 실패한다(예약 카운터가 늘어난 채 저장된다).
되돌린다.

**(c) 손상 감지가 매퍼에 있는가**
`stock.mapper.ts`가 `StockItem.rehydrate` 대신 private 생성자를 우회하도록... 은 불가능하다. 대신 `stock-item.ts`의 `rehydrate`에서 `CorruptedStockError` 검사를 지운다.
Expected: FAIL — Step 4의 어댑터 테스트와 태스크 6의 `'예약이 보유량보다 큰 저장 행은 CorruptedStockError다'`가 함께 실패한다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): SELECT FOR UPDATE 기반 비관적 재고 리포지토리를 추가한다"
```

---

### Task 12: `OptimisticStockRepository` — `version` + 재시도

**Files:**
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/optimistic-stock.repository.ts`
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/optimistic-stock.repository.integration.spec.ts`
- Modify: `apps/api/src/modules/inventory/domain/stock.errors.ts` (`StockContentionError` 추가)

**Interfaces:**
- Produces: `OptimisticStockRepository(prisma, maxAttempts?)`, `readonly retries: number`, `StockContentionError`(`CODE='STOCK_CONTENTION'`)

**비교군이다.** 스펙 §6.4가 "같은 도메인 코드와 같은 동시성 테스트를 두 어댑터에 돌려 비교한다"고 한 그 두 번째 어댑터.

- [ ] **Step 1: `StockContentionError`를 추가한다**

```ts
/**
 * 낙관적 락이 재시도 한도 안에 성공하지 못했다. **낙관적 어댑터에만 존재한다** —
 * 비관적 어댑터는 잠금을 기다리므로 이런 실패가 없다. 두 어댑터의 예외 표면이
 * 다른 것이 두 전략의 차이가 드러나는 자리다.
 *
 * 사용자가 다시 시도하면 성공할 수 있는 일시적 경합이므로 `DomainError`이고 409다.
 */
export class StockContentionError extends DomainError {
  static readonly CODE = 'STOCK_CONTENTION';
  readonly code = StockContentionError.CODE;

  constructor(skuId: string, attempts: number) {
    super(`재고 경합으로 ${attempts}회 재시도 후 실패했습니다: ${skuId}`);
  }
}
```

- [ ] **Step 2: `mutate`를 구현한다**

```ts
const DEFAULT_MAX_ATTEMPTS = 20;

export class OptimisticStockRepository implements StockRepository {
  /**
   * 재시도 횟수. 스펙 §6.4가 README 벤치마크에 실기로 한 세 지표 중 하나다
   * (초과 판매 여부, 처리량, 재시도 횟수). 비관적 어댑터에는 이 필드가 없다 —
   * 재시도를 하지 않기 때문이고, 두 표면이 다른 것이 그 차이를 드러낸다.
   */
  retries = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {}

  /**
   * 읽고 → `change`를 적용하고 → `WHERE version = <읽은 값>`으로 UPDATE한다.
   * 0행이 갱신되면 다른 트랜잭션이 먼저 쓴 것이므로 **처음부터 다시** 한다.
   *
   * 다시 읽는 것이 핵심이다. `UPDATE`만 재시도하면 낡은 데이터로 내린 도메인 판단을
   * 그대로 다시 쓰게 된다 — 재고가 1개 남았을 때 두 요청이 모두 "가능하다"고 판단한
   * 뒤 순서대로 쓰면 초과 판매가 된다.
   *
   * Postgres의 기본 격리 수준은 READ COMMITTED라, 같은 트랜잭션 안에서 다시 읽어도
   * 그사이 커밋된 다른 트랜잭션의 값이 보인다. 그래서 이 재시도가 성립한다.
   *
   * `change`는 재시도마다 다시 실행된다. 부수 효과가 있는 `change`(예약 객체 생성 등)는
   * 매번 새 객체를 만들고 버려진 것들은 저장되지 않는다 — 반환된 마지막 것만 쓰인다.
   */
  async mutate<T>(
    skuId: SkuId,
    tx: TransactionContext,
    change: (stock: StockItem) => T,
  ): Promise<T> {
    const client = asPrismaClient(tx);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const row = await client.stockItem.findUnique({ where: { skuId } });
      if (row === null) {
        throw new StockNotFoundError(skuId);
      }

      const stock = toStockDomain(row);
      // change가 던지면 그대로 전파된다 — 재고 부족은 재시도 대상이 아니다.
      // 다시 읽어봐야 재고가 늘어날 리 없고, 재시도하면 그만큼 응답이 늦어질 뿐이다.
      const result = change(stock);

      const updated = await client.stockItem.updateMany({
        where: { skuId, version: row.version },
        data: {
          onHand: stock.onHand.value,
          reserved: stock.reserved.value,
          version: row.version + 1,
        },
      });

      if (updated.count === 1) {
        return result;
      }
      this.retries += 1;
    }

    throw new StockContentionError(skuId, this.maxAttempts);
  }

  // findBySkuId / create는 비관적 어댑터와 같다. version은 읽지도 쓰지도 않는다
  // (create는 스키마 기본값 0에 맡긴다).
}
```

- [ ] **Step 3: 계약을 이 어댑터에 돌린다**

```ts
stockRepositoryContract(
  'optimistic',
  async () => new OptimisticStockRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
```

Run: `pnpm test:int apps/api/src/modules/inventory`
Expected: PASS — **같은 스위트가 이제 세 구현(in-memory, 비관적, 낙관적)에서 통과한다.** 락 전략의 차이가 관측 가능한 동작으로 새어 나오지 않는다는 것이 이 스위트의 주장이다.

- [ ] **Step 4: 어댑터 전용 테스트를 더한다**

계약이 볼 수 없는 것 — 낙관적 어댑터만의 성질.

- **버전이 실제로 증가한다**: `mutate` 후 원시 SQL로 `version`을 읽어 1 늘었는지 확인한다. 비관적 어댑터로 같은 연산을 하면 `version`이 **0 그대로**여야 한다(스펙 §10.8: 비관적 어댑터는 이 컬럼을 읽지 않는다).
- **경합하면 재시도한다**: 트랜잭션 두 개를 열어 A가 읽고, B가 읽고 쓰고 커밋한 뒤, A가 쓰려 하면 A가 다시 읽어 성공하고 `retries`가 1 늘어난다. 이 테스트는 진짜 동시 트랜잭션 두 개가 필요하다 — `testDb()`의 풀이 20이라 가능하다.
- **한도를 넘으면 `StockContentionError`다**: `maxAttempts: 1`로 어댑터를 만들고 위와 같은 경합을 만들면 재시도 없이 바로 던진다.
- **`retries`가 성공 경로에서는 늘지 않는다**: 경합 없는 `mutate` 후 `retries === 0`.

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 버전 조건이 실제로 있는가**
`updateMany`의 `where`에서 `version: row.version`을 지운다.
Expected: FAIL — `'경합하면 재시도한다'`가 재시도 없이 성공해 `retries`가 0이라며 실패한다. **이 회귀는 낙관적 락을 통째로 무력화한다** — 갱신이 항상 성공하므로 잃어버린 갱신(lost update)이 조용히 일어난다. 태스크 13의 동시성 스위트도 초과 판매로 실패해야 한다.
되돌린다.

**(b) 재시도가 다시 읽는가**
재시도 루프를 `updateMany`만 다시 하도록 바꾼다(읽기와 `change`를 루프 밖으로 뺀다).
Expected: FAIL — 태스크 13의 동시성 스위트가 초과 판매로 실패한다. 계약 스위트는 순차 호출만 하므로 **통과한다** — 그 비대칭이 동시성 스위트가 따로 존재하는 이유다. 이 프루브는 태스크 13이 끝난 뒤에 실행하고, 결과를 그 태스크의 보고서에 적는다.
되돌린다.

**(c) 비관적 어댑터가 `version`을 건드리지 않는가**
`pessimistic-stock.repository.ts`의 `update`에 `version: { increment: 1 }`을 더한다.
Expected: FAIL — Step 4의 `'비관적 어댑터는 version을 0 그대로 둔다'`가 실패한다. 두 어댑터를 같은 스키마로 비교한다는 전제가 깨지는 지점이다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): version 기반 낙관적 재고 리포지토리를 추가한다"
```

---

### Task 13: 동시성 스위트 — 두 락 전략을 같은 테스트로 비교한다

**Files:**
- Create: `apps/api/src/modules/inventory/testing/stock-concurrency.contract.ts`
- Create: `apps/api/src/modules/inventory/adapters/out/persistence/stock-concurrency.integration.spec.ts`

**Interfaces:**
- Consumes: `ReserveStockService`(태스크 8), `PessimisticStockRepository`(태스크 11), `OptimisticStockRepository`(태스크 12), `PrismaReservationRepository`(태스크 10), `PrismaTransactionManager`, `SystemClock`, `UuidV7Generator`, `testDb()`
- Produces: `stockConcurrencyContract(name, makeStockRepo)`, 그리고 벤치마크 수치(태스크 16이 README에 싣는다)

**이 태스크가 스펙 §13의 성공 기준 하나를 완결한다**

> 재고 1개에 동시 예약 50건 → 정확히 1건 성공이 **두 락 전략 모두에서** 통과

**전제 조건 — 이것이 무너지면 스위트가 거짓 통과한다**

스펙 §9.6이 경고한 그대로다: "Prisma 커넥션 풀이 작으면 요청이 풀에서 직렬화되어 경합이 발생하지 않고 테스트가 거짓으로 통과한다." `apps/api/test/setup/database.ts`가 `PrismaPg`에 `max: 20`을 주고 있고, `database.integration.spec.ts`가 `pg_backend_pid()`로 서로 다른 백엔드가 15개 이상 동시에 뜨는 것을 이미 확인한다. **그 테스트가 깨지면 이 스위트의 결과를 믿을 수 없다** — 이 파일 상단 주석에 그 의존 관계를 적는다.

**직렬화되지 않았다는 것을 어떻게 아는가**

락이 없어도 순차 실행이면 답이 맞는다. 그래서 "정확히 1건 성공"이라는 단언만으로는 락이 동작한다는 증거가 되지 않는다. 두 가지로 보강한다.

1. **낙관적 어댑터에서는 `retries > 0`을 단언한다.** 재시도가 한 번도 없었다면 전부 직렬화된 것이고, 그러면 이 테스트는 아무것도 검증하지 않는다.
2. **비관적 어댑터에는 그런 카운터가 없으므로 뮤테이션이 유일한 증거다.** Step 4의 프루브에서 `FOR UPDATE`를 지웠을 때 실제로 초과 판매가 나는 것을 눈으로 확인하고, **몇 건이 초과 판매됐는지 보고서에 적는다.** 초과 판매가 0이면 경합이 일어나지 않은 것이고 풀 설정부터 다시 봐야 한다.

- [ ] **Step 1: 동시성 스위트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Duration } from '../../../shared/kernel/duration';
import { OrderId, SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import { SystemClock } from '../../../shared/infrastructure/clock/system-clock';
import { UuidV7Generator } from '../../../shared/infrastructure/id/uuid-v7.generator';
import { PrismaTransactionManager } from '../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { ReserveStockService } from '../application/services/reserve-stock.service';
import type { StockRepository } from '../application/ports/out/stock.repository';
import { PrismaReservationRepository } from '../adapters/out/persistence/prisma-reservation.repository';
import { StockItem } from '../domain/stock-item';
import { testDb } from '../../../../test/setup/database';

const TTL = Duration.minutes(15);

export interface ConcurrencyOutcome {
  readonly fulfilled: number;
  readonly rejected: number;
  readonly elapsedMs: number;
  readonly available: number;
}

/**
 * 재고 동시성 스위트. **두 Prisma 어댑터에 같은 테스트가 돈다** (스펙 §6.4).
 *
 * 전제: `apps/api/test/setup/database.ts`가 `PrismaPg`에 `max: 20`을 준다.
 * 풀이 작으면 요청이 풀에서 직렬화되어 경합이 아예 발생하지 않고, 락이 없어도
 * 답이 맞아 이 스위트 전체가 거짓 통과한다(스펙 §9.6).
 * `apps/api/test/setup/database.integration.spec.ts`가 그 전제를 지킨다 —
 * 그 테스트가 깨지면 여기 수치를 믿지 말 것.
 *
 * 트랜잭션으로 감싸 롤백하지 않는다. 같은 트랜잭션 안에서는 경합을 재현할 수 없다.
 */
export function stockConcurrencyContract(
  name: string,
  makeStockRepo: (prisma: PrismaClient) => StockRepository,
  observeRetries?: (repo: StockRepository) => number,
): void {
  describe(`재고 동시성 — ${name}`, () => {
    async function reserveConcurrently(
      onHand: number,
      attempts: number,
      quantityEach = 1,
    ): Promise<{ outcome: ConcurrencyOutcome; retries: number }> {
      const db = await testDb();
      const skuId = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0001');
      const stocks = makeStockRepo(db);

      await stocks.create(StockItem.create({ skuId, onHand: Quantity.of(onHand) }));

      const service = new ReserveStockService(
        stocks,
        new PrismaReservationRepository(db),
        new PrismaTransactionManager(db),
        new SystemClock(),
        new UuidV7Generator(),
        TTL,
      );

      const startedAt = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () =>
          service.execute({
            skuId,
            orderId: OrderId.of(new UuidV7Generator().nextId()),
            quantity: quantityEach,
          }),
        ),
      );
      const elapsedMs = Date.now() - startedAt;

      const remaining = await stocks.findBySkuId(skuId);
      return {
        outcome: {
          fulfilled: results.filter((r) => r.status === 'fulfilled').length,
          rejected: results.filter((r) => r.status === 'rejected').length,
          elapsedMs,
          available: remaining?.available.value ?? -1,
        },
        retries: observeRetries?.(stocks) ?? 0,
      };
    }

    it('재고 1개에 동시 예약 50건이면 정확히 1건만 성공한다', async () => {
      const { outcome, retries } = await reserveConcurrently(1, 50);

      expect(outcome.fulfilled).toBe(1);
      expect(outcome.rejected).toBe(49);
      // 초과 판매가 없다. 이 한 줄이 이 계획 전체의 목표다.
      expect(outcome.available).toBe(0);

      // 벤치마크용 수치. 태스크 16이 README 표로 옮긴다.
      console.log(
        `[동시성:${name}] 재고1/시도50 → 성공 ${outcome.fulfilled}, 재시도 ${retries}, ${outcome.elapsedMs}ms`,
      );

      if (observeRetries !== undefined) {
        // 재시도가 한 번도 없었다면 전부 직렬화된 것이고, 그러면 이 테스트는
        // 락이 동작한다는 것을 아무것도 증명하지 않는다. 낙관적 어댑터에서만
        // 확인할 수 있는 신호다 — 비관적 쪽은 Step 4의 뮤테이션이 유일한 증거다.
        expect(retries).toBeGreaterThan(0);
      }
    });

    it('재고 10개에 동시 예약 30건이면 정확히 10건만 성공한다', async () => {
      const { outcome, retries } = await reserveConcurrently(10, 30);

      expect(outcome.fulfilled).toBe(10);
      expect(outcome.rejected).toBe(20);
      expect(outcome.available).toBe(0);

      console.log(
        `[동시성:${name}] 재고10/시도30 → 성공 ${outcome.fulfilled}, 재시도 ${retries}, ${outcome.elapsedMs}ms`,
      );
    });

    it('실패한 예약은 전부 InsufficientStockError나 StockContentionError다', async () => {
      // 다른 예외가 섞여 있으면 "1건만 성공"이 락 때문이 아니라 버그 때문일 수 있다.
      const db = await testDb();
      const skuId = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0002');
      const stocks = makeStockRepo(db);
      await stocks.create(StockItem.create({ skuId, onHand: Quantity.of(1) }));

      const service = new ReserveStockService(
        stocks,
        new PrismaReservationRepository(db),
        new PrismaTransactionManager(db),
        new SystemClock(),
        new UuidV7Generator(),
        TTL,
      );

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.execute({
            skuId,
            orderId: OrderId.of(new UuidV7Generator().nextId()),
            quantity: 1,
          }),
        ),
      );

      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as Error).constructor.name);
      const unexpected = reasons.filter(
        (n) => n !== 'InsufficientStockError' && n !== 'StockContentionError',
      );
      expect(unexpected).toEqual([]);
    });

    it('성공한 예약 수만큼 예약 행이 남는다', async () => {
      // 카운터와 예약 행이 어긋나지 않는다는 것 — 편차 4가 감수한 비정규화의
      // 대가가 동시 실행에서도 청구되지 않는지 확인한다.
      const db = await testDb();
      const skuId = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0003');
      const stocks = makeStockRepo(db);
      await stocks.create(StockItem.create({ skuId, onHand: Quantity.of(5) }));

      const service = new ReserveStockService(
        stocks,
        new PrismaReservationRepository(db),
        new PrismaTransactionManager(db),
        new SystemClock(),
        new UuidV7Generator(),
        TTL,
      );

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.execute({
            skuId,
            orderId: OrderId.of(new UuidV7Generator().nextId()),
            quantity: 1,
          }),
        ),
      );
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;

      const rows = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM reservations WHERE sku_id = ${skuId}::uuid
      `;
      expect(Number(rows[0]?.count ?? -1)).toBe(fulfilled);
      expect(fulfilled).toBe(5);
    });
  });
}
```

- [ ] **Step 2: 두 어댑터에 스위트를 붙인다**

Create `stock-concurrency.integration.spec.ts`:

```ts
import { OptimisticStockRepository } from './optimistic-stock.repository';
import { PessimisticStockRepository } from './pessimistic-stock.repository';
import { stockConcurrencyContract } from '../../../testing/stock-concurrency.contract';

stockConcurrencyContract('pessimistic', (prisma) => new PessimisticStockRepository(prisma));

stockConcurrencyContract(
  'optimistic',
  (prisma) => new OptimisticStockRepository(prisma),
  (repo) => (repo as OptimisticStockRepository).retries,
);
```

- [ ] **Step 3: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/inventory/adapters/out/persistence/stock-concurrency.integration.spec.ts`
Expected: PASS — 두 전략 × 4개 = 8개.

`console.log`로 찍힌 여섯 줄(전략 2 × 시나리오 2 + 나머지)을 **보고서에 그대로 옮긴다.** 태스크 16이 그 수치로 README 표를 만든다.

이 스위트가 불안정하면 그 자체가 발견이다. 특히 낙관적 쪽에서 `StockContentionError`가 많이 나오면 `maxAttempts`를 올려보고, 올려야 통과한다면 **그 사실이 벤치마크의 결론**이다 — 스펙 §6.4가 "인기 상품 경합에서 낙관적 락은 재시도가 폭주한다"고 예측한 바로 그것이다. 숨기지 말고 수치로 적는다.

- [ ] **Step 4: 이 검사가 무엇을 잡는지 증명한다 — 이 계획에서 가장 중요한 프루브다**

**(a) 비관적 락이 실제로 초과 판매를 막는가**
`pessimistic-stock.repository.ts`의 `$queryRaw`에서 `FOR UPDATE`를 지운다.
Expected: FAIL — `'재고 1개에 동시 예약 50건이면 정확히 1건만 성공한다'`가 성공 건수가 1보다 크다며 실패하고, `available`이 음수가 되거나 0이 아니게 된다.
**초과 판매 건수를 보고서에 숫자로 적는다.** 초과 판매가 0이면 경합이 일어나지 않은 것이고, 그때는 이 스위트가 아무것도 검증하지 않는 상태다 — 풀 크기와 `database.integration.spec.ts`부터 확인해야 한다.
되돌리고 다시 통과하는지 확인한다.

**(b) 낙관적 락의 버전 조건이 실제로 필요한가**
`optimistic-stock.repository.ts`의 `updateMany` `where`에서 `version: row.version`을 지운다.
Expected: FAIL — 같은 테스트가 초과 판매로 실패한다. 건수를 적는다.
되돌린다.

**(c) 낙관적 재시도가 "다시 읽는" 것이 필요한가 (태스크 12의 프루브 (b))**
읽기와 `change`를 재시도 루프 **밖으로** 빼고 `updateMany`만 재시도하게 만든다.
Expected: FAIL — 초과 판매가 난다. **계약 스위트는 통과한다** — 순차 호출만 하기 때문이다. 그 비대칭이 동시성 스위트가 따로 존재하는 이유이고, 태스크 12에서 미뤄둔 프루브를 여기서 끝낸다.
되돌린다.

세 프루브 전부 되돌린 뒤 `pnpm test:int`가 다시 통과하는지 확인한다. **의도적 훼손을 트리에 남기지 않는다.**

- [ ] **Step 5: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/inventory
git commit -m "test(inventory): 두 락 전략에 같은 동시성 스위트를 돌려 초과 판매 0을 증명한다"
```

---

### Task 14: Inventory 계약·컨트롤러·모듈 배선

**Files:**
- Create: `apps/api/src/modules/inventory/application/ports/in/queries/get-stock.query.ts`
- Create: `apps/api/src/modules/inventory/application/ports/in/register-stock.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/ports/in/restock.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/services/get-stock.service.ts` + spec
- Create: `apps/api/src/modules/inventory/application/services/register-stock.service.ts` + spec
- Create: `apps/api/src/modules/inventory/application/services/restock.service.ts` + spec
- Create: `packages/contracts/src/inventory/stock.contract.ts` + spec
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/api.contract.ts`
- Create: `apps/api/src/modules/inventory/adapters/in/http/{stock.controller.ts, inventory-domain-error-mappings.ts, stock.controller.integration.spec.ts}`
- Create: `apps/api/src/modules/inventory/{inventory.module.ts, index.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`
- Modify: `apps/api/src/modules/inventory/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces:
  - `GetStockQuery { execute({ skuId: string }): Promise<StockView> }`, `GET_STOCK_QUERY`, `StockView { skuId: string; onHand: number; reserved: number; available: number }`
  - `RegisterStockUseCase { execute({ skuId: string; onHand: number }): Promise<void> }`, `REGISTER_STOCK_USECASE`
  - `RestockUseCase { execute({ skuId: string; quantity: number }): Promise<void> }`, `RESTOCK_USECASE`
  - 생성자: `GetStockService(stocks)`, `RegisterStockService(stocks, transactions)`, `RestockService(stocks, transactions)`
  - `stockContract` — `GET /stock/:skuId`, `POST /stock` (초기 등록), `POST /stock/:skuId/restock`
  - `InventoryModule`, `inventory/index.ts`(계획 4의 Ordering이 `ReserveStockUseCase`를 ACL로 쓴다)

**`inventory/index.ts`가 계획 4를 위해 내보내는 것**

스펙 §7.5는 `ReserveStockUseCase`를 "ordering이 포트 통해 호출"한다고 적었다. 그러므로 공개 API에 그것과 토큰을 내보낸다 — 계획 4의 `InProcessInventoryAdapter`가 부를 유일한 대상이다. `ConfirmReservation`/`ReleaseReservation`도 함께 내보낸다: 계획 4가 이벤트 구독 어댑터를 만들 때 필요하다.

`StockRepository`는 **내보내지 않는다.** 다른 모듈이 우리 애그리거트를 직접 만지면 `reserved ≤ onHand` 불변식의 주인이 사라진다.

**초기 재고 등록 엔드포인트가 필요한 이유.** 재고 행이 없으면 `ReserveStock`이 `StockNotFoundError`를 낸다. 계획 4의 E2E가 "상품 등록 → 재고 등록 → 주문"을 밟으려면 이 엔드포인트가 있어야 하고, 지금 만들지 않으면 계획 4가 inventory를 다시 열어야 한다. 관리자 역할이 없으므로 `AccessTokenGuard`만 걸고 그 사실을 주석에 적는다(편차 3).

- [ ] **Step 1: `GetStockQuery`와 서비스를 만든다**

조회지만 애그리거트를 거친다 — 재고는 필드가 셋뿐이고 `available`은 파생값이라, 별도 조회 포트를 만들 이유가 없다(스펙 §7.7: "테스트에서 바꿔치기해야 하는가, 혹은 나중에 교체될 수 있는가. 둘 다 아니면 포트가 아니다"). `StockRepository.findBySkuId`를 그대로 쓰고 `null`이면 `StockNotFoundError`를 던진다. **이 판단을 서비스 doc 주석에 적는다** — 스펙 §7.2의 "조회는 애그리거트를 거치지 않는다"에서 의도적으로 벗어나는 자리이기 때문이다.

- [ ] **Step 1b: `RegisterStock`과 `Restock` 유스케이스를 만든다**

두 엔드포인트에는 유스케이스가 필요하다. 둘 다 얇다.

- `RegisterStockService.execute({ skuId, onHand })` — `StockItem.create`로 만들어 `stocks.create(item, tx)`. 이미 있으면 어댑터가 던지고(계약의 `'같은 SKU를 두 번 create하면 던진다'`), 그 예외가 409로 나가야 하므로 **어댑터의 P2002를 `StockAlreadyExistsError`(`CODE='STOCK_ALREADY_EXISTS'`, 409)로 번역한다.** 계획 2의 `PrismaAccountRepository`가 이메일 유니크 위반에 한 것과 같은 처리이고, 구조적 판별(`code === 'P2002'` + 드라이버 어댑터의 `meta.driverAdapterError.cause.constraint`)도 그대로 재사용한다 — 계획 2의 태스크 11이 `meta.target`이 비어 있다는 것을 실측으로 발견했으므로 그 코드를 참고한다.
- `RestockService.execute({ skuId, quantity })` — `stocks.mutate(skuId, tx, (stock) => stock.restock(Quantity.positive(quantity)))`.

spec은 각각 정상 경로, 중복 등록 → `StockAlreadyExistsError`, 없는 SKU 입고 → `StockNotFoundError`, 수량 0 입고 → `QuantityBelowMinimumError`, 그리고 **입고가 `reserved`를 건드리지 않는다**를 덮는다.

- [ ] **Step 2: 계약을 만든다**

```ts
export const stockDtoSchema = z.object({
  skuId: z.string().uuid(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
}).strict();

export const registerStockBodySchema = z.object({
  skuId: z.string().uuid(),
  onHand: z.number().int().nonnegative(),
}).strict();

export const restockBodySchema = z.object({
  quantity: z.number().int().positive(),
}).strict();
```

`.int()`를 빠뜨리지 않는다. 계획 1의 M6이 남긴 교훈이다 — 비정수가 `Quantity`까지 도달하면 도메인이 두 번째 그물이 되지만, 형식은 여기서 걸러야 한다.

응답 맵은 각 라우트가 실제로 낼 수 있는 상태를 전부 적는다.

| 라우트 | 상태 |
|---|---|
| `GET /stock/:skuId` | 200, 400, 401, 404(`STOCK_NOT_FOUND`) |
| `POST /stock` | 201, 400, 401, 409(이미 있음) |
| `POST /stock/:skuId/restock` | 204, 400, 401, 404 |

- [ ] **Step 3: 에러 매핑을 등록한다**

```ts
registry.register(InsufficientStockError.CODE, { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });
registry.register(StockNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
registry.register(StockContentionError.CODE, { status: 409, code: ErrorCode.DOMAIN_RULE_VIOLATED });
registry.register(ReservationConflictError.CODE, { status: 409, code: ErrorCode.DOMAIN_RULE_VIOLATED });
registry.register(ReservationNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
registry.register(StockAlreadyExistsError.CODE, { status: 409, code: ErrorCode.DOMAIN_RULE_VIOLATED });
```

`ErrorCode.INSUFFICIENT_STOCK`은 계획 1이 이미 계약에 넣어뒀다 — 새로 추가할 필요가 없고, **여기서 처음으로 실제 사용처가 생긴다.**

등록하지 않은 `DomainError`는 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 틀린 상태 코드를 낸다. `app.module.spec.ts`가 조립된 레지스트리를 직접 resolve해 다섯 매핑을 확인한다.

- [ ] **Step 4: 모듈을 배선한다**

`inventory.module.ts`는 계획 2의 `identity.module.ts` 형태를 따른다. **`STOCK_REPOSITORY`는 `PessimisticStockRepository`에 바인딩한다** — 스펙 §6.4가 그것을 기본값으로 정했다.

```ts
{
  // 기본 전략은 비관적 락이다(스펙 §6.4). 낙관적 어댑터로 바꾸려면 이 한 줄만
  // 고치면 되고, 도메인도 유스케이스도 테스트도 그대로다 — 그것이 포트 하나에
  // 어댑터 둘을 둔 이유이자 헥사고날의 값이 눈에 보이는 자리다.
  provide: STOCK_REPOSITORY,
  useFactory: (prisma: PrismaService) => new PessimisticStockRepository(prisma),
  inject: [PrismaService],
},
```

예약 TTL은 `readReservationTtl(process.env)`로 읽는다(`RESERVATION_TTL_MINUTES`, 기본 15). 계획 2의 `readJwtConfig`/`readRefreshTtl`과 같은 형태로 만들고, 숫자가 아니거나 0 이하면 **부팅을 거부한다.** `.env.example`에 추가한다.

**`inject:` 배열이 생성자 인자 순서와 위치별로 일치해야 한다.** `ReserveStockService(stocks, reservations, transactions, clock, ids, reservationTtl)`처럼 같은 타입이 인접한 곳에서 뒤바뀌면 타입 검사는 통과하고 런타임에만 깨진다.

- [ ] **Step 5: 통합 테스트를 쓴다**

단위 테스트가 구조적으로 볼 수 없는 것만.
- 재고 등록 → 201, 응답 본문을 `stockContract.register.responses[201]` 스키마로 파싱한다(서버를 자기 계약에 묶는다)
- 같은 SKU를 두 번 등록 → 409
- 조회 → 200, `available = onHand - reserved`
- 없는 SKU 조회 → 404 `NOT_FOUND`
- 토큰 없이 등록 → 401, 메시지가 가드의 것인지 단언해 데코레이터의 401과 구분한다
- 입고 → 204, 조회하면 `onHand`가 늘어 있다
- 수량 0으로 입고 → 400 `VALIDATION_FAILED`
- 경로 파라미터가 uuid가 아니면 → 400

`afterAll`에서 `process.env['DATABASE_URL']`을 복원한다.

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) 기본 전략이 비관적인가**
`inventory.module.ts`의 `PessimisticStockRepository`를 `OptimisticStockRepository`로 바꾼다.
Expected: **모든 테스트가 통과한다.** 그것이 요점이다 — 두 어댑터가 같은 계약을 통과하므로 바꿔 끼워도 관측 가능한 동작이 같다. 이 사실을 보고서에 적고, `pnpm verify`가 통과하는 것까지 확인한 뒤 되돌린다. **이것이 스펙 §13의 "`InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음"과 같은 계열의 증거다.**

**(b) 에러 매핑 누락을 잡는가**
`InsufficientStockError` 등록을 주석 처리한다.
Expected: FAIL — `app.module.spec.ts`가 폴백 `{422, DOMAIN_RULE_VIOLATED}`를 받아 실패한다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 순환 없음을 확인한다 — inventory는 어느 모듈도 import하지 않는다.

```bash
git add apps/api/src packages/contracts/src
git commit -m "feat(inventory): 재고 계약과 컨트롤러를 배선한다"
```

---

### Task 15: 스케줄러 둘 — TTL 자가치유와 Outbox 릴레이

**Files:**
- Modify: `apps/api/package.json` (`@nestjs/schedule@^12.0.1`), `.env.example`
- Create: `apps/api/src/shared/infrastructure/scheduler/scheduler.config.ts` + spec
- Create: `apps/api/src/shared/infrastructure/outbox/outbox-relay.scheduler.ts` + spec
- Create: `apps/api/src/modules/inventory/adapters/in/scheduler/reservation-expiry.scheduler.ts` + spec
- Modify: `apps/api/src/shared/shared.module.ts`, `apps/api/src/modules/inventory/inventory.module.ts`
- Modify: `apps/api/src/app.module.spec.ts`

**이 태스크가 계획 1의 이월 하나를 닫는다.** `OutboxRelay`는 계획 1에서 만들어진 뒤 **프로덕션 호출자가 한 번도 없었다.** 릴레이가 실제로 돈 적이 없으니, 이벤트를 outbox에 넣는 모든 코드가 지금까지 아무 데도 도착하지 않았다. 태스크 9의 `StockReservationExpired`가 이 계획에서 처음 발행되는 이벤트이고, 그것이 나갈 길을 여기서 만든다.

- [ ] **Step 1: 설치**

```bash
pnpm --filter @commerce/api add @nestjs/schedule@^12.0.1
pnpm db:generate
```

`@nestjs/schedule@12`는 Nest 12와 짝이다. 버전을 고정한다.

- [ ] **Step 2: 스케줄러 설정을 만든다 — 테스트에서 꺼야 한다**

`ScheduleModule.forRoot()`를 넣으면 `createNestApplication().init()`을 부르는 **모든 통합 spec에서 타이머가 돌기 시작한다.** 계획 2의 인증·주소록 통합 spec들이 그렇게 앱을 띄우고, 그러면 릴레이와 만료 스케줄러가 테스트 DB를 배경에서 폴링하면서 `TRUNCATE`와 경합한다 — 다른 테스트가 이유 없이 깨지는 종류의 오염이다.

```ts
export interface SchedulerConfig {
  readonly enabled: boolean;
  readonly outboxRelayIntervalMs: number;
  readonly reservationExpiryIntervalMs: number;
}

/**
 * 스케줄러는 **기본으로 켜지고 테스트에서만 꺼진다.** 반대로 하면(기본 꺼짐)
 * 운영 배포에서 환경변수 하나를 빠뜨렸을 때 TTL 자가치유가 조용히 죽는다 —
 * 그리고 그 사실은 재고가 영원히 예약 상태로 쌓인 뒤에야 드러난다.
 */
export function readSchedulerConfig(env: NodeJS.ProcessEnv): SchedulerConfig {
  return {
    enabled: env['SCHEDULERS_ENABLED'] !== 'false',
    outboxRelayIntervalMs: positiveInt(env['OUTBOX_RELAY_INTERVAL_MS'], 5_000, 'OUTBOX_RELAY_INTERVAL_MS'),
    reservationExpiryIntervalMs: positiveInt(
      env['RESERVATION_EXPIRY_INTERVAL_MS'], 30_000, 'RESERVATION_EXPIRY_INTERVAL_MS',
    ),
  };
}
```

`positiveInt`는 값이 없으면 기본값을, 숫자가 아니거나 0 이하면 **부팅을 거부하는** 예외를 던진다. 계획 2의 `readJwtConfig`와 같은 형태다.

`apps/api/.env`(로컬, 커밋 안 됨)와 CI 환경에 `SCHEDULERS_ENABLED=false`를 넣는다. `vitest.config.ts`가 `apps/api/.env`를 로드하므로 그 한 줄이 모든 테스트를 덮는다. `.env.example`에는 세 변수를 전부 적고, **`SCHEDULERS_ENABLED`는 테스트 전용이며 운영에서는 설정하지 말라는 주석**을 단다.

- [ ] **Step 3: 두 스케줄러를 만든다**

둘은 같은 골격이다.

```ts
@Injectable()
export class OutboxRelayScheduler {
  private readonly logger = new Logger(OutboxRelayScheduler.name);
  private running = false;

  constructor(
    // biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다.
    private readonly relay: OutboxRelay,
    private readonly config: SchedulerConfig,
  ) {}

  @Interval('outbox-relay', OUTBOX_RELAY_INTERVAL_PLACEHOLDER)
  async tick(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    // 이전 실행이 아직 끝나지 않았으면 건너뛴다. 릴레이가 느려지면 주기가 겹치고,
    // 겹친 두 실행이 같은 outbox 행을 집어 같은 이벤트를 두 번 보낸다.
    // (at-least-once 계약상 허용되지만 이유 없이 늘릴 필요는 없다.)
    if (this.running) {
      this.logger.warn('이전 릴레이 실행이 끝나지 않아 이번 주기를 건너뜁니다.');
      return;
    }
    this.running = true;
    try {
      await this.relay.relayOnce();
    } catch (error) {
      // 스케줄러가 죽으면 다음 주기가 오지 않는다. 반드시 삼킨다.
      this.logger.error(`Outbox 릴레이 실패: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
```

**`@Interval`의 주기는 데코레이터 인자라 상수여야 한다.** 설정값을 쓰려면 데코레이터 대신 `SchedulerRegistry`에 `onModuleInit`에서 등록하는 형태로 바꿔야 한다. **구현자가 판단한다** — 둘 중 하나를 택하고 보고서에 이유를 적는다.

- **`@Interval` + 상수**: 단순하다. 주기를 바꾸려면 재배포해야 한다.
- **`SchedulerRegistry` + `onModuleInit`**: 설정값을 쓸 수 있다. 배선이 몇 줄 늘고, 등록·해제를 직접 관리해야 한다.

**권장: 후자.** 이 계획이 이미 `SchedulerConfig`를 만들었고, 주기를 상수로 박으면 그 설정의 절반이 죽은 값이 된다. 그리고 등록을 `onModuleInit`에서 하면 `enabled`가 false일 때 **아예 등록하지 않을 수 있어**, 테스트에서 타이머가 존재하지도 않게 된다 — `tick` 안에서 검사하는 것보다 깨끗하다.

`ReservationExpiryScheduler`도 같은 형태로 `ExpireReservationsUseCase.execute()`를 부른다. 만료 건수를 로그에 남긴다 — 운영에서 "보상 트랜잭션이 얼마나 실패하고 있는가"를 보는 유일한 창이다.

- [ ] **Step 4: spec을 쓴다**

스케줄러는 얇지만 **세 가지 성질은 테스트한다.**
- `enabled: false`면 유스케이스를 부르지 않는다
- 유스케이스가 던져도 `tick`이 던지지 않는다 — 던지면 다음 주기가 오지 않는다
- 이전 실행이 끝나기 전에 다시 불리면 두 번째는 유스케이스를 부르지 않는다(겹침 방지)

`vi.mock`을 쓰지 않는다. 손으로 쓴 fake 유스케이스(호출 횟수를 세고, 옵션으로 던지거나 지연되는)를 spec 파일 안에 둔다.

- [ ] **Step 5: 배선하고 릴레이가 실제로 도는 것을 통합 테스트로 확인한다**

`SharedModule`에 `ScheduleModule.forRoot()`와 `OutboxRelayScheduler`, `readSchedulerConfig` 팩토리를 넣는다. `InventoryModule`에 `ReservationExpiryScheduler`를 넣는다.

통합 테스트 하나가 **outbox 행이 실제로 발행되는 전체 경로**를 확인한다 — 계획 1 이후 처음이다.

```ts
it('만료된 예약이 outbox에 이벤트를 남기고 릴레이가 그것을 발행한다', async () => {
  // 1) 재고와 예약을 만들고 TTL을 넘긴다
  // 2) ExpireReservationsUseCase를 직접 부른다(스케줄러 없이)
  // 3) outbox에 published_at IS NULL 인 StockReservationExpired 행이 있는지 확인한다
  // 4) OutboxRelay.relayOnce()를 직접 부른다
  // 5) published_at이 채워졌고, RecordingEventTransport에 그 이벤트가 도착했는지 확인한다
});
```

스케줄러 자체가 아니라 **경로**를 확인한다. 타이머가 실제로 발화하는지는 `SchedulerRegistry`에 인터벌이 등록됐는지로 따로 본다.

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) 겹침 방지가 실제로 있는가**
`running` 가드를 지운다.
Expected: FAIL — `'이전 실행이 끝나기 전에 다시 불리면 두 번째는 부르지 않는다'`가 실패한다.
되돌린다.

**(b) 예외를 삼키는가**
`try`/`catch`를 걷어낸다.
Expected: FAIL — `'유스케이스가 던져도 tick이 던지지 않는다'`가 실패한다. 이 회귀는 **한 번의 실패로 스케줄러를 영영 멈춘다** — 그리고 TTL 자가치유가 멈췄다는 사실은 재고가 쌓인 뒤에야 드러난다.
되돌린다.

**(c) 테스트에서 스케줄러가 꺼져 있는가**
`apps/api/.env`에서 `SCHEDULERS_ENABLED=false`를 지운다.
Expected: 통합 테스트들이 불안정해지거나 `TRUNCATE`와 경합해 실패한다. **깨지지 않는다면 그것도 발견이다** — 스케줄러가 등록되지 않았다는 뜻이므로 배선을 다시 본다. 어느 쪽이든 관측 결과를 적는다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

```bash
git add apps/api/src apps/api/package.json .env.example pnpm-lock.yaml
git commit -m "feat(api): TTL 자가치유와 Outbox 릴레이 스케줄러를 배선한다"
```

---

### Task 16: 벤치마크와 마무리

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-03-catalog-inventory.md` (완료 기준 체크)

- [ ] **Step 1: 벤치마크 수치를 모은다**

태스크 13의 동시성 스위트를 **세 번 연속 실행**해 수치의 변동 폭을 본다.

```bash
for i in 1 2 3; do pnpm test:int apps/api/src/modules/inventory/adapters/out/persistence/stock-concurrency.integration.spec.ts 2>&1 | grep '\[동시성:'; done
```

- [ ] **Step 2: README에 표를 싣는다**

스펙 §13의 산출물 기준: "README에 아키텍처 그래프와 락 전략 벤치마크 표 (초과 판매·처리량·재시도 횟수)".

```markdown
## 재고 락 전략 벤치마크

같은 도메인 코드와 같은 테스트를 두 어댑터에 돌린 결과다.
재현: `pnpm test:int apps/api/src/modules/inventory/adapters/out/persistence/stock-concurrency.integration.spec.ts`

| 전략 | 시나리오 | 성공 | 초과 판매 | 재시도 | 소요 |
|---|---|---|---|---|---|
| 비관적 (`SELECT FOR UPDATE`) | 재고 1 / 동시 50 | 1 | 0 | — | (측정값) |
| 낙관적 (`version`) | 재고 1 / 동시 50 | 1 | 0 | (측정값) | (측정값) |
| 비관적 | 재고 10 / 동시 30 | 10 | 0 | — | (측정값) |
| 낙관적 | 재고 10 / 동시 30 | 10 | 0 | (측정값) | (측정값) |

기본값은 비관적 락이다(`inventory.module.ts` 한 줄). 재고 차감은 짧고 명확한
임계 구역이라 잠금을 기다리는 편이 재시도를 반복하는 것보다 낫고, 위 재시도
수치가 그 판단의 근거다.
```

**측정값을 지어내지 않는다.** 실제로 관측한 숫자만 적고, 세 번의 실행에서 변동이 크면 범위로 적는다. 낙관적 쪽에서 `StockContentionError`가 나왔다면 그 건수도 표에 넣는다 — 스펙 §6.4가 예측한 "재시도 폭주"의 실제 관측이고 숨길 이유가 없다.

- [ ] **Step 3: 아키텍처 그래프를 시도한다**

```bash
pnpm arch:graph
```

계획 1의 보고서에 따르면 이 샌드박스에는 `graphviz`(`dot`)가 없다. 없으면 **README에 SVG를 넣지 말고**, 생성 방법(`pnpm arch:graph`)과 `graphviz`가 필요하다는 것만 적는다. 없는 파일을 참조하는 README가 더 나쁘다.

`docs/architecture.svg`는 `.gitignore`에 없다(`.dot`만 있다). 생성에 성공했다면 커밋할지 무시할지 정하고, 무시하기로 했다면 `.gitignore`에 한 줄 더한다 — 계획 2의 리뷰가 지적한 사항이다.

- [ ] **Step 4: 완료 기준을 점검한다**

아래를 하나씩 실제로 확인하고 결과를 보고서에 적는다.

**기능**
- [ ] 상품 등록 → SKU 가격 변경 → 조회·검색이 실제 Postgres 위에서 동작한다
- [ ] 재고 등록 → 예약 → 확정/해제가 동작하고 카운터와 예약 행이 어긋나지 않는다
- [ ] **예약 TTL이 만료되면 재고가 자동 회복된다** (스펙 §13의 성공 기준)
- [ ] 만료가 `StockReservationExpired`를 outbox에 남기고 릴레이가 그것을 발행한다

**아키텍처**
- [ ] `pnpm arch:check`가 통과하고 순환이 없다
- [ ] `modules/*/domain/**`에 `@nestjs`, `@prisma/client`, contracts import가 0건
- [ ] **`inventory.module.ts` 한 줄만 고쳐 락 전략을 바꿀 수 있다** (태스크 14의 프루브 (a)가 증명)
- [ ] catalog와 inventory는 서로도, 다른 모듈도 import하지 않는다

**테스트**
- [ ] **재고 1개에 동시 예약 50건 → 정확히 1건 성공이 두 락 전략 모두에서 통과** (스펙 §13)
- [ ] 같은 계약 테스트가 in-memory와 Prisma 리포지토리 양쪽에서 통과 (`StockRepository`는 셋)
- [ ] 태스크 13의 세 뮤테이션이 전부 초과 판매를 일으켰고 건수가 기록됐다
- [ ] `modules/*/domain/**` 95%/90%, `application/**` 90%/85%

**이월**
- [ ] 새로 생긴 이월 항목이 계획 문서 부록에 기록됐다

- [ ] **Step 5: 커밋**

```bash
git add README.md docs
git commit -m "docs: 락 전략 벤치마크 표와 계획 3 완료 기준 점검 결과를 남긴다"
```

---

## 완료 기준

이 계획이 끝났을 때 **스펙 §13의 성공 기준 중 다음이 참이어야 한다.**

- 예약 TTL이 만료되면 스케줄러가 재고를 자동 회복함
- 재고 1개에 동시 예약 50건 → 정확히 1건 성공이 **두 락 전략 모두에서** 통과
- 같은 계약 테스트가 in-memory와 Prisma 리포지토리 양쪽에서 통과
- README에 락 전략 벤치마크 표

나머지 기준(주문 E2E, 결제 거절 보상, 환불, 도메인 커버리지 전체)은 계획 4의 몫이다.

---

## 계획 4(Payment + Ordering + 사가)로 넘어가는 것

- **`Money.multiply(qty: Quantity)` 오버로드** — 스펙 §6.5의 시그니처다. 현재는 `multiply(factor: number)`뿐이라 주문 라인 합계를 `unitPrice.multiply(qty.value)`로 쓰게 되고, 그러면 모든 호출부에서 `.value`가 `Quantity` 밖으로 샌다. 계획 1의 최종 리뷰가 "첫 주문 라인이 쓰이기 전에 추가하라"고 남긴 항목이고, 그 시점이 계획 4다.
- **`Cart`의 단일 통화 불변식** — `money.ts`의 `CurrencyMismatchError` 주석에 `TODO(plan 4)`로 남아 있다. Cart가 통화가 다른 라인을 허용하면 `CurrencyMismatchError`(500)가 사용자에게 노출된다.
- **`catalog/index.ts`에 `findSkuPrices` 추가** — `CatalogPriceProvider` ACL이 부를 조회. 이 계획에서는 호출자가 없어 만들지 않았다.
- **`inventory` 이벤트 구독 어댑터** — `OrderPaid`/`OrderPaymentFailed`/`OrderCancelled`를 구독해 `ConfirmReservation`/`ReleaseReservation`을 부른다. 유스케이스는 이 계획에 있고 구독 배선만 남았다.
- **`relayOnce()`에 `FOR UPDATE SKIP LOCKED`가 없다** — 인스턴스가 둘이면 같은 이벤트를 두 번 보낸다. 문서화된 at-least-once 계약상 허용이지만, 그래서 **사가의 보상 핸들러가 진짜로 멱등해야 한다는 것이 선택이 아니라 요구사항**이 된다. `Reservation`의 전이 메서드가 `boolean`을 돌려주는 설계가 그 요구를 미리 갚아둔 것이다.
- **역할 기반 인가** — catalog와 inventory의 쓰기 엔드포인트가 인증만 걸려 있다(편차 3). `Principal`에 역할이 없어서다. 관리자 화면이 필요해지는 시점에 Identity로 돌아가야 한다.
