# Payment + Ordering + 주문 사가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장바구니에서 시작해 주문 → 재고 예약 → 결제 → 확정에 이르는 예약 기반 사가와, 결제 거절·주문 취소·TTL 만료 세 경로의 보상 트랜잭션을 완성한다.

**Architecture:** Ordering이 Core 컨텍스트로서 사가를 오케스트레이션한다 — `Order`의 상태 머신이 사가 상태를 겸하고 별도 사가 엔티티를 두지 않는다(스펙 §6.2). 동기 경로(가격 조회·재고 예약·결제 승인)는 ordering이 소유한 네 개의 아웃바운드 포트와 그 뒤의 in-process ACL 어댑터로 나가고, 역방향(재고 확정·환불 완료·예약 만료)은 outbox → 릴레이 → `EventEmitter2` → 구독 어댑터로만 돌아온다. 어느 단계가 유실돼도 계획 3이 만든 TTL 자가치유가 재고를 회복시킨다.

**Tech Stack:** Nest 12 · Prisma 7 (driver adapter) · PostgreSQL 16 · Zod 3 + ts-rest 3.52.1 · Vitest 3.2.7 · Biome · `@nestjs/event-emitter` 12 · `@nestjs/schedule` 12

**Spec:** `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`

**선행 계획:**
- `docs/superpowers/plans/2026-09-02-foundation-skeleton.md` (계획 1 — 골격, outbox, 커널)
- `docs/superpowers/plans/2026-09-02-identity-customer.md` (계획 2 — Identity, Customer)
- `docs/superpowers/plans/2026-09-03-catalog-inventory.md` (계획 3 — Catalog, Inventory, 락 전략, TTL 자가치유)

---

## Global Constraints

스펙의 프로젝트 전역 요구사항이다. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **도메인은 순수하다.** `apps/api/src/modules/*/domain/**`에 `@nestjs`, `@prisma/client`, `@commerce/contracts` import가 0건이어야 한다. `pnpm arch:check`의 `domain-is-pure`·`domain-must-not-know-dto`·`kernel-and-domain-use-no-npm-packages`가 강제한다.
- **도메인은 다른 컨텍스트를 공개 API로도 부르지 않는다.** `domain-imports-no-other-module`. 컨텍스트 간 통신은 애플리케이션 포트 → 어댑터로만 간다.
- **모듈 간 참조는 `index.ts`로만 한다.** `no-cross-module-internals`.
- **역방향 의존(Inventory → Ordering, Payment → Ordering)은 반드시 이벤트로만 간다** (스펙 §4.1). 직접 호출은 `no-circular`가 막는다.
- **애그리거트 간 참조는 ID로만 한다** (스펙 §5.1). `Order.customer: Customer`는 금지, `Order.customerId: CustomerId`만 허용.
- **경계를 넘을 때는 값만 복사한다** (스펙 §5.3). 가격과 주소는 주문 시점의 스냅샷으로 `Order` 안에 박제된다.
- **상태 전이는 애그리거트 안에서만 일어난다** (스펙 §5.4). 유스케이스가 `order.status = 'PAID'`를 대입하는 것은 금지하고 `order.markPaid(now)`만 허용한다.
- **`DomainError` 대 평문 `Error`**: 사용자가 고칠 수 있으면 `DomainError`(4xx), 데이터 손상이나 호출자 버그면 평문 `Error`(500). 계획 1의 M7.
- **값 객체의 `of` 대 `fromPersistence`**: 인바운드는 `of`(400), 영속 복원은 `fromPersistence`(500). 매퍼는 **반드시** `fromPersistence`를 쓴다.
- **금액은 `*_amount`(bigint 최소단위) + `*_currency` 두 컬럼**으로 저장하고 매퍼가 `Money`로 복원한다 (스펙 §10.8).
- **목 라이브러리를 쓰지 않는다** (스펙 §9.1). `vi.mock`, `vi.spyOn` 금지. 손으로 쓴 fake를 `testing/`에 둔다.
- **리포지토리는 계약 테스트를 공유한다** (스펙 §9.2). 같은 스위트가 in-memory 구현과 Prisma 구현 양쪽에서 통과해야 한다.
- **커버리지 임계값**: `modules/*/domain/**` 95%/90%, `modules/*/application/**` 90%/85%. 어댑터에는 목표를 걸지 않는다.
- **Vitest `coverage.all`이 켜져 있다.** `import type`으로만 쓰이는 포트 파일은 런타임에 로드되지 않아 0%로 잡히고 임계값을 실패시킨다. 모듈마다 `port-tokens.spec.ts`를 두어 토큰을 실제로 로드한다.
- **버전을 고정한다.** 새 의존성을 설치할 때 `pnpm add pkg@^X.Y.Z` 형태로 정확한 범위를 쓴다.
- **`pnpm verify`가 exit 0이어야 커밋한다.** `verify`는 `lint → arch:check → typecheck → build → test:coverage` 순이다. `&&`로 `verify`와 `git commit`을 한 줄에 잇지 말 것 — 계획 3에서 실패한 verify 뒤에 커밋이 나가는 사고가 두 번 났다.
- **Biome 포맷은 `pnpm biome check --write <path>`로 맞춘다.** 계획서에서 복사한 코드는 거의 항상 포맷이 어긋난다.

---

## 이 계획의 범위 — 왜 프론트엔드 E2E가 빠졌는가

스펙 §13의 성공 기준은 두 개의 독립된 서브시스템을 요구한다.

1. **백엔드** — Payment 컨텍스트, Ordering 컨텍스트, 사가와 보상, 이벤트 구독
2. **프론트엔드** — 상점 UI(FSD `entities`/`features`/`widgets`/`views`)와 Playwright 브라우저 E2E

현재 `apps/web`에는 BFF 골격(`app/api/auth/*`, `src/server/*`, `shared/lib`)만 있고 `entities` 이상의 레이어가 존재하지 않으며 Playwright도 설치돼 있지 않다. 상점 화면을 짓는 것은 다른 도구(Playwright), 다른 아키텍처(FSD), 다른 테스트 전략(§9.9의 MSW + 컴포넌트 테스트)을 쓰는 별개의 작업이다.

**이 계획은 백엔드만 한다.** 사가의 세 경로는 브라우저 없이 **API 레벨 E2E**로 검증한다 — 실제 Nest 앱 + 실제 Postgres + 실제 outbox 릴레이 + 실제 이벤트 체인을 supertest로 관통하는 통합 테스트다. 이것이 스펙 §9.8의 "사가 전체 — 결제 실패 → 예약 해제까지 이벤트 체인이 실제로 도는지"가 요구하는 층위이며, §9.10의 브라우저 E2E는 계획 5로 넘긴다.

계획 5(프론트엔드 상점 + Playwright)가 이 계획 다음에 온다. 이 계획이 끝나면 그 계획이 호출할 API가 전부 존재한다.

---

## 이 계획이 감수하는 편차

스펙과 다르게 가는 지점이다. 각각 왜 그런지 적는다.

### 편차 1 — `Order`에 `REFUND_PENDING` 상태를 추가한다

스펙 §5.4의 상태 머신은 `PAID --취소 요청--> REFUNDED`로 그려져 있다. 그대로 만들면 취소 요청 시점과 환불 완료 시점 사이에 주문이 `PAID`로 남는다. 그 구간에서 두 가지가 깨진다.

- **고객에게 거짓말을 한다.** 취소를 눌렀는데 주문 목록에는 여전히 "결제 완료"로 보인다.
- **취소가 멱등하지 않다.** `OrderCancelled`는 outbox를 거쳐 at-least-once로 배달된다(스펙 §6.3). 같은 이벤트가 두 번 도착하면 `PAID` 상태의 주문이 두 번 취소되고 환불이 두 번 요청된다.

`PAID --cancelBy--> REFUND_PENDING --PaymentRefunded--> REFUNDED`로 만든다. 두 번째 `cancelBy`는 `REFUND_PENDING`을 보고 `false`를 돌려주며 아무 이벤트도 발행하지 않는다 — 계획 3의 `Reservation` 전이 메서드가 `boolean`을 돌려주는 것과 같은 설계다. `Payment.refund()`도 독립적으로 멱등하게 만들어 그물을 둘로 둔다.

스펙의 다이어그램이 이 상태를 빠뜨린 것은 행복 경로만 그렸기 때문이고, at-least-once 배달을 전제하면 중간 상태가 강제된다.

### 편차 2 — 계획 3의 TODO "Cart에 단일 통화 불변식"을 `Order`로 옮긴다

`shared/kernel/money.ts`의 `CurrencyMismatchError` 주석에 `TODO(plan 4): Cart에 단일 통화 불변식을 추가해 이 경로 자체가 발생하지 않도록 한다`가 남아 있다.

그런데 **`Cart`에는 가격이 없다.** 스펙 §10.8의 `cart_lines`는 `cart_id, sku_id, quantity`뿐이다. 장바구니는 "무엇을 몇 개"만 들고, 가격은 주문 시점에 Catalog에서 스냅샷으로 가져온다(스펙 §5.3). 통화가 처음 만나는 지점은 `Cart`가 아니라 **주문 라인을 조립하는 순간**이다.

그래서 불변식을 `Order.place()`에 둔다. 서로 다른 통화의 라인이 섞이면 `MixedCurrencyOrderError`(`DomainError`, 422)를 던지고, `Money.plus`의 `CurrencyMismatchError`(평문 `Error`, 500)에는 영영 도달하지 않는다. TODO의 **의도**(통화 불일치가 500으로 새지 않게 한다)는 그대로 지키고 **위치**만 바꾼다. 태스크 9에서 `money.ts`의 TODO 주석을 갱신한다.

### 편차 3 — PG 웹훅은 주문을 움직이지 않는다. 정합성 기록 전용이다

스펙 §7.6은 payment의 인바운드에 `HandlePgCallback(webhook, 멱등)`을 적었고 §10.8은 `payment_attempts.pg_tx_id` 유니크로 멱등을 보장하라고 했다. 둘 다 만든다.

다만 **웹훅이 주문 상태를 바꾸지는 않는다.** `PlaceOrderService`가 `PaymentGateway.authorize()`의 반환값으로 이미 동기적으로 `markPaid`/`failPayment`를 결정한다(스펙 §6.2의 3~4단계). 웹훅까지 주문을 움직이게 하면 `PAID`에 이르는 경로가 둘이 되고, 두 경로가 경합할 때의 순서 문제를 다루느라 사가 표면이 두 배가 된다 — 이 프로젝트가 가르치려는 것(예약 기반 사가와 보상)과 무관한 복잡도다.

웹훅은 늦게 오거나 중복으로 오는 PG 콜백을 받아 **결제 시도 이력을 남기고 `Payment`의 상태를 정합시킨다.** 같은 `pgTxId`로 두 번 오면 두 번째는 아무것도 하지 않는다. 실서비스라면 비동기 경로가 주문을 움직여야 하고, 그것은 백로그다.

### 편차 4 — 부분 환불을 만들지 않는다

스펙 §5.1의 payment 불변식은 "승인액 = 주문 금액, 환불 ≤ 승인액"이다. 이 계획은 **전액 환불만** 만든다. 부분 환불은 주문 라인 단위 반품 정책을 요구하고, 스펙 §1.3이 반품 프로세스를 범위 밖으로 명시했다. 전액 환불만 있으면 "환불 ≤ 승인액"은 자동으로 참이므로, 불변식은 `refund()`가 `AUTHORIZED` 상태에서만 성립한다는 전이 규칙으로 대신 표현한다.

### 편차 5 — `OutboxRelay`에 `FOR UPDATE SKIP LOCKED`를 넣지 않는다

계획 3의 부록이 남긴 이월이다. 릴레이 인스턴스가 둘이면 같은 outbox 행을 둘 다 집어 같은 이벤트를 두 번 보낸다.

넣지 않는 이유: 배포 모델이 단일 인스턴스이고, **at-least-once는 이미 문서화된 계약이며 이 계획이 그 계약을 실제로 갚는다.** `Reservation`의 전이 메서드, `Order`의 전이 메서드, `Payment.refund()`가 전부 `boolean`을 돌려주는 멱등 연산이고, 태스크 21이 같은 이벤트를 두 번 흘려 부수 효과가 한 번만 나는 것을 확인한다. 소비자 멱등성이 진짜 방어선이고 `SKIP LOCKED`는 최적화다. 멀티 인스턴스로 가는 시점에 넣는다.

### 편차 6 — 역할 기반 인가를 만들지 않는다

계획 3의 편차 3을 그대로 승계한다. `Principal`에 역할이 없어 catalog·inventory의 쓰기 엔드포인트가 인증만 걸려 있다. Ordering의 엔드포인트는 **전부 본인 데이터**를 다루므로 이 결함의 영향을 받지 않는다 — 그리고 "본인 주문만 취소 가능"은 스펙 §5.5가 명시한 대로 가드가 아니라 도메인(`Order.cancelBy`)에 둔다.

---

## 계획 1~3이 남긴 이월 중 이 계획이 처리하는 것

| 이월 | 출처 | 이 계획에서 |
|---|---|---|
| `Money.multiply(qty: Quantity)` 오버로드 | 계획 1 최종 리뷰 | **태스크 1** — 첫 주문 라인이 쓰이기 직전이 그 시점이다 |
| `Cart` 단일 통화 불변식 | `money.ts`의 `TODO(plan 4)` | **태스크 9** — 편차 2에 따라 `Order.place()`에 둔다 |
| `catalog/index.ts`에 SKU 가격 조회 추가 | 계획 3 부록 | **태스크 16** — `CatalogPriceProvider` ACL이 부를 대상 |
| `customer/index.ts`에 주소 조회 노출 | 계획 3 부록(암묵) | **태스크 16** — `CustomerAddressProvider` ACL이 부를 대상 |
| inventory 이벤트 구독 어댑터 | 계획 3 부록 | **태스크 17·18** |
| `OutboxRelay`의 `SKIP LOCKED` | 계획 3 부록 | 처리하지 않는다 — 편차 5 |
| 역할 기반 인가 | 계획 3 편차 3 | 처리하지 않는다 — 편차 6 |

---

## 계획 1~3 산출물 중 수정하는 것

| 파일 | 무엇을 |
|---|---|
| `apps/api/src/shared/kernel/money.ts` | `multiply(Quantity \| number)` 오버로드, `TODO(plan 4)` 주석 갱신 |
| `apps/api/prisma/schema.prisma` | `Cart`, `CartLine`, `Order`, `OrderLine`, `Payment`, `PaymentAttempt` 추가 |
| `apps/api/src/modules/inventory/domain/reservation.ts` | `RESTORED` 상태와 `restore()` 전이 추가 |
| `apps/api/src/modules/inventory/domain/stock-item.ts` | `restore(quantity)` 추가 — 확정된 재고를 되돌린다 |
| `apps/api/src/modules/inventory/application/ports/out/reservation.repository.ts` | `findByOrderId(orderId, tx?)` 추가 |
| `apps/api/src/modules/inventory/index.ts` | per-order 유스케이스 셋 내보내기 |
| `apps/api/src/modules/catalog/index.ts` | `FindSkuPricesQuery` 내보내기 |
| `apps/api/src/modules/customer/index.ts` | `GetAddressBookQuery`와 `AddressView` 내보내기 |
| `apps/api/src/modules/customer/customer.module.ts` | `GET_ADDRESS_BOOK_QUERY`를 Nest `exports`에 추가 |
| `apps/api/src/app.module.ts` · `app.module.spec.ts` | `PaymentModule`, `OrderingModule` 등록과 배선 단언 |
| `packages/contracts/src/index.ts` · `api.contract.ts` | cart·order·payment 계약 등록 |

---

## File Structure

### modules/payment — 포트 뒤에 숨긴 컨텍스트

스펙 §4의 분류로 Supporting이고 "포트 뒤에 숨김"이다. 도메인은 상태 머신 하나와 시도 이력이 전부다.

```
modules/payment/
├── index.ts                                    공개 API — 유스케이스 셋과 모듈만
├── payment.module.ts
├── domain/
│   ├── payment.ts              애그리거트 루트. 상태 머신 + PaymentAttempt[]
│   ├── payment.spec.ts
│   ├── payment-attempt.ts      엔티티(VO 아님 — pgTxId로 식별된다)
│   ├── payment.events.ts       PaymentRefunded
│   └── payment.errors.ts       PaymentConflictError / PaymentNotFoundError / DuplicatePgTxIdError
├── application/
│   ├── ports/
│   │   ├── in/{authorize-payment, refund-payment, handle-pg-callback}.usecase.ts
│   │   ├── out/{payment.repository.ts, pg-client.ts}
│   │   └── port-tokens.spec.ts
│   └── services/{authorize-payment, refund-payment, handle-pg-callback}.service.ts + spec
├── adapters/
│   ├── in/
│   │   ├── http/{pg-webhook.controller.ts, payment-domain-error-mappings.ts}
│   │   └── events/payment-event.subscriber.ts       OrderCancelled → 환불
│   └── out/
│       ├── persistence/{prisma-payment.repository.ts, payment.mapper.ts}
│       └── pg/fake-pg.adapter.ts                     APPROVE / DECLINE / TIMEOUT
└── testing/{in-memory-payment.repository.ts, payment-repository.contract.ts, payment.fixtures.ts}
```

**`PgClient` 포트와 `FakePgAdapter`가 이 컨텍스트의 존재 이유다.** 스펙 §7.6은 "단순 스텁이 아니라 실패를 주문형으로 만들어내는 도구"라고 못박았다. 사가의 보상 경로를 테스트하려면 결제 실패를 마음대로 일으킬 수 있어야 한다.

### modules/ordering — Core. 이 프로젝트에서 유일하게 전부 갖추는 컨텍스트

```
modules/ordering/
├── index.ts                                    공개 API
├── ordering.module.ts
├── domain/
│   ├── cart/{cart.ts, cart.spec.ts, cart-line.ts, cart.errors.ts}
│   ├── order/
│   │   ├── order.ts             애그리거트 루트 + 상태 머신 + 도메인 인가
│   │   ├── order.spec.ts
│   │   ├── order-line.ts        VO — 가격 스냅샷
│   │   ├── shipping-address.ts  VO — 주소 스냅샷 (id도 label도 없다)
│   │   ├── order-status.ts      상태 타입과 전이표
│   │   ├── order.events.ts      OrderPlaced / OrderPaid / OrderPaymentFailed / OrderCancelled
│   │   └── order.errors.ts
│   └── priced-item.ts           ACL 결과 타입. Catalog의 Product가 아니다
├── application/
│   ├── ports/
│   │   ├── in/
│   │   │   ├── {add-item-to-cart, remove-item-from-cart, change-cart-item-quantity}.usecase.ts
│   │   │   ├── {place-order, cancel-order}.usecase.ts
│   │   │   ├── {handle-payment-refunded, handle-stock-reservation-expired}.usecase.ts
│   │   │   └── queries/{get-cart, get-order, list-my-orders}.query.ts
│   │   ├── out/
│   │   │   ├── {cart.repository.ts, order.repository.ts, order.query.ts}
│   │   │   ├── catalog-price.provider.ts        ACL
│   │   │   ├── customer-address.provider.ts     ACL
│   │   │   ├── inventory-reserver.ts            ACL
│   │   │   └── payment.gateway.ts               ACL
│   │   └── port-tokens.spec.ts
│   └── services/
│       ├── manage-cart.service.ts               장바구니 유스케이스 셋을 한 서비스가 구현
│       ├── place-order.service.ts               ★ 사가 오케스트레이션
│       ├── cancel-order.service.ts
│       ├── {get-cart, get-order, list-my-orders}.service.ts
│       └── handlers/{on-payment-refunded, on-stock-reservation-expired}.service.ts
├── adapters/
│   ├── in/
│   │   ├── http/{cart.controller.ts, order.controller.ts, ordering-domain-error-mappings.ts}
│   │   └── events/ordering-event.subscriber.ts
│   └── out/
│       ├── persistence/{prisma-cart.repository.ts, prisma-order.repository.ts,
│       │                prisma-order.query.ts, cart.mapper.ts, order.mapper.ts}
│       ├── catalog/in-process-catalog.adapter.ts
│       ├── customer/in-process-customer.adapter.ts
│       ├── inventory/in-process-inventory.adapter.ts
│       └── payment/in-process-payment.adapter.ts
└── testing/
    ├── in-memory-{cart,order}.repository.ts
    ├── {cart,order}-repository.contract.ts
    ├── fake-{catalog-price.provider, customer-address.provider,
    │         inventory-reserver, payment.gateway}.ts
    └── ordering.fixtures.ts
```

**`manage-cart.service.ts`가 유스케이스 셋을 한 파일로 구현하는 이유.** 세 연산(추가·제거·수량 변경)이 전부 "고객의 장바구니를 찾거나 만들고, 애그리거트 메서드를 한 번 부르고, 저장한다"는 동일한 세 줄이다. 파일을 셋으로 나누면 그 세 줄이 세 번 복제된다. 포트는 셋으로 나눠 둔다 — 컨트롤러와 DI가 보는 표면은 유스케이스 단위여야 하고, 나중에 하나가 복잡해지면 그 하나만 떼어내면 된다. 계획 2의 `ManageAddressesService`가 같은 판단을 했고 그 형태를 따른다.

**네 개의 ACL 어댑터가 각각 한 파일인 이유.** 스펙 §4.2가 정확히 이것을 요구한다 — "같은 프로세스 안에서 두 겹 감싸는 것은 약간 과하다. 유지하는 이유는 이 5줄이 Inventory를 별도 서비스로 떼어낼 때 고칠 유일한 파일이기 때문이다." 스펙 §13의 성공 기준에도 "`InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음"이 들어 있다.

### modules/inventory — 수정

```
modules/inventory/
├── domain/reservation.ts             RESTORED 상태와 restore() 전이 추가
├── domain/stock-item.ts              restore(quantity) 추가
├── application/
│   ├── ports/out/reservation.repository.ts    findByOrderId 추가
│   ├── ports/in/{confirm-reservations-for-order,
│   │             release-reservations-for-order,
│   │             restore-reservations-for-order}.usecase.ts    새로 추가
│   └── services/reservations-for-order.service.ts              셋을 한 파일로
├── adapters/in/events/inventory-event.subscriber.ts            새로 추가
└── index.ts                          per-order 유스케이스 셋 내보내기
```

**per-order 유스케이스를 새로 만드는 이유.** 계획 3은 `ConfirmReservationUseCase({reservationId})`를 만들었다. 그런데 이벤트가 실어 나르는 것은 `orderId`다 — `OrderPaid`의 payload에 예약 ID 목록을 넣으려면 `Order`가 Inventory의 식별자를 들고 있어야 하고, 그것은 스펙 §5.1의 "애그리거트 간 참조는 ID로만"을 넘어 **다른 컨텍스트의 내부 식별자를 Core 애그리거트에 박는** 결합이다. `Reservation`은 이미 `orderId`를 갖고 `reservations.order_id`에 인덱스도 있으므로, Inventory 쪽이 주문 단위로 찾아 처리하는 편이 옳다. 계획 3의 per-reservation 유스케이스는 그대로 두고 그 위에 얇은 래퍼를 얹는다.

### packages/contracts

```
packages/contracts/src/
├── ordering/{cart.contract.ts, order.contract.ts} + spec
├── payment/payment.contract.ts + spec        PG 웹훅
├── index.ts                                   재수출 추가
└── api.contract.ts                            BFF 루트에 cart·order 추가
```

### 사가 E2E

```
apps/api/test/saga/
├── place-order.e2e.spec.ts        성공 경로 — 주문 → 예약 → 승인 → 확정
├── payment-declined.e2e.spec.ts   보상 — 거절 → 예약 해제 → 재고 복귀
├── cancel-paid-order.e2e.spec.ts  보상 — 취소 → 환불 → 재고 복원
└── saga-support.ts                공용 헬퍼 (가입·상품·재고 준비, 릴레이 강제 실행)
```

`apps/api/test/` 아래에 두는 이유: 여러 모듈을 관통하므로 어느 모듈에도 속하지 않고, `tsconfig.json`의 `rootDir: "src"` 밖이라 빌드 대상에서 자연히 빠진다. 계획 3에서 `testing/` 아래의 계약 파일이 `test/setup/database`를 import해 TS6059가 났던 것과 반대 방향의 이유다.

---

## 태스크

각 태스크는 **Step 5(또는 마지막 직전 단계)에 "이 검사가 무엇을 잡는지 증명한다"** 를 갖는다. 방금 쓴 테스트를 통과시킨 코드를 일부러 훼손해 그 테스트가 실제로 실패하는지 확인하고, 되돌린 뒤 다시 통과하는 것까지 본다. 계획 2·3에서 이 단계가 "아무것도 검증하지 않는 테스트"를 여러 번 잡아냈다.

**프루브를 트리에 남기지 않는다.** 되돌린 뒤 `git diff`가 비어 있는 것을 확인하고 커밋한다.

---

### Task 1: 공유 커널 — `Money.multiply(Quantity)`와 합계

**Files:**
- Modify: `apps/api/src/shared/kernel/money.ts`
- Modify: `apps/api/src/shared/kernel/money.spec.ts`

**Interfaces:**
- Produces: `Money.multiply(times: Quantity | number): Money`, `Money.sum(values: readonly Money[], fallbackCurrency?: Currency): Money`

**계획 1의 이월을 닫는다.** 최종 리뷰가 "첫 주문 라인이 쓰이기 전에 추가하라"고 남긴 항목이고, 태스크 8의 `OrderLine.subtotal`이 그 첫 호출자다. 지금 넣지 않으면 모든 호출부가 `unitPrice.multiply(qty.value)`가 되어 `.value`가 `Quantity` 밖으로 샌다 — 값 객체를 만든 이유가 사라지는 지점이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`money.spec.ts`에 더한다.

```ts
import { Quantity } from './quantity';

describe('Money.multiply — Quantity 오버로드', () => {
  it('Quantity를 곱한다', () => {
    // 스펙 §6.5의 시그니처다. .value를 꺼내 쓰면 Quantity의 불변식이 호출부로 샌다.
    expect(Money.of(1200).multiply(Quantity.positive(3)).amount).toBe(3600n);
  });

  it('수량 0을 곱하면 0원이다', () => {
    expect(Money.of(1200).multiply(Quantity.of(0)).amount).toBe(0n);
  });

  it('통화는 그대로 유지된다', () => {
    expect(Money.of(500, 'USD').multiply(Quantity.positive(2)).currency).toBe('USD');
  });

  it('number 오버로드도 그대로 동작한다', () => {
    // 기존 호출부를 깨지 않는다.
    expect(Money.of(1200).multiply(3).amount).toBe(3600n);
  });
});

describe('Money.sum', () => {
  it('여러 금액을 더한다', () => {
    const total = Money.sum([Money.of(1000), Money.of(2500), Money.of(300)]);
    expect(total.amount).toBe(3800n);
  });

  it('빈 배열이면 fallback 통화의 0원이다', () => {
    // 주문에 라인이 없는 경우는 Order가 막지만, sum 자체는 총계 계산기로서
    // 빈 입력에 답을 내야 한다. 통화를 추론할 근거가 없으므로 인자로 받는다.
    expect(Money.sum([], 'USD')).toEqual(Money.zero('USD'));
    expect(Money.sum([])).toEqual(Money.zero('KRW'));
  });

  it('통화가 섞이면 CurrencyMismatchError다', () => {
    // 이 예외에 도달하는 것은 호출자의 버그다. 주문 경로에서는 Order.place가
    // 먼저 MixedCurrencyOrderError(422)로 막는다(태스크 9).
    expect(() => Money.sum([Money.of(100, 'KRW'), Money.of(100, 'USD')])).toThrow(
      CurrencyMismatchError,
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/shared/kernel/money.spec.ts`
Expected: FAIL — `multiply`가 `Quantity`를 받지 못하고(타입 에러) `Money.sum`이 없다.

- [ ] **Step 3: 구현한다**

`money.ts`의 `multiply`를 바꾸고 `sum`을 더한다. `import type { Quantity } from './quantity';`를 파일 상단에 추가한다 — 같은 커널 안이라 `kernel-is-pure`에 걸리지 않는다.

```ts
  /**
   * 반올림이 생기지 않도록 정수 배수만 허용한다.
   *
   * `Quantity` 오버로드가 스펙 §6.5가 적은 시그니처다. `number`도 계속 받는 이유는
   * 수량이 아닌 배수(예: 2배 프로모션)가 있을 수 있기 때문이고, 주문 라인처럼
   * 수량을 곱하는 자리에서는 반드시 `Quantity`를 넘긴다 — `.value`를 꺼내 쓰면
   * `Quantity`가 지키던 "정수이고 음수가 아니다"가 호출부의 책임으로 돌아온다.
   */
  multiply(times: Quantity | number): Money {
    const factor = typeof times === 'number' ? times : times.value;
    if (!Number.isInteger(factor)) {
      throw new InvalidMoneyError(`배수는 정수여야 합니다: ${factor}`);
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  /**
   * 합계. 빈 배열이면 통화를 추론할 근거가 없으므로 `fallbackCurrency`의 0원을 준다.
   *
   * 주문 총액이 이 함수 하나로 계산된다. 호출부마다 `reduce`를 손으로 쓰면
   * 통화 검사를 빠뜨린 곳이 하나쯤 생기고, 금액 버그는 커머스에서 가장 비싸다.
   */
  static sum(values: readonly Money[], fallbackCurrency: Currency = 'KRW'): Money {
    const first = values[0];
    if (first === undefined) {
      return Money.zero(fallbackCurrency);
    }
    return values.slice(1).reduce((acc, value) => acc.plus(value), first);
  }
```

`multiply` 안의 `Number.isInteger` 검사는 `Quantity`를 받을 때는 항상 참이다(생성자가 이미 보장한다). `number` 경로를 위해 남긴다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/shared/kernel/money.spec.ts`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 통화 검사가 `sum`에 있는가**
`sum`의 `reduce`를 `acc.plus(value)` 대신 `Money.of(acc.amount + value.amount, acc.currency)`로 바꾼다(통화 검사를 우회).
Expected: FAIL — `'통화가 섞이면 CurrencyMismatchError다'`가 실패한다.
되돌린다.

**(b) `Quantity` 경로가 실제로 `.value`를 쓰는가**
`const factor = typeof times === 'number' ? times : 1;`로 바꾼다.
Expected: FAIL — `'Quantity를 곱한다'`가 `3600n`을 기대하는데 `1200n`을 받아 실패한다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/shared/kernel
git commit -m "feat(kernel): Money에 Quantity 곱셈과 합계를 추가한다"
```

---

### Task 2: 영속 스키마 — 장바구니·주문·결제

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_ordering_payment/migration.sql` (생성물)
- Modify: `apps/api/test/schema/indexes.integration.spec.ts`

**Interfaces:**
- Produces: Prisma 모델 `Cart`, `CartLine`, `Order`, `OrderLine`, `Payment`, `PaymentAttempt`

**스펙 §10.8을 그대로 옮긴다.** 금액은 `*_amount`(bigint) + `*_currency` 두 컬럼이고 매퍼가 `Money`로 복원한다.

- [ ] **Step 1: 모델을 추가한다**

`schema.prisma` 끝에 붙인다.

```prisma
model Cart {
  id         String     @id @db.Uuid
  customerId String     @unique @map("customer_id") @db.Uuid
  createdAt  DateTime   @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime   @map("updated_at") @db.Timestamptz(3)
  lines      CartLine[]

  @@map("carts")
}

model CartLine {
  cartId   String @map("cart_id") @db.Uuid
  skuId    String @map("sku_id") @db.Uuid
  quantity Int
  cart     Cart   @relation(fields: [cartId], references: [id], onDelete: Cascade)

  /// 같은 SKU가 한 장바구니에 두 줄로 들어가지 않는다(스펙 §5.1의 Cart 불변식).
  /// 도메인도 같은 규칙을 지키지만, DB가 마지막 방어선이다.
  @@id([cartId, skuId])
  @@map("cart_lines")
}

model Order {
  id                String      @id @db.Uuid
  customerId        String      @map("customer_id") @db.Uuid
  status            String
  totalAmount       BigInt      @map("total_amount")
  totalCurrency     String      @map("total_currency")
  /// 배송지 스냅샷. Customer의 SavedAddress를 참조하지 않는다 — 고객이 이사해서
  /// 주소록을 고쳐도 과거 주문의 배송지는 그대로 남아야 한다(스펙 §5.3).
  shipRecipient     String      @map("ship_recipient")
  shipPhone         String      @map("ship_phone")
  shipZip           String      @map("ship_zip")
  shipLine1         String      @map("ship_line1")
  shipLine2         String?     @map("ship_line2")
  placedAt          DateTime    @map("placed_at") @db.Timestamptz(3)
  updatedAt         DateTime    @map("updated_at") @db.Timestamptz(3)
  lines             OrderLine[]

  /// ListMyOrders가 이 인덱스를 쓴다 — 최신 주문부터.
  @@index([customerId, placedAt(sort: Desc)], map: "orders_customer_placed_at_idx")
  @@map("orders")
}

model OrderLine {
  orderId           String @map("order_id") @db.Uuid
  skuId             String @map("sku_id") @db.Uuid
  /// 가격 스냅샷. Catalog의 Product를 참조하지 않는다 — 상품 가격이 바뀌어도
  /// 과거 주문 금액은 따라 바뀌지 않는다(스펙 §5.3).
  nameSnapshot      String @map("name_snapshot")
  unitPriceAmount   BigInt @map("unit_price_amount")
  unitPriceCurrency String @map("unit_price_currency")
  quantity          Int
  order             Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)

  /// VO라 자체 id가 없다(스펙 §10.8). (order_id, sku_id)가 자연키다.
  @@id([orderId, skuId])
  @@map("order_lines")
}

model Payment {
  id               String           @id @db.Uuid
  /// FK를 걸지 않는다. Payment는 Ordering과 다른 컨텍스트이고, DB 제약으로 두
  /// 컨텍스트를 묶으면 나중에 결제를 별도 서비스로 떼어낼 때 스키마가 발목을 잡는다.
  /// 계획 3이 reservations에 내린 것과 같은 판단이다.
  orderId          String           @unique @map("order_id") @db.Uuid
  status           String
  authorizedAmount BigInt           @map("authorized_amount")
  currency         String
  createdAt        DateTime         @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime         @map("updated_at") @db.Timestamptz(3)
  attempts         PaymentAttempt[]

  @@map("payments")
}

model PaymentAttempt {
  id          String   @id @db.Uuid
  paymentId   String   @map("payment_id") @db.Uuid
  /// PG 거래 식별자. 유니크가 웹훅 멱등성의 근거다(스펙 §10.8) — 같은 콜백이
  /// 두 번 와도 두 번째 INSERT가 P2002로 튕긴다.
  pgTxId      String   @unique @map("pg_tx_id")
  result      String
  reason      String?
  attemptedAt DateTime @map("attempted_at") @db.Timestamptz(3)
  payment     Payment  @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@index([paymentId])
  @@map("payment_attempts")
}
```

- [ ] **Step 2: 마이그레이션을 만든다**

```bash
pnpm --filter @commerce/api exec prisma migrate dev --name ordering_payment
```

생성된 `migration.sql`을 **읽는다.** `DROP` 문이 하나라도 있으면 멈춘다 — 이 마이그레이션은 순수하게 추가만 해야 한다. 계획 3에서 같은 확인을 했다.

- [ ] **Step 3: 인덱스 감시 테스트를 확장한다**

`apps/api/test/schema/indexes.integration.spec.ts`에 더한다. 계획 3이 `reservations_expires_at_idx`에 한 것과 같은 형태다 — 존재 확인 + EXPLAIN 프루브.

```ts
describe('주문 목록 인덱스', () => {
  it('orders_customer_placed_at_idx가 존재한다', async () => {
    const db = await testDb();
    const rows = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'orders'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('orders_customer_placed_at_idx');
  });

  it('내 주문 목록 조회가 그 인덱스를 쓴다', async () => {
    // 인덱스가 "존재한다"는 것과 "쿼리가 쓴다"는 것은 다르다. 정렬 방향이
    // 어긋나면 인덱스는 그대로 있는데 플래너가 Seq Scan + Sort로 간다.
    const db = await testDb();
    const customerId = '018f2b1c-4a5d-7e6f-8a9b-0c1d0a000001';
    const values = Array.from({ length: 5000 }, (_, i) => {
      const id = `018f2b1c-4a5d-7e6f-8a9b-${i.toString(16).padStart(12, '0')}`;
      const owner = i % 50 === 0 ? customerId : `018f2b1c-4a5d-7e6f-8a9b-1${i.toString(16).padStart(11, '0')}`;
      return `('${id}','${owner}','PENDING_PAYMENT',1000,'KRW','수령인','010','12345','서울',NULL,now() - interval '${i} minutes', now())`;
    }).join(',');
    await db.$executeRawUnsafe(
      `INSERT INTO orders (id, customer_id, status, total_amount, total_currency,
         ship_recipient, ship_phone, ship_zip, ship_line1, ship_line2, placed_at, updated_at)
       VALUES ${values}`,
    );
    await db.$executeRawUnsafe('ANALYZE orders');

    const plan = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `EXPLAIN SELECT * FROM orders WHERE customer_id = '${customerId}'
         ORDER BY placed_at DESC LIMIT 20`,
    );
    const planText = plan.map((row) => Object.values(row).join(' ')).join('\n');
    expect(planText).toContain('orders_customer_placed_at_idx');
  });
});
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test:int apps/api/test/schema`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 정렬 방향이 인덱스에 박혀 있는가**
`schema.prisma`의 `@@index([customerId, placedAt(sort: Desc)])`를 `@@index([customerId])`로 바꾸고 마이그레이션을 다시 만든다.
Expected: 관측 결과를 보고서에 적는다. Postgres는 단일 컬럼 인덱스로도 `customer_id` 필터를 태울 수 있으므로 **인덱스 이름은 여전히 플랜에 나올 수 있다.** 그 경우 `Sort` 노드가 플랜에 추가되는지 확인하고, 나온다면 그 사실을 적는다 — "인덱스를 쓴다"는 단언만으로는 정렬 회귀를 잡지 못한다는 뜻이고, 그것이 이 프루브가 알려주는 것이다.
되돌린다(스키마와 마이그레이션 둘 다).

**(b) `cart_lines`의 복합 기본키가 중복을 막는가**
```sql
INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES ('...', '...', now(), now());
INSERT INTO cart_lines (cart_id, sku_id, quantity) VALUES ('...', '...', 1);
INSERT INTO cart_lines (cart_id, sku_id, quantity) VALUES ('...', '...', 2);  -- 같은 값
```
Expected: 두 번째가 유니크 위반으로 실패한다. 원시 SQL로 직접 확인하고 결과를 보고서에 적는다. (테스트로 남기지는 않는다 — 태스크 15의 `CartRepository` 계약이 같은 성질을 도메인 레벨에서 덮는다.)

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/prisma apps/api/test/schema
git commit -m "feat(db): 장바구니·주문·결제 테이블과 주문 목록 인덱스 감시를 추가한다"
```

---

### Task 3: Payment 도메인 — 상태 머신과 시도 이력

**Files:**
- Create: `apps/api/src/modules/payment/domain/payment.errors.ts`
- Create: `apps/api/src/modules/payment/domain/payment-attempt.ts`
- Create: `apps/api/src/modules/payment/domain/payment.events.ts`
- Create: `apps/api/src/modules/payment/domain/payment.ts` + `payment.spec.ts`
- Create: `apps/api/src/modules/payment/testing/payment.fixtures.ts`

**Interfaces:**
- Consumes: `Money`, `PaymentId`, `OrderId`, `AggregateRoot`, `DomainError`
- Produces:
  - `PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'DECLINED' | 'REFUNDED'`
  - `PaymentAttempt` — `{ id: string; pgTxId: string; result: 'APPROVED' | 'DECLINED'; reason: string | null; attemptedAt: Date }`
  - `Payment.open({ id, orderId, amount, now }): Payment`
  - `Payment.rehydrate({ id, orderId, amount, status, attempts }): Payment`
  - `payment.authorize(attempt): boolean` / `payment.decline(attempt): boolean` / `payment.refund(now): boolean`
  - `payment.recordCallback(attempt): boolean`
  - `PAYMENT_REFUNDED = 'payment.PaymentRefunded'`, `paymentRefunded(payment, occurredAt): DomainEvent`
  - `PaymentConflictError`(409) / `PaymentNotFoundError`(404) / `PaymentAmountMismatchError`(평문 `Error`) / `CorruptedPaymentError`(평문 `Error`)

**전이표 — 이 태스크의 계약이다**

`OrderCancelled`가 at-least-once로 배달되므로 `refund`가 두 번 불릴 수 있다(스펙 §6.3). 계획 3의 `Reservation`과 같은 규약을 쓴다: **성공하면 `true`, 이미 그 상태면 `false`, 되돌릴 수 없는 전이는 던진다.**

| 현재 | `authorize` | `decline` | `refund` |
|---|---|---|---|
| `PENDING` | → `AUTHORIZED`, `true` | → `DECLINED`, `true` | `PaymentConflictError` |
| `AUTHORIZED` | `false` (반복) | `PaymentConflictError` | → `REFUNDED`, `true` + `PaymentRefunded` |
| `DECLINED` | `PaymentConflictError` | `false` (반복) | `PaymentConflictError` |
| `REFUNDED` | `PaymentConflictError` | `PaymentConflictError` | `false` (반복) |

`PENDING`에서 바로 `refund`가 오는 것은 던진다 — 승인되지 않은 돈을 환불할 수는 없고, 그런 요청이 왔다면 호출자의 버그이거나 사가가 순서를 잃은 것이다. 조용히 넘기면 그 사실이 영영 드러나지 않는다.

- [ ] **Step 1: 에러를 정의한다**

`payment.errors.ts`:

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 되돌릴 수 없는 전이를 시도했다. 예: DECLINED 결제를 환불하려 했다.
 *
 * `DomainError`인 이유: 사용자가 취소 버튼을 두 번 누르는 것처럼 정상 요청이
 * 늦게 도착해 생길 수 있고, 클라이언트는 "이미 처리된 결제입니다"를 보여주면 된다.
 * 409다.
 */
export class PaymentConflictError extends DomainError {
  static readonly CODE = 'PAYMENT_CONFLICT';
  readonly code = PaymentConflictError.CODE;

  constructor(paymentId: string, from: string, to: string) {
    super(`${from} 상태의 결제를 ${to}로 바꿀 수 없습니다: ${paymentId}`);
  }
}

export class PaymentNotFoundError extends DomainError {
  static readonly CODE = 'PAYMENT_NOT_FOUND';
  readonly code = PaymentNotFoundError.CODE;

  constructor(key: string) {
    super(`결제를 찾을 수 없습니다: ${key}`);
  }
}

/**
 * 승인액이 주문 금액과 다르다 (스펙 §5.1의 payment 불변식).
 *
 * **`DomainError`가 아니다.** 사용자가 고칠 수 있는 것이 없고, 이 값이 어긋났다면
 * 사가가 잘못된 금액을 넘겼거나 저장된 행이 손상된 것이다. 500이 맞는 응답이다.
 */
export class PaymentAmountMismatchError extends Error {
  constructor(orderId: string, expected: string, actual: string) {
    super(`주문 ${orderId}의 결제 금액이 다릅니다: 기대 ${expected}, 실제 ${actual}`);
    this.name = 'PaymentAmountMismatchError';
  }
}

/** 저장된 결제 행이 알 수 없는 상태를 담고 있다. 데이터 손상이므로 500이다. */
export class CorruptedPaymentError extends Error {
  constructor(paymentId: string, status: string) {
    super(`저장된 결제 상태를 해석할 수 없습니다 (${paymentId}): "${status}"`);
    this.name = 'CorruptedPaymentError';
  }
}
```

- [ ] **Step 2: `PaymentAttempt`와 이벤트를 만든다**

`payment-attempt.ts`:

```ts
export type AttemptResult = 'APPROVED' | 'DECLINED';

/**
 * PG 호출 한 번의 기록. **VO가 아니라 엔티티다** — `pgTxId`로 식별되고,
 * 웹훅 멱등성이 그 식별자의 유일성 위에 서 있다(스펙 §10.8).
 *
 * 불변이다. 시도는 일어난 뒤 바뀌지 않는다.
 */
export class PaymentAttempt {
  constructor(
    readonly id: string,
    readonly pgTxId: string,
    readonly result: AttemptResult,
    readonly reason: string | null,
    readonly attemptedAt: Date,
  ) {}

  get approved(): boolean {
    return this.result === 'APPROVED';
  }
}
```

`payment.events.ts`:

```ts
import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';

export const PAYMENT_REFUNDED = 'payment.PaymentRefunded';

/**
 * 환불이 완료됐다. Ordering이 구독해 주문을 REFUNDED로 전이시킨다(스펙 §5.6).
 *
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload가 JsonB이고
 * 값 객체를 그대로 넣으면 `{}`로 직렬화되어 조용히 빈 이벤트가 나간다.
 * `bigint`도 직렬화되지 않으므로 금액은 문자열이다.
 */
export function paymentRefunded(
  payment: { readonly id: PaymentId; readonly orderId: OrderId; readonly amount: Money },
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: PAYMENT_REFUNDED,
    aggregateType: 'Payment',
    aggregateId: payment.id,
    occurredAt,
    payload: {
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.amount.toString(),
      currency: payment.amount.currency,
    },
  };
}
```

- [ ] **Step 3: `Payment`의 실패하는 테스트를 쓴다**

`payment.fixtures.ts`:

```ts
const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

/** 마지막 그룹은 16진수 12자리여야 한다. 마커도 16진수만 쓴다 — 계획 3에서 'l'과 'ver'로 두 번 깨졌다. */
export const paymentUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1a00', suffix)}`;
export const orderUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1b00', suffix)}`;
export const attemptUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0d1c00', suffix)}`;
export const FIXED_NOW = new Date('2026-03-01T00:00:00.000Z');
```

`payment.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import { attemptUuid, FIXED_NOW, orderUuid, paymentUuid } from '../testing/payment.fixtures';
import { Payment } from './payment';
import { PaymentAttempt } from './payment-attempt';
import { CorruptedPaymentError, PaymentConflictError } from './payment.errors';
import { PAYMENT_REFUNDED } from './payment.events';

const AMOUNT = Money.of(12_000n);

function open(): Payment {
  return Payment.open({
    id: PaymentId.of(paymentUuid('1')),
    orderId: OrderId.of(orderUuid('1')),
    amount: AMOUNT,
    now: FIXED_NOW,
  });
}

const attempt = (result: 'APPROVED' | 'DECLINED', suffix = '1'): PaymentAttempt =>
  new PaymentAttempt(attemptUuid(suffix), `pg-tx-${suffix}`, result, null, FIXED_NOW);

describe('Payment.open', () => {
  it('PENDING 상태로 열리고 시도가 없다', () => {
    const payment = open();
    expect(payment.status).toBe('PENDING');
    expect(payment.attempts).toHaveLength(0);
  });

  it('금액이 0 이하면 열 수 없다', () => {
    // 0원 결제는 결제가 아니다. 여기까지 왔다면 주문 총계 계산이 깨진 것이다.
    expect(() =>
      Payment.open({
        id: PaymentId.of(paymentUuid('2')),
        orderId: OrderId.of(orderUuid('2')),
        amount: Money.zero(),
        now: FIXED_NOW,
      }),
    ).toThrow(/0보다 커야/);
  });
});

describe('Payment 전이', () => {
  it('승인하면 AUTHORIZED가 되고 시도가 쌓인다', () => {
    const payment = open();
    expect(payment.authorize(attempt('APPROVED'))).toBe(true);
    expect(payment.status).toBe('AUTHORIZED');
    expect(payment.attempts).toHaveLength(1);
  });

  it('같은 승인을 두 번 하면 false를 돌려주고 시도가 늘지 않는다', () => {
    // OrderCancelled와 마찬가지로 at-least-once 배달이 재호출을 만든다.
    const payment = open();
    const first = attempt('APPROVED');
    expect(payment.authorize(first)).toBe(true);
    expect(payment.authorize(first)).toBe(false);
    expect(payment.attempts).toHaveLength(1);
  });

  it('거절하면 DECLINED가 된다', () => {
    const payment = open();
    expect(payment.decline(attempt('DECLINED'))).toBe(true);
    expect(payment.status).toBe('DECLINED');
  });

  it('거절된 결제를 승인할 수 없다', () => {
    const payment = open();
    payment.decline(attempt('DECLINED'));
    expect(() => payment.authorize(attempt('APPROVED', '2'))).toThrow(PaymentConflictError);
  });

  it('승인된 결제를 환불하면 REFUNDED가 되고 PaymentRefunded를 발행한다', () => {
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.pullEvents();

    expect(payment.refund(FIXED_NOW)).toBe(true);

    expect(payment.status).toBe('REFUNDED');
    const events = payment.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([PAYMENT_REFUNDED]);
    expect(events[0]?.payload).toMatchObject({ amount: '12000', currency: 'KRW' });
  });

  it('환불을 두 번 하면 false를 돌려주고 이벤트를 다시 발행하지 않는다', () => {
    // 이것이 편차 5(SKIP LOCKED를 넣지 않는다)를 갚는 자리다.
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.refund(FIXED_NOW);
    payment.pullEvents();

    expect(payment.refund(FIXED_NOW)).toBe(false);
    expect(payment.pullEvents()).toHaveLength(0);
  });

  it('승인되지 않은 결제는 환불할 수 없다', () => {
    // 조용히 넘기면 사가가 순서를 잃었다는 사실이 영영 드러나지 않는다.
    expect(() => open().refund(FIXED_NOW)).toThrow(PaymentConflictError);
  });

  it('PaymentConflictError는 DomainError다', () => {
    expect(new PaymentConflictError('id', 'PENDING', 'REFUNDED')).toBeInstanceOf(DomainError);
  });
});

describe('Payment.recordCallback — 웹훅 정합', () => {
  it('처음 보는 pgTxId면 시도를 남기고 true를 돌려준다', () => {
    const payment = open();
    expect(payment.recordCallback(attempt('APPROVED'))).toBe(true);
    expect(payment.attempts).toHaveLength(1);
  });

  it('이미 기록된 pgTxId면 false를 돌려주고 아무것도 바꾸지 않는다', () => {
    // 스펙 §7.6의 "웹훅, 멱등". DB의 유니크 제약과 이중으로 건다.
    const payment = open();
    const callback = attempt('APPROVED');
    payment.recordCallback(callback);
    expect(payment.recordCallback(callback)).toBe(false);
    expect(payment.attempts).toHaveLength(1);
  });

  it('PENDING 상태에서 승인 콜백을 받으면 AUTHORIZED로 정합된다', () => {
    const payment = open();
    payment.recordCallback(attempt('APPROVED'));
    expect(payment.status).toBe('AUTHORIZED');
  });

  it('이미 REFUNDED면 늦게 온 승인 콜백이 상태를 되돌리지 않는다', () => {
    // 늦게 도착한 콜백이 환불된 결제를 되살리면 돈이 사라진다.
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.refund(FIXED_NOW);

    expect(payment.recordCallback(attempt('APPROVED', '2'))).toBe(true);

    expect(payment.status).toBe('REFUNDED');
    expect(payment.attempts).toHaveLength(2);
  });
});

describe('Payment.rehydrate', () => {
  it('알 수 없는 상태는 CorruptedPaymentError다', () => {
    // 저장된 행이 깨진 것이므로 500이다. DomainError가 아니다.
    expect(() =>
      Payment.rehydrate({
        id: PaymentId.of(paymentUuid('9')),
        orderId: OrderId.of(orderUuid('9')),
        amount: AMOUNT,
        status: 'WEIRD',
        attempts: [],
      }),
    ).toThrow(CorruptedPaymentError);
  });

  it('CorruptedPaymentError는 DomainError가 아니다', () => {
    expect(new CorruptedPaymentError('id', 'WEIRD')).not.toBeInstanceOf(DomainError);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/payment/domain`
Expected: FAIL — `payment.ts`가 없다.

- [ ] **Step 5: `Payment`를 구현한다**

```ts
import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import type { PaymentAttempt } from './payment-attempt';
import { CorruptedPaymentError, PaymentConflictError } from './payment.errors';
import { paymentRefunded } from './payment.events';

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'DECLINED' | 'REFUNDED';

const KNOWN_STATUSES: readonly string[] = ['PENDING', 'AUTHORIZED', 'DECLINED', 'REFUNDED'];

/**
 * 결제 애그리거트. 상태 머신 하나와 시도 이력이 전부다 — 스펙 §4가 payment를
 * "포트 뒤에 숨김" Supporting 컨텍스트로 분류했고, 여기 도메인 로직을 더 넣을수록
 * 진짜 PG로 교체할 때 버릴 코드가 는다.
 *
 * 전이 메서드는 **성공하면 `true`, 이미 그 상태면 `false`, 되돌릴 수 없으면 던진다.**
 * `OrderCancelled`가 outbox를 거쳐 at-least-once로 배달되므로(스펙 §6.3) `refund`가
 * 두 번 불릴 수 있고, 두 번째가 환불을 한 번 더 실행하면 돈이 두 번 나간다.
 */
export class Payment extends AggregateRoot {
  private constructor(
    readonly id: PaymentId,
    readonly orderId: OrderId,
    readonly amount: Money,
    private statusValue: PaymentStatus,
    private readonly attemptList: PaymentAttempt[],
  ) {
    super();
  }

  /**
   * `now`는 지금 쓰이지 않지만 시그니처에 남긴다 — 태스크 5의 매퍼가 `created_at`을
   * 채우고 그 값의 출처는 `Clock`이어야 한다. 유스케이스가 `new Date()`를 부르기
   * 시작하면 TTL·만료 테스트가 통째로 불가능해진다(스펙 §7.3).
   */
  static open(params: { id: PaymentId; orderId: OrderId; amount: Money; now: Date }): Payment {
    // 0원 결제는 결제가 아니다. 여기까지 왔다면 주문 총계 계산이 깨진 것이므로
    // 평문 Error(500)다 — 사용자가 고칠 수 있는 것이 없다.
    if (params.amount.amount <= 0n) {
      throw new Error(`결제 금액은 0보다 커야 합니다: ${params.amount.amount}`);
    }
    return new Payment(params.id, params.orderId, params.amount, 'PENDING', []);
  }

  static rehydrate(params: {
    id: PaymentId;
    orderId: OrderId;
    amount: Money;
    status: string;
    attempts: PaymentAttempt[];
  }): Payment {
    if (!KNOWN_STATUSES.includes(params.status)) {
      throw new CorruptedPaymentError(params.id, params.status);
    }
    return new Payment(
      params.id,
      params.orderId,
      params.amount,
      params.status as PaymentStatus,
      [...params.attempts],
    );
  }

  get status(): PaymentStatus {
    return this.statusValue;
  }

  get attempts(): readonly PaymentAttempt[] {
    return this.attemptList;
  }

  authorize(attempt: PaymentAttempt): boolean {
    if (this.statusValue === 'AUTHORIZED') {
      return false;
    }
    this.assertFrom('PENDING', 'AUTHORIZED');
    this.attemptList.push(attempt);
    this.statusValue = 'AUTHORIZED';
    return true;
  }

  decline(attempt: PaymentAttempt): boolean {
    if (this.statusValue === 'DECLINED') {
      return false;
    }
    this.assertFrom('PENDING', 'DECLINED');
    this.attemptList.push(attempt);
    this.statusValue = 'DECLINED';
    return true;
  }

  refund(now: Date): boolean {
    if (this.statusValue === 'REFUNDED') {
      return false;
    }
    this.assertFrom('AUTHORIZED', 'REFUNDED');
    this.statusValue = 'REFUNDED';
    this.raise(paymentRefunded(this, now));
    return true;
  }

  /**
   * PG 웹훅이 도착했다. **주문을 움직이지 않는다** — 편차 3.
   *
   * 같은 `pgTxId`가 이미 있으면 아무것도 하지 않고 `false`. 처음 보는 것이면
   * 시도를 남기고, **`PENDING`일 때만** 상태를 정합시킨다. 이미 결말이 난 결제를
   * 늦게 온 콜백이 되돌리면 환불된 돈이 되살아난다.
   */
  recordCallback(attempt: PaymentAttempt): boolean {
    if (this.attemptList.some((existing) => existing.pgTxId === attempt.pgTxId)) {
      return false;
    }
    this.attemptList.push(attempt);
    if (this.statusValue === 'PENDING') {
      this.statusValue = attempt.approved ? 'AUTHORIZED' : 'DECLINED';
    }
    return true;
  }

  private assertFrom(expected: PaymentStatus, to: PaymentStatus): void {
    if (this.statusValue !== expected) {
      throw new PaymentConflictError(this.id, this.statusValue, to);
    }
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/payment/domain`
Expected: PASS (18개)

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 환불 멱등성이 실제로 있는가**
`refund`의 `if (this.statusValue === 'REFUNDED') return false;`를 지운다.
Expected: FAIL — `'환불을 두 번 하면 false를 돌려주고 이벤트를 다시 발행하지 않는다'`가 `PaymentConflictError`를 받아 실패한다. **이 회귀는 at-least-once 배달에서 환불을 두 번 실행시킨다.**
되돌린다.

**(b) 늦게 온 콜백이 상태를 되돌리지 못하게 막고 있는가**
`recordCallback`의 `if (this.statusValue === 'PENDING')` 조건을 지운다(항상 정합).
Expected: FAIL — `'이미 REFUNDED면 늦게 온 승인 콜백이 상태를 되돌리지 않는다'`가 `REFUNDED` 대신 `AUTHORIZED`를 받아 실패한다.
되돌린다.

**(c) 손상 감지가 `rehydrate`에 있는가**
`KNOWN_STATUSES.includes` 검사를 지운다.
Expected: FAIL — `'알 수 없는 상태는 CorruptedPaymentError다'`가 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. 도메인 커버리지 95/90을 넘는지 확인한다.

```bash
git add apps/api/src/modules/payment
git commit -m "feat(payment): Payment 애그리거트와 상태 머신을 추가한다"
```

---

### Task 4: Payment 애플리케이션 — 포트, `PgClient`, 유스케이스 셋

**Files:**
- Create: `apps/api/src/modules/payment/application/ports/out/payment.repository.ts`
- Create: `apps/api/src/modules/payment/application/ports/out/pg-client.ts`
- Create: `apps/api/src/modules/payment/application/ports/in/{authorize-payment,refund-payment,handle-pg-callback}.usecase.ts`
- Create: `apps/api/src/modules/payment/application/ports/port-tokens.spec.ts`
- Create: `apps/api/src/modules/payment/application/services/payment.service.ts` + `payment.service.spec.ts`
- Create: `apps/api/src/modules/payment/testing/{in-memory-payment.repository.ts,payment-repository.contract.ts}` + `in-memory-payment.repository.spec.ts`
- Create: `apps/api/src/modules/payment/adapters/out/pg/fake-pg.adapter.ts` + `fake-pg.adapter.spec.ts`

**Interfaces:**
- Consumes: `Payment`, `PaymentAttempt`, `TransactionManager`, `Clock`, `IdGenerator`, `DomainEventPublisher`
- Produces:
  - `PaymentRepository` — `findById`, `findByOrderId`, `save`
  - `PgClient` — `charge({ orderId, amount }): Promise<PgResult>`, `refund({ pgTxId }): Promise<void>`
  - `PgResult = { outcome: 'APPROVED'; pgTxId: string } | { outcome: 'DECLINED'; pgTxId: string; reason: string }`
  - `AuthorizePaymentUseCase` / `RefundPaymentUseCase` / `HandlePgCallbackUseCase` + 토큰
  - `AuthorizePaymentResult = { ok: true; paymentId: string; pgTxId: string } | { ok: false; reason: string }`
  - `PaymentService`가 셋을 모두 구현한다
  - `FakePgAdapter` — `scenario: PgScenario`, `PgScenario = 'APPROVE' | 'DECLINE' | 'TIMEOUT'`

**세 유스케이스를 한 서비스가 구현하는 이유.** 셋 다 "결제를 찾거나 열고, 애그리거트 메서드를 한 번 부르고, 저장하고, 이벤트를 발행한다"는 같은 골격이다. 포트는 셋으로 나눠 컨트롤러와 DI가 보는 표면을 유스케이스 단위로 유지한다 — 계획 2의 `ManageAddressesService`와 같은 판단이다.

**`AuthorizePayment`가 예외 대신 결과 유니온을 돌려주는 이유.** 결제 거절은 **비즈니스 결과이지 오류가 아니다.** 예외로 만들면 `PlaceOrderService`가 `try`/`catch`로 정상 분기를 처리하게 되고, 그러면 진짜 오류(DB 실패, 버그)와 구분이 사라진다. 사가의 4a/4b 갈림길(스펙 §6.2)이 이 반환값 하나로 결정된다.

- [ ] **Step 1: 아웃바운드 포트를 정의한다**

`payment.repository.ts`:

```ts
import type { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Payment } from '../../../domain/payment';

export interface PaymentRepository {
  findById(id: PaymentId, tx?: TransactionContext): Promise<Payment | null>;
  /** 주문당 결제는 하나다 — `payments.order_id`가 유니크다. */
  findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Payment | null>;
  save(payment: Payment, tx?: TransactionContext): Promise<void>;
}

export const PAYMENT_REPOSITORY = Symbol('PaymentRepository');
```

`pg-client.ts`:

```ts
import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';

export type PgResult =
  | { readonly outcome: 'APPROVED'; readonly pgTxId: string }
  | { readonly outcome: 'DECLINED'; readonly pgTxId: string; readonly reason: string };

/**
 * 외부 PG. 이 프로젝트에서 **유일하게 프로세스 밖을 향하는 포트**다.
 *
 * 거절이 예외가 아니라 결과인 이유: PG가 거절하는 것은 정상 동작이고, 예외로
 * 만들면 호출자가 정상 분기를 `catch`에서 처리하게 되어 진짜 장애(타임아웃, 5xx)와
 * 구분이 사라진다. **타임아웃과 네트워크 오류는 그대로 던진다** — 그것은 결과가
 * 아니라 오류이고, 사가는 그 경우 결제 여부를 알 수 없으므로 예약을 풀고 TTL에 맡긴다.
 */
export interface PgClient {
  charge(params: { orderId: OrderId; amount: Money }): Promise<PgResult>;
  /** 전액 환불만 한다(편차 4). 이미 환불된 거래에 다시 불려도 조용히 성공해야 한다. */
  refund(params: { pgTxId: string }): Promise<void>;
}

export const PG_CLIENT = Symbol('PgClient');
```

- [ ] **Step 2: 인바운드 포트를 정의한다**

`authorize-payment.usecase.ts`:

```ts
export interface AuthorizePaymentCommand {
  readonly orderId: string;
  readonly amount: string;
  readonly currency: 'KRW' | 'USD';
}

/**
 * 거절이 `ok: false`로 오는 것이 사가의 갈림길이다(스펙 §6.2의 4a/4b).
 * 예외는 진짜 오류일 때만 나온다.
 */
export type AuthorizePaymentResult =
  | { readonly ok: true; readonly paymentId: string; readonly pgTxId: string }
  | { readonly ok: false; readonly reason: string };

export interface AuthorizePaymentUseCase {
  execute(command: AuthorizePaymentCommand): Promise<AuthorizePaymentResult>;
}

export const AUTHORIZE_PAYMENT_USECASE = Symbol('AuthorizePaymentUseCase');
```

`refund-payment.usecase.ts`:

```ts
export interface RefundPaymentCommand {
  readonly orderId: string;
}

export interface RefundPaymentUseCase {
  /** 실제로 환불이 일어났으면 `true`. 이미 환불된 결제면 `false`. */
  execute(command: RefundPaymentCommand): Promise<boolean>;
}

export const REFUND_PAYMENT_USECASE = Symbol('RefundPaymentUseCase');
```

`handle-pg-callback.usecase.ts`:

```ts
export interface HandlePgCallbackCommand {
  readonly orderId: string;
  readonly pgTxId: string;
  readonly result: 'APPROVED' | 'DECLINED';
  readonly reason?: string;
}

export interface HandlePgCallbackUseCase {
  /** 처음 보는 콜백이면 `true`. 이미 처리된 `pgTxId`면 `false`. */
  execute(command: HandlePgCallbackCommand): Promise<boolean>;
}

export const HANDLE_PG_CALLBACK_USECASE = Symbol('HandlePgCallbackUseCase');
```

`port-tokens.spec.ts`는 계획 3의 inventory 것과 같은 형태로 다섯 토큰(`PAYMENT_REPOSITORY`, `PG_CLIENT`, `AUTHORIZE_PAYMENT_USECASE`, `REFUND_PAYMENT_USECASE`, `HANDLE_PG_CALLBACK_USECASE`)이 심볼이고 `description`이 포트 이름과 정확히 일치하며 서로 다른지 확인한다. **`coverage.all`이 켜져 있어 이 파일이 없으면 포트 파일들이 0%로 잡히고 application 임계값을 실패시킨다.**

- [ ] **Step 3: fake와 계약 스위트를 쓴다**

`in-memory-payment.repository.ts`:

```ts
import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { PaymentRepository } from '../application/ports/out/payment.repository';
import { Payment } from '../domain/payment';
import { PaymentAttempt } from '../domain/payment-attempt';

/**
 * 단위 테스트용 PaymentRepository.
 *
 * **저장할 때 복사한다.** 저장본을 그대로 넘기면 호출자가 나중에 그 객체를 바꿨을 때
 * 저장소가 조용히 따라 바뀌어, 진짜 DB에서는 절대 일어나지 않는 일이 통과한다.
 * 계획 3의 in-memory 재고 리포지토리가 정확히 이 버그로 계약 스위트를 통과시켰다.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();

  async findById(id: PaymentId, _tx?: TransactionContext): Promise<Payment | null> {
    const found = this.byId.get(id);
    return found === undefined ? null : InMemoryPaymentRepository.copy(found);
  }

  async findByOrderId(orderId: OrderId, _tx?: TransactionContext): Promise<Payment | null> {
    for (const payment of this.byId.values()) {
      if (payment.orderId === orderId) {
        return InMemoryPaymentRepository.copy(payment);
      }
    }
    return null;
  }

  async save(payment: Payment, _tx?: TransactionContext): Promise<void> {
    this.byId.set(payment.id, InMemoryPaymentRepository.copy(payment));
  }

  private static copy(payment: Payment): Payment {
    return Payment.rehydrate({
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      attempts: payment.attempts.map(
        (a) => new PaymentAttempt(a.id, a.pgTxId, a.result, a.reason, a.attemptedAt),
      ),
    });
  }
}
```

`payment-repository.contract.ts` — 같은 스위트가 in-memory와 Prisma 양쪽에 돈다(스펙 §9.2).

```ts
import { describe, expect, it } from 'vitest';
import { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import type { PaymentRepository } from '../application/ports/out/payment.repository';
import { Payment } from '../domain/payment';
import { PaymentAttempt } from '../domain/payment-attempt';
import { attemptUuid, FIXED_NOW, orderUuid, paymentUuid } from './payment.fixtures';

export function paymentRepositoryContract(
  name: string,
  createRepo: () => Promise<PaymentRepository>,
): void {
  describe(`PaymentRepository 계약 — ${name}`, () => {
    const open = (suffix: string): Payment =>
      Payment.open({
        id: PaymentId.of(paymentUuid(suffix)),
        orderId: OrderId.of(orderUuid(suffix)),
        amount: Money.of(12_000n),
        now: FIXED_NOW,
      });

    it('저장한 결제를 id로 찾는다', async () => {
      const repo = await createRepo();
      const payment = open('1');
      await repo.save(payment);

      const found = await repo.findById(PaymentId.of(paymentUuid('1')));
      expect(found?.orderId).toBe(orderUuid('1'));
      expect(found?.amount.amount).toBe(12_000n);
      expect(found?.status).toBe('PENDING');
    });

    it('없는 id는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(PaymentId.of(paymentUuid('99')))).toBeNull();
    });

    it('주문 id로 찾는다', async () => {
      const repo = await createRepo();
      await repo.save(open('2'));
      const found = await repo.findByOrderId(OrderId.of(orderUuid('2')));
      expect(found?.id).toBe(paymentUuid('2'));
    });

    it('없는 주문 id는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findByOrderId(OrderId.of(orderUuid('98')))).toBeNull();
    });

    it('상태 변화가 저장된다', async () => {
      const repo = await createRepo();
      const payment = open('3');
      await repo.save(payment);

      payment.authorize(new PaymentAttempt(attemptUuid('3'), 'pg-3', 'APPROVED', null, FIXED_NOW));
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('3')));
      expect(found?.status).toBe('AUTHORIZED');
    });

    it('시도 이력이 저장되고 순서가 유지된다', async () => {
      // 이력이 사라지면 웹훅 멱등성의 근거가 사라진다.
      const repo = await createRepo();
      const payment = open('4');
      payment.recordCallback(
        new PaymentAttempt(attemptUuid('41'), 'pg-41', 'DECLINED', '한도 초과', FIXED_NOW),
      );
      payment.recordCallback(
        new PaymentAttempt(
          attemptUuid('42'),
          'pg-42',
          'APPROVED',
          null,
          new Date(FIXED_NOW.getTime() + 1000),
        ),
      );
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('4')));
      expect(found?.attempts.map((a) => a.pgTxId)).toEqual(['pg-41', 'pg-42']);
      expect(found?.attempts[0]?.reason).toBe('한도 초과');
      expect(found?.attempts[1]?.reason).toBeNull();
    });

    it('같은 결제를 두 번 저장해도 시도가 중복되지 않는다', async () => {
      // save는 upsert다. 시도를 append-only로 다루면 두 번째 save가 이력을 두 배로 만든다.
      const repo = await createRepo();
      const payment = open('5');
      payment.authorize(new PaymentAttempt(attemptUuid('5'), 'pg-5', 'APPROVED', null, FIXED_NOW));
      await repo.save(payment);
      await repo.save(payment);

      const found = await repo.findByOrderId(OrderId.of(orderUuid('5')));
      expect(found?.attempts).toHaveLength(1);
    });

    it('돌려준 결제를 바꿔도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(open('6'));

      const first = await repo.findByOrderId(OrderId.of(orderUuid('6')));
      first?.authorize(new PaymentAttempt(attemptUuid('6'), 'pg-6', 'APPROVED', null, FIXED_NOW));

      const second = await repo.findByOrderId(OrderId.of(orderUuid('6')));
      expect(second?.status).toBe('PENDING');
    });
  });
}
```

`in-memory-payment.repository.spec.ts`는 `paymentRepositoryContract('in-memory', async () => new InMemoryPaymentRepository())` 한 줄이다.

- [ ] **Step 4: `FakePgAdapter`를 쓴다**

`fake-pg.adapter.ts` — **스펙 §7.6이 "단순 스텁이 아니라 실패를 주문형으로 만들어내는 도구"라고 못박은 것.**

```ts
import { Injectable } from '@nestjs/common';
import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';
import type { PgClient, PgResult } from '../../../application/ports/out/pg-client';

export type PgScenario = 'APPROVE' | 'DECLINE' | 'TIMEOUT';

export class PgTimeoutError extends Error {
  constructor(orderId: string) {
    super(`PG 응답 시간이 초과되었습니다: ${orderId}`);
    this.name = 'PgTimeoutError';
  }
}

/**
 * 가짜 PG. **`adapters/out/pg/`에 있고 `testing/`에 있지 않다** — 개발·테스트 환경의
 * 실제 어댑터이지 테스트 더블이 아니다. `no-test-doubles-in-production` 규칙이
 * `testing/` 아래를 프로덕션 코드가 import하는 것을 막으므로, 여기 두어야 모듈이 배선할 수 있다.
 *
 * `scenario`가 가변인 것이 이 클래스의 존재 이유다. 사가의 보상 경로를 테스트하려면
 * 결제 실패를 마음대로 일으킬 수 있어야 하고(스펙 §7.6), E2E는 DI 컨테이너에서
 * 이 인스턴스를 꺼내 `scenario`를 바꾼다:
 *
 * ```ts
 * app.get(FakePgAdapter).scenario = 'DECLINE';
 * ```
 *
 * 매직 금액(`999원이면 거절`) 같은 방식을 쓰지 않는 이유: 프로덕션 경로의 입력값에
 * 테스트용 의미를 심으면 실서비스에서 그 금액을 결제하는 고객이 거절당한다.
 */
@Injectable()
export class FakePgAdapter implements PgClient {
  scenario: PgScenario = 'APPROVE';

  private sequence = 0;
  private readonly refunded: string[] = [];

  async charge(params: { orderId: OrderId; amount: Money }): Promise<PgResult> {
    this.sequence += 1;
    const pgTxId = `pgtx-${this.sequence.toString().padStart(6, '0')}`;

    if (this.scenario === 'TIMEOUT') {
      // 타임아웃은 결과가 아니라 오류다. 사가는 결제 여부를 알 수 없으므로
      // 예약을 풀고 TTL에 맡긴다(태스크 12).
      throw new PgTimeoutError(params.orderId);
    }
    if (this.scenario === 'DECLINE') {
      return { outcome: 'DECLINED', pgTxId, reason: '카드 한도를 초과했습니다.' };
    }
    return { outcome: 'APPROVED', pgTxId };
  }

  async refund(params: { pgTxId: string }): Promise<void> {
    // 이미 환불된 거래에 다시 불려도 조용히 성공한다 — 포트 주석이 요구한 성질이고,
    // 실제 PG도 대부분 그렇게 동작한다.
    if (!this.refunded.includes(params.pgTxId)) {
      this.refunded.push(params.pgTxId);
    }
  }

  /** 테스트가 환불 호출을 확인할 때 쓴다. */
  get refundedTxIds(): readonly string[] {
    return this.refunded;
  }
}
```

`fake-pg.adapter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import { orderUuid } from '../../../testing/payment.fixtures';
import { FakePgAdapter, PgTimeoutError } from './fake-pg.adapter';

const charge = (adapter: FakePgAdapter) =>
  adapter.charge({ orderId: OrderId.of(orderUuid('1')), amount: Money.of(1000n) });

describe('FakePgAdapter', () => {
  it('기본 시나리오는 승인이다', async () => {
    const result = await charge(new FakePgAdapter());
    expect(result.outcome).toBe('APPROVED');
  });

  it('DECLINE이면 이유와 함께 거절한다', async () => {
    const adapter = new FakePgAdapter();
    adapter.scenario = 'DECLINE';
    const result = await charge(adapter);
    expect(result).toEqual({ outcome: 'DECLINED', pgTxId: 'pgtx-000001', reason: expect.any(String) });
  });

  it('TIMEOUT이면 던진다 — 결과가 아니라 오류다', async () => {
    const adapter = new FakePgAdapter();
    adapter.scenario = 'TIMEOUT';
    await expect(charge(adapter)).rejects.toThrow(PgTimeoutError);
  });

  it('pgTxId가 호출마다 다르다', async () => {
    // 같은 값이 나오면 payment_attempts.pg_tx_id 유니크에 걸려 두 번째 결제가 못 들어간다.
    const adapter = new FakePgAdapter();
    const first = await charge(adapter);
    const second = await charge(adapter);
    expect(first.pgTxId).not.toBe(second.pgTxId);
  });

  it('같은 거래를 두 번 환불해도 조용히 성공한다', async () => {
    const adapter = new FakePgAdapter();
    await adapter.refund({ pgTxId: 'pgtx-000001' });
    await adapter.refund({ pgTxId: 'pgtx-000001' });
    expect(adapter.refundedTxIds).toEqual(['pgtx-000001']);
  });
});
```

- [ ] **Step 5: `PaymentService`의 실패하는 테스트를 쓴다**

**메서드 이름을 먼저 정한다.** `PaymentService`는 세 유스케이스를 구현하지만 셋 다 `execute`일 수는 없다. `AuthorizePaymentUseCase`만 `execute`로 직접 구현하고(`implements AuthorizePaymentUseCase`), 나머지 둘은 `refund(command)`와 `handleCallback(command)`로 노출한다. 모듈 배선이 그 둘을 얇은 객체 리터럴로 감싸 `RefundPaymentUseCase`/`HandlePgCallbackUseCase` 토큰에 바인딩한다(태스크 6).

`payment.service.spec.ts` — 손으로 쓴 fake만 쓴다(`vi.mock` 금지).

```ts
import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../shared/kernel/identifiers';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { FakePgAdapter, PgTimeoutError } from '../../adapters/out/pg/fake-pg.adapter';
import { PAYMENT_REFUNDED } from '../../domain/payment.events';
import { PaymentConflictError, PaymentNotFoundError } from '../../domain/payment.errors';
import { InMemoryPaymentRepository } from '../../testing/in-memory-payment.repository';
import { FIXED_NOW, orderUuid } from '../../testing/payment.fixtures';
import { PaymentService } from './payment.service';

const ORDER = orderUuid('1');

function build() {
  const payments = new InMemoryPaymentRepository();
  const pg = new FakePgAdapter();
  const events = new RecordingEventPublisher();
  const service = new PaymentService(
    payments,
    pg,
    events,
    new PassthroughTransactionManager(),
    new MutableClock(FIXED_NOW),
    new SequentialIdGenerator(),
  );
  return { service, payments, pg, events };
}

const authorize = (service: PaymentService, orderId = ORDER) =>
  service.execute({ orderId, amount: '12000', currency: 'KRW' });

describe('AuthorizePayment', () => {
  it('승인되면 ok: true와 pgTxId를 돌려주고 결제가 AUTHORIZED로 남는다', async () => {
    const { service, payments } = build();

    const result = await authorize(service);

    expect(result.ok).toBe(true);
    const saved = await payments.findByOrderId(OrderId.of(ORDER));
    expect(saved?.status).toBe('AUTHORIZED');
    expect(saved?.attempts).toHaveLength(1);
  });

  it('거절되면 ok: false를 돌려준다 — 예외가 아니다', async () => {
    // 사가의 4a/4b 갈림길이다(스펙 §6.2). 예외로 만들면 PlaceOrderService가
    // 정상 분기를 catch에서 처리하게 되고 진짜 오류와 구분이 사라진다.
    const { service, pg, payments } = build();
    pg.scenario = 'DECLINE';

    const result = await authorize(service);

    expect(result).toEqual({ ok: false, reason: expect.any(String) });
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.status).toBe('DECLINED');
  });

  it('PG가 타임아웃하면 던진다', async () => {
    const { service, pg } = build();
    pg.scenario = 'TIMEOUT';
    await expect(authorize(service)).rejects.toThrow(PgTimeoutError);
  });

  it('타임아웃해도 결제 행은 PENDING으로 남는다', async () => {
    // 결제 여부를 모르는 상태다. 지워버리면 나중에 PG 정산에서 발견된 승인을
    // 붙일 곳이 없어진다 — 웹훅이 정합시킬 대상이 이 행이다.
    const { service, pg, payments } = build();
    pg.scenario = 'TIMEOUT';
    await authorize(service).catch(() => undefined);

    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.status).toBe('PENDING');
  });

  it('같은 주문을 두 번 승인 요청하면 기존 결제를 재사용한다', async () => {
    // payments.order_id가 유니크다. 새로 열면 P2002로 죽는다.
    const { service, payments } = build();
    await authorize(service);
    const first = await payments.findByOrderId(OrderId.of(ORDER));

    const second = await authorize(service);

    expect(second.ok).toBe(true);
    expect((second as { paymentId: string }).paymentId).toBe(first?.id);
  });
});

describe('RefundPayment', () => {
  it('승인된 결제를 환불하면 true를 돌려주고 PaymentRefunded를 발행한다', async () => {
    const { service, pg, events } = build();
    await authorize(service);

    expect(await service.refund({ orderId: ORDER })).toBe(true);

    expect(events.published.map((e) => e.eventType)).toContain(PAYMENT_REFUNDED);
    expect(pg.refundedTxIds).toHaveLength(1);
  });

  it('두 번 환불하면 두 번째는 false이고 PG를 다시 부르지 않는다', async () => {
    // OrderCancelled가 at-least-once로 배달된다. 여기서 막지 못하면 돈이 두 번 나간다.
    const { service, pg } = build();
    await authorize(service);
    await service.refund({ orderId: ORDER });

    expect(await service.refund({ orderId: ORDER })).toBe(false);
    expect(pg.refundedTxIds).toHaveLength(1);
  });

  it('없는 주문을 환불하면 PaymentNotFoundError다', async () => {
    const { service } = build();
    await expect(service.refund({ orderId: orderUuid('9') })).rejects.toThrow(PaymentNotFoundError);
  });

  it('거절된 결제는 환불할 수 없다', async () => {
    const { service, pg } = build();
    pg.scenario = 'DECLINE';
    await authorize(service);

    await expect(service.refund({ orderId: ORDER })).rejects.toThrow(PaymentConflictError);
  });
});

describe('HandlePgCallback', () => {
  it('처음 보는 콜백이면 true를 돌려주고 시도를 남긴다', async () => {
    const { service, payments } = build();
    await authorize(service);

    const handled = await service.handleCallback({
      orderId: ORDER,
      pgTxId: 'late-tx-1',
      result: 'APPROVED',
    });

    expect(handled).toBe(true);
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.attempts).toHaveLength(2);
  });

  it('같은 pgTxId가 두 번 오면 두 번째는 false다', async () => {
    // 스펙 §7.6의 "웹훅, 멱등".
    const { service, payments } = build();
    await authorize(service);
    const callback = { orderId: ORDER, pgTxId: 'late-tx-1', result: 'APPROVED' as const };
    await service.handleCallback(callback);

    expect(await service.handleCallback(callback)).toBe(false);
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.attempts).toHaveLength(2);
  });

  it('결제가 없는 주문의 콜백은 PaymentNotFoundError다', async () => {
    const { service } = build();
    await expect(
      service.handleCallback({ orderId: orderUuid('9'), pgTxId: 'x', result: 'APPROVED' }),
    ).rejects.toThrow(PaymentNotFoundError);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/payment`
Expected: FAIL — `payment.service.ts`가 없다.

- [ ] **Step 7: `PaymentService`를 구현한다**

```ts
import { OrderId, PaymentId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Payment } from '../../domain/payment';
import { PaymentAttempt } from '../../domain/payment-attempt';
import { PaymentNotFoundError } from '../../domain/payment.errors';
import type {
  AuthorizePaymentCommand,
  AuthorizePaymentResult,
  AuthorizePaymentUseCase,
} from '../ports/in/authorize-payment.usecase';
import type { HandlePgCallbackCommand } from '../ports/in/handle-pg-callback.usecase';
import type { RefundPaymentCommand } from '../ports/in/refund-payment.usecase';
import type { PaymentRepository } from '../ports/out/payment.repository';
import type { PgClient } from '../ports/out/pg-client';

/**
 * 세 유스케이스를 한 서비스가 구현한다 — 셋 다 "찾거나 열고, 애그리거트 메서드를
 * 한 번 부르고, 저장하고, 이벤트를 발행한다"는 같은 골격이다.
 *
 * **PG 호출은 트랜잭션 밖에 있다.** 외부 HTTP 응답을 기다리며 DB 트랜잭션을 열어두면
 * 커넥션 풀이 말라죽는다(스펙 §6.1). 그래서 이 서비스는 트랜잭션을 두 번 연다:
 * 결제 행을 여는 트랜잭션, 그리고 결과를 반영하는 트랜잭션. 그 사이가 PG 호출이다.
 */
export class PaymentService implements AuthorizePaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly pg: PgClient,
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: AuthorizePaymentCommand): Promise<AuthorizePaymentResult> {
    const orderId = OrderId.of(command.orderId);
    const amount = Money.fromDto({ amount: command.amount, currency: command.currency });
    const now = this.clock.now();

    // [트랜잭션 1] 결제 행을 연다. 이미 있으면 재사용한다 — payments.order_id가
    // 유니크라 새로 열면 P2002로 죽고, 재시도된 주문에서 실제로 그 경로가 생긴다.
    const payment = await this.transactions.run(async (tx) => {
      const existing = await this.payments.findByOrderId(orderId, tx);
      if (existing !== null) {
        return existing;
      }
      const opened = Payment.open({
        id: PaymentId.of(this.ids.nextId()),
        orderId,
        amount,
        now,
      });
      await this.payments.save(opened, tx);
      return opened;
    });

    // [트랜잭션 없음] 외부 PG. 여기서 던지면 결제 행은 PENDING으로 남고,
    // 늦게 오는 웹훅이 정합시킬 대상이 된다.
    const result = await this.pg.charge({ orderId, amount });

    // [트랜잭션 2] 결과를 반영한다.
    const attempt = new PaymentAttempt(
      this.ids.nextId(),
      result.pgTxId,
      result.outcome === 'APPROVED' ? 'APPROVED' : 'DECLINED',
      result.outcome === 'APPROVED' ? null : result.reason,
      this.clock.now(),
    );

    return this.transactions.run(async (tx) => {
      if (result.outcome === 'APPROVED') {
        payment.authorize(attempt);
      } else {
        payment.decline(attempt);
      }
      await this.payments.save(payment, tx);
      await this.events.publish(payment.pullEvents(), tx);
      return result.outcome === 'APPROVED'
        ? { ok: true as const, paymentId: payment.id, pgTxId: result.pgTxId }
        : { ok: false as const, reason: result.reason };
    });
  }

  async refund(command: RefundPaymentCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    // 승인 거래를 찾는 것이 트랜잭션 밖이면 PG 호출과 상태 반영 사이가 벌어진다.
    // 여기서는 PG의 refund가 멱등하므로(포트 주석) 트랜잭션 안에서 부르지 않고,
    // 상태를 먼저 바꾼 뒤 PG를 부른다 — 순서를 뒤집으면 PG는 환불했는데 상태가
    // AUTHORIZED로 남아 다음 호출이 또 환불한다.
    const outcome = await this.transactions.run(async (tx) => {
      const payment = await this.payments.findByOrderId(orderId, tx);
      if (payment === null) {
        throw new PaymentNotFoundError(command.orderId);
      }
      const refunded = payment.refund(now);
      if (!refunded) {
        return { refunded: false as const, pgTxId: null };
      }
      await this.payments.save(payment, tx);
      await this.events.publish(payment.pullEvents(), tx);
      const approved = payment.attempts.find((attempt) => attempt.approved);
      return { refunded: true as const, pgTxId: approved?.pgTxId ?? null };
    });

    if (outcome.refunded && outcome.pgTxId !== null) {
      await this.pg.refund({ pgTxId: outcome.pgTxId });
    }
    return outcome.refunded;
  }

  async handleCallback(command: HandlePgCallbackCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const attempt = new PaymentAttempt(
      this.ids.nextId(),
      command.pgTxId,
      command.result,
      command.reason ?? null,
      this.clock.now(),
    );

    return this.transactions.run(async (tx) => {
      const payment = await this.payments.findByOrderId(orderId, tx);
      if (payment === null) {
        throw new PaymentNotFoundError(command.orderId);
      }
      const recorded = payment.recordCallback(attempt);
      if (recorded) {
        await this.payments.save(payment, tx);
      }
      return recorded;
    });
  }
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/payment`
Expected: PASS

- [ ] **Step 9: 이 검사가 무엇을 잡는지 증명한다**

**(a) 환불이 상태를 먼저 바꾸는가**
`refund`에서 `await this.pg.refund(...)`를 트랜잭션 **앞**으로 옮긴다(PG 먼저, 상태 나중).
Expected: **통과한다.** 순차 호출만 하는 단위 테스트는 순서를 구분하지 못한다. 관측 결과를 보고서에 적고, 이 순서가 지켜지는지 확인하는 유일한 장치가 코드 리뷰라는 사실을 기록한다. 되돌린다.

**(b) 승인 재사용이 실제로 있는가**
`execute`의 `if (existing !== null) return existing;`을 지운다.
Expected: FAIL — `'같은 주문을 두 번 승인 요청하면 기존 결제를 재사용한다'`가 다른 `paymentId`를 받아 실패한다.
되돌린다.

**(c) 타임아웃 후 결제 행이 남는가**
`execute`의 [트랜잭션 1]을 PG 호출 **뒤로** 옮긴다.
Expected: FAIL — `'타임아웃해도 결제 행은 PENDING으로 남는다'`가 `null`을 받아 실패한다.
되돌린다.

- [ ] **Step 10: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/payment
git commit -m "feat(payment): 결제 승인·환불·웹훅 유스케이스와 가짜 PG를 추가한다"
```

---

### Task 5: Payment 영속 어댑터

**Files:**
- Create: `apps/api/src/modules/payment/adapters/out/persistence/payment.mapper.ts`
- Create: `apps/api/src/modules/payment/adapters/out/persistence/prisma-payment.repository.ts`
- Create: `apps/api/src/modules/payment/adapters/out/persistence/prisma-payment.repository.integration.spec.ts`

**Interfaces:**
- Consumes: `paymentRepositoryContract`, `Payment`, `PaymentAttempt`
- Produces: `PrismaPaymentRepository(prisma)`, `toPaymentDomain(row)`

- [ ] **Step 1: 매퍼를 쓴다**

```ts
import { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import type { Currency } from '../../../../../shared/kernel/money';
import { Payment } from '../../../domain/payment';
import { PaymentAttempt } from '../../../domain/payment-attempt';
import type { AttemptResult } from '../../../domain/payment-attempt';

export interface PaymentAttemptRow {
  id: string;
  pgTxId: string;
  result: string;
  reason: string | null;
  attemptedAt: Date;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  status: string;
  authorizedAmount: bigint;
  currency: string;
  attempts: PaymentAttemptRow[];
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `PaymentId.fromPersistence`/`OrderId.fromPersistence`를 쓴다 — `.of`는 깨진 행에
 * 400을 내고 클라이언트에게 "당신의 요청이 잘못됐다"고 거짓말한다(계획 1의 M7).
 * 같은 이유로 알 수 없는 `status`는 `Payment.rehydrate`가 `CorruptedPaymentError`
 * (평문 `Error`, 500)로 잡는다.
 *
 * `result` 컬럼도 마찬가지다. 'APPROVED'/'DECLINED'가 아닌 값이 들어 있으면 그건
 * 우리 데이터가 깨진 것이므로 500이다.
 */
export function toPaymentDomain(row: PaymentRow): Payment {
  return Payment.rehydrate({
    id: PaymentId.fromPersistence(row.id),
    orderId: OrderId.fromPersistence(row.orderId),
    amount: Money.of(row.authorizedAmount, asCurrency(row.currency, row.id)),
    status: row.status,
    attempts: row.attempts.map((attempt) => toAttemptDomain(attempt, row.id)),
  });
}

function toAttemptDomain(row: PaymentAttemptRow, paymentId: string): PaymentAttempt {
  if (row.result !== 'APPROVED' && row.result !== 'DECLINED') {
    throw new Error(`저장된 결제 시도 결과를 해석할 수 없습니다 (${paymentId}): "${row.result}"`);
  }
  return new PaymentAttempt(
    row.id,
    row.pgTxId,
    row.result as AttemptResult,
    row.reason,
    row.attemptedAt,
  );
}

function asCurrency(value: string, paymentId: string): Currency {
  if (value !== 'KRW' && value !== 'USD') {
    throw new Error(`저장된 통화를 해석할 수 없습니다 (${paymentId}): "${value}"`);
  }
  return value;
}
```

- [ ] **Step 2: 리포지토리를 쓴다**

```ts
import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { PaymentRepository } from '../../../application/ports/out/payment.repository';
import type { Payment } from '../../../domain/payment';
import { toPaymentDomain } from './payment.mapper';

/** 시도는 `attemptedAt` 오름차순으로 읽는다 — 이력의 순서가 곧 사건의 순서다. */
const INCLUDE_ATTEMPTS = { attempts: { orderBy: { attemptedAt: 'asc' } } } as const;

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: PaymentId, tx?: TransactionContext): Promise<Payment | null> {
    const row = await this.client(tx).payment.findUnique({
      where: { id },
      include: INCLUDE_ATTEMPTS,
    });
    return row === null ? null : toPaymentDomain(row);
  }

  async findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Payment | null> {
    const row = await this.client(tx).payment.findUnique({
      where: { orderId },
      include: INCLUDE_ATTEMPTS,
    });
    return row === null ? null : toPaymentDomain(row);
  }

  /**
   * upsert + 시도는 **없는 것만 추가한다.**
   *
   * 시도를 지우고 다시 넣지 않는 이유: `payment_attempts.pg_tx_id`가 유니크이고
   * 웹훅 멱등성이 그 위에 서 있다. 삭제 후 재삽입은 그 유니크가 지키던 것을 매 저장마다
   * 잠깐씩 풀어놓는다. `createMany` + `skipDuplicates`가 append-only 시맨틱을 그대로 준다.
   */
  async save(payment: Payment, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const base = {
      orderId: payment.orderId,
      status: payment.status,
      authorizedAmount: payment.amount.amount,
      currency: payment.amount.currency,
    };

    await client.payment.upsert({
      where: { id: payment.id },
      create: { id: payment.id, ...base, createdAt: new Date(), updatedAt: new Date() },
      update: { status: payment.status, updatedAt: new Date() },
    });

    if (payment.attempts.length > 0) {
      await client.paymentAttempt.createMany({
        data: payment.attempts.map((attempt) => ({
          id: attempt.id,
          paymentId: payment.id,
          pgTxId: attempt.pgTxId,
          result: attempt.result,
          reason: attempt.reason,
          attemptedAt: attempt.attemptedAt,
        })),
        skipDuplicates: true,
      });
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
```

**`new Date()`가 `createdAt`/`updatedAt`에 있는 것이 이 파일에서 유일하게 `Clock`을 우회하는 지점이다.** 이 두 컬럼은 감사용 메타데이터이고 도메인 판단에 쓰이지 않는다 — 어떤 테스트도 이 값을 단언하지 않고, 어떤 불변식도 이 값에 의존하지 않는다. 도메인이 시각을 필요로 하는 곳(`attemptedAt`)은 전부 `Clock`에서 온 값을 애그리거트가 들고 온다. 계획 2의 `PrismaAccountRepository`가 같은 판단을 했다.

- [ ] **Step 3: 계약 스위트를 이 어댑터에 돌린다**

`prisma-payment.repository.integration.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import { CorruptedPaymentError } from '../../../domain/payment.errors';
import { paymentRepositoryContract } from '../../../testing/payment-repository.contract';
import { PrismaPaymentRepository } from './prisma-payment.repository';

paymentRepositoryContract('prisma', async () => new PrismaPaymentRepository(await testDb()));

describe('PrismaPaymentRepository — 어댑터 전용', () => {
  it('알 수 없는 상태가 저장된 행을 읽으면 CorruptedPaymentError다', async () => {
    // 계약 스위트는 정상 데이터만 다룬다. 손상된 행은 원시 SQL로만 만들 수 있다.
    const db = await testDb();
    const id = '018f2b1c-4a5d-7e6f-8a9b-0d1a00bad001';
    await db.$executeRawUnsafe(`
      INSERT INTO payments (id, order_id, status, authorized_amount, currency, created_at, updated_at)
      VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0d1b00bad001', 'WEIRD', 1000, 'KRW', now(), now())
    `);

    await expect(
      new PrismaPaymentRepository(db).findById(PaymentId.of(id)),
    ).rejects.toThrow(CorruptedPaymentError);
  });

  it('알 수 없는 통화가 저장된 행을 읽으면 던진다', async () => {
    const db = await testDb();
    const id = '018f2b1c-4a5d-7e6f-8a9b-0d1a00bad002';
    await db.$executeRawUnsafe(`
      INSERT INTO payments (id, order_id, status, authorized_amount, currency, created_at, updated_at)
      VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0d1b00bad002', 'PENDING', 1000, 'JPY', now(), now())
    `);

    await expect(
      new PrismaPaymentRepository(db).findById(PaymentId.of(id)),
    ).rejects.toThrow(/통화를 해석할 수 없습니다/);
  });

  it('같은 pgTxId를 다른 결제에 넣으면 유니크 위반이다', async () => {
    // 웹훅 멱등성의 근거가 이 제약이다(스펙 §10.8). 도메인의 recordCallback은
    // 같은 결제 안에서만 중복을 막고, 결제를 가로지르는 중복은 DB만 막는다.
    const db = await testDb();
    const rows = [
      ['018f2b1c-4a5d-7e6f-8a9b-0d1a00dup001', '018f2b1c-4a5d-7e6f-8a9b-0d1b00dup001'],
      ['018f2b1c-4a5d-7e6f-8a9b-0d1a00dup002', '018f2b1c-4a5d-7e6f-8a9b-0d1b00dup002'],
    ];
    for (const [paymentId, orderId] of rows) {
      await db.$executeRawUnsafe(`
        INSERT INTO payments (id, order_id, status, authorized_amount, currency, created_at, updated_at)
        VALUES ('${paymentId}', '${orderId}', 'PENDING', 1000, 'KRW', now(), now())
      `);
    }
    const insertAttempt = (paymentId: string, attemptId: string) =>
      db.$executeRawUnsafe(`
        INSERT INTO payment_attempts (id, payment_id, pg_tx_id, result, reason, attempted_at)
        VALUES ('${attemptId}', '${paymentId}', 'shared-tx', 'APPROVED', NULL, now())
      `);

    await insertAttempt(rows[0]![0]!, '018f2b1c-4a5d-7e6f-8a9b-0d1c00dup001');
    await expect(insertAttempt(rows[1]![0]!, '018f2b1c-4a5d-7e6f-8a9b-0d1c00dup002')).rejects.toThrow();
  });
});
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/payment`
Expected: PASS — 계약 7개 + 어댑터 전용 3개.

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 시도가 append-only인가**
`save`의 `skipDuplicates: true`를 `false`로 바꾼다.
Expected: FAIL — 계약의 `'같은 결제를 두 번 저장해도 시도가 중복되지 않는다'`가 P2002로 실패한다. (in-memory 구현은 통과한다 — 그 비대칭이 계약을 두 구현에 돌리는 이유다. 관측 결과를 보고서에 적는다.)
되돌린다.

**(b) 시도 순서가 보장되는가**
`INCLUDE_ATTEMPTS`의 `orderBy`를 지운다.
Expected: 관측 결과를 보고서에 적는다. **통과할 가능성이 높다** — 행이 둘뿐이면 Postgres가 삽입 순서대로 돌려주기 쉽다. 통과한다면 계약의 `'시도 이력이 저장되고 순서가 유지된다'`가 순서를 실제로 검증하지 못한다는 뜻이므로, 그 사실을 보고서에 적는다. `orderBy`는 되돌린다 — 정렬을 명시하지 않은 SQL의 순서는 계약이 아니다.

**(c) 매퍼가 `fromPersistence`를 쓰는가**
`toPaymentDomain`의 `PaymentId.fromPersistence`를 `PaymentId.of`로 바꾸고, 원시 SQL로 `id`가 UUID가 아닌 행을 만들어 읽는다... 는 불가능하다(컬럼이 `uuid` 타입이다). 대신 **`orderId`에 대해 확인한다**: `payments.order_id`도 `uuid` 타입이므로 같은 이유로 불가능하다.
Expected: **이 프루브는 실행할 수 없다.** 그 사실 자체를 보고서에 적는다 — 스키마의 `@db.Uuid`가 매퍼보다 앞선 그물이고, `fromPersistence`가 잡는 것은 스키마 타입이 느슨한 경우(예: `text` 컬럼)뿐이다. 규칙을 지키는 이유는 그 방어선이 언젠가 필요해서가 아니라 **모든 매퍼가 같은 규칙을 따라야 예외 하나를 판단하는 비용이 사라지기 때문**이다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/payment
git commit -m "feat(payment): Prisma 결제 리포지토리와 매퍼를 추가한다"
```

---

### Task 6: Payment 계약·웹훅 컨트롤러·모듈 배선

**Files:**
- Create: `packages/contracts/src/payment/payment.contract.ts` + `payment.contract.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/payment/adapters/in/http/{pg-webhook.controller.ts, payment-domain-error-mappings.ts, pg-webhook.controller.integration.spec.ts}`
- Create: `apps/api/src/modules/payment/{payment.module.ts, index.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`

**Interfaces:**
- Produces: `pgWebhookContract`, `PaymentModule`, `payment/index.ts`가 `AUTHORIZE_PAYMENT_USECASE`·`REFUND_PAYMENT_USECASE`와 커맨드/결과 타입을 내보낸다

**`payment/index.ts`가 내보내는 것.** Ordering의 `InProcessPaymentAdapter`가 부를 것은 `AuthorizePaymentUseCase` 하나이고, `PaymentEventSubscriber`(태스크 18)가 같은 모듈 안에서 `RefundPaymentUseCase`를 쓴다. `PaymentRepository`도 `Payment` 애그리거트도 내보내지 않는다 — 다른 모듈이 결제 상태를 직접 만지면 상태 머신의 주인이 사라진다.

- [ ] **Step 1: 웹훅 계약을 만든다**

```ts
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

/**
 * PG가 호출하는 콜백. **인증 가드를 걸지 않는다** — PG는 우리 액세스 토큰을 갖고 있지
 * 않다. 실서비스라면 PG가 준 서명 키로 본문 서명을 검증해야 하고, 그것이 없는 지금은
 * 이 엔드포인트가 공개돼 있다는 사실을 컨트롤러 주석과 백로그에 적는다.
 */
export const pgCallbackBodySchema = z
  .object({
    orderId: z.string().uuid(),
    pgTxId: z.string().min(1).max(100),
    result: z.enum(['APPROVED', 'DECLINED']),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const pgCallbackResultSchema = z
  .object({
    /** 처음 보는 콜백이면 true, 이미 처리된 pgTxId면 false. PG가 재시도를 멈출 근거다. */
    accepted: z.boolean(),
  })
  .strict();

export type PgCallbackBody = z.infer<typeof pgCallbackBodySchema>;
export type PgCallbackResult = z.infer<typeof pgCallbackResultSchema>;

export const pgWebhookContract = c.router({
  callback: {
    method: 'POST',
    path: '/payments/pg-callback',
    body: pgCallbackBodySchema,
    responses: {
      200: pgCallbackResultSchema,
      400: errorDtoSchema, // VALIDATION_FAILED
      404: errorDtoSchema, // PAYMENT_NOT_FOUND
    },
    summary: 'PG 결제 결과 콜백. 같은 pgTxId는 한 번만 처리된다',
  },
});
```

`payment.contract.spec.ts`는 (1) 모르는 필드를 거부하는지, (2) `result`가 열거값만 받는지, (3) `orderId`가 uuid여야 하는지, (4) 응답 맵이 `[200, 400, 404]`인지를 확인한다.

`packages/contracts/src/index.ts`에 `export * from './payment/payment.contract';`를 더한다. **`api.contract.ts`에는 넣지 않는다** — BFF는 PG 웹훅을 호출하지 않는다.

- [ ] **Step 2: 에러 매핑을 만든다**

`payment-domain-error-mappings.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import { PaymentConflictError, PaymentNotFoundError } from '../../../domain/payment.errors';

/**
 * 등록하지 않은 `DomainError`는 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.**
 *
 * `ErrorCode.PAYMENT_DECLINED`는 계획 1이 계약에 넣어뒀지만 **여기서 쓰지 않는다.**
 * 결제 거절은 예외가 아니라 결과이고(`AuthorizePaymentResult.ok === false`), HTTP로
 * 나가는 것은 주문 쪽의 `OrderPaymentFailed` 상태다. 태스크 19가 그 코드의 실제
 * 사용처를 만든다.
 */
export function registerPaymentDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(PaymentConflictError.CODE, { status: 409, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(PaymentNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
}
```

- [ ] **Step 3: 웹훅 컨트롤러를 쓴다**

```ts
import { type PgCallbackBody, pgCallbackBodySchema, type PgCallbackResult } from '@commerce/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import {
  HANDLE_PG_CALLBACK_USECASE,
  type HandlePgCallbackUseCase,
} from '../../../application/ports/in/handle-pg-callback.usecase';

@Controller('payments')
export class PgWebhookController {
  constructor(
    @Inject(HANDLE_PG_CALLBACK_USECASE) private readonly handleCallback: HandlePgCallbackUseCase,
  ) {}

  /**
   * **가드가 없다.** PG는 우리 액세스 토큰을 갖고 있지 않다. 실서비스라면 PG가 발급한
   * 서명 키로 본문 서명을 검증해야 하고, 그것이 이 엔드포인트의 인증이다. 지금은
   * 그 서명 검증이 없으므로 **이 경로는 공개돼 있다** — 백로그다.
   *
   * 편차 3: 이 콜백은 **주문을 움직이지 않는다.** 결제 시도 이력을 남기고 `Payment`의
   * 상태를 정합시킬 뿐이다. 주문을 `PAID`로 만드는 것은 `PlaceOrderService`의 동기
   * 경로 하나뿐이며, 경로가 둘이 되면 순서 경합을 다루느라 사가 표면이 두 배가 된다.
   */
  @Post('pg-callback')
  @HttpCode(200)
  async callback(
    @Body(new ZodValidationPipe(pgCallbackBodySchema)) body: PgCallbackBody,
  ): Promise<PgCallbackResult> {
    return { accepted: await this.handleCallback.execute(body) };
  }
}
```

- [ ] **Step 4: 모듈을 배선한다**

`payment.module.ts` — 계획 3의 `inventory.module.ts` 형태를 따른다. **`inject:` 배열이 생성자 인자 순서와 위치별로 일치해야 한다.** `PaymentService(payments, pg, events, transactions, clock, ids)`처럼 같은 종류가 인접한 곳에서 뒤바뀌면 타입 검사는 통과하고 런타임에만 깨진다.

```ts
@Module({
  controllers: [PgWebhookController],
  providers: [
    { provide: PG_CLIENT, useClass: FakePgAdapter },
    // FakePgAdapter를 클래스 토큰으로도 해석 가능하게 둔다. E2E가 이 인스턴스를
    // 꺼내 scenario를 바꾼다(태스크 21). useExisting이라 인스턴스는 하나다.
    { provide: FakePgAdapter, useExisting: PG_CLIENT },
    {
      provide: PAYMENT_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaPaymentRepository(prisma),
      inject: [PrismaService],
    },
    {
      // 생성자: PaymentService(payments, pg, events, transactions, clock, ids)
      provide: PaymentService,
      useFactory: (
        payments: PaymentRepository,
        pg: PgClient,
        events: DomainEventPublisher,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
      ) => new PaymentService(payments, pg, events, transactions, clock, ids),
      inject: [
        PAYMENT_REPOSITORY,
        PG_CLIENT,
        DOMAIN_EVENT_PUBLISHER,
        TRANSACTION_MANAGER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    { provide: AUTHORIZE_PAYMENT_USECASE, useExisting: PaymentService },
    {
      // PaymentService.refund는 RefundPaymentUseCase.execute와 이름이 다르다.
      // 얇은 어댑터 객체로 감싼다 — 서비스에 execute를 셋 만들 수는 없기 때문이다.
      provide: REFUND_PAYMENT_USECASE,
      useFactory: (service: PaymentService): RefundPaymentUseCase => ({
        execute: (command) => service.refund(command),
      }),
      inject: [PaymentService],
    },
    {
      provide: HANDLE_PG_CALLBACK_USECASE,
      useFactory: (service: PaymentService): HandlePgCallbackUseCase => ({
        execute: (command) => service.handleCallback(command),
      }),
      inject: [PaymentService],
    },
  ],
  exports: [AUTHORIZE_PAYMENT_USECASE, REFUND_PAYMENT_USECASE, FakePgAdapter],
})
export class PaymentModule {
  constructor(registry: DomainErrorRegistry) {
    registerPaymentDomainErrors(registry);
  }
}
```

`index.ts`:

```ts
/**
 * payment 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다.
 *
 * Ordering의 `InProcessPaymentAdapter`가 부를 것은 `AuthorizePaymentUseCase` 하나다.
 * `RefundPaymentUseCase`는 같은 모듈의 이벤트 구독 어댑터가 쓰지만, 계획 5 이후
 * 관리자 환불 화면이 붙을 자리이므로 함께 내보낸다.
 *
 * `PaymentRepository`도 `Payment` 애그리거트도 내보내지 않는다 — 다른 모듈이 결제
 * 상태를 직접 만지면 상태 머신의 주인이 사라진다.
 *
 * `FakePgAdapter`는 내보내지 않는다. E2E는 Nest DI 컨테이너에서 클래스 토큰으로
 * 꺼내므로 모듈 경계를 넘는 import가 필요 없다.
 */
export {
  AUTHORIZE_PAYMENT_USECASE,
  type AuthorizePaymentCommand,
  type AuthorizePaymentResult,
  type AuthorizePaymentUseCase,
} from './application/ports/in/authorize-payment.usecase';
export {
  REFUND_PAYMENT_USECASE,
  type RefundPaymentCommand,
  type RefundPaymentUseCase,
} from './application/ports/in/refund-payment.usecase';
export { PaymentModule } from './payment.module';
```

`app.module.ts`의 `imports`에 `PaymentModule`을 더한다.

- [ ] **Step 5: 통합 테스트를 쓴다**

`pg-webhook.controller.integration.spec.ts` — 계획 3의 `stock.controller.integration.spec.ts` 골격(`workerDatabaseName()`으로 `DATABASE_URL`을 바꾸고 `afterAll`에서 복원)을 그대로 따른다.

- 결제가 없는 주문의 콜백 → 404 `NOT_FOUND`
- 결제를 만든 뒤 콜백 → 200 `{ accepted: true }`, 응답 본문을 `pgWebhookContract.callback.responses[200]`으로 파싱한다
- 같은 `pgTxId`로 다시 콜백 → 200 `{ accepted: false }`, `payment_attempts` 행 수가 늘지 않는다
- `result`가 열거값 밖이면 → 400 `VALIDATION_FAILED`
- **토큰 없이 불러도 200이다** — 가드가 없다는 사실을 테스트로 고정한다. 나중에 서명 검증을 넣으면 이 테스트가 깨지고, 그때 의도적으로 고치는 것이 맞다.

결제 행은 `AUTHORIZE_PAYMENT_USECASE`를 DI에서 꺼내 만든다(원시 SQL이 아니라) — 그래야 매퍼와 리포지토리를 함께 지나간다.

`app.module.spec.ts`에 더한다:
- `PgWebhookController`가 해석된다
- `PG_CLIENT`가 `FakePgAdapter`로 해석되고, `moduleRef.get(FakePgAdapter)`가 **같은 인스턴스**다(`useExisting`이 실제로 동작하는지 — 새 인스턴스가 만들어지면 E2E가 바꾼 `scenario`가 실제 결제 경로에 도달하지 않는다)
- `PaymentConflictError`와 `PaymentNotFoundError` 매핑이 등록돼 있다

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) `useExisting`이 인스턴스를 공유하는가**
`{ provide: FakePgAdapter, useExisting: PG_CLIENT }`를 `{ provide: FakePgAdapter, useClass: FakePgAdapter }`로 바꾼다.
Expected: FAIL — `app.module.spec.ts`의 인스턴스 동일성 단언이 실패한다. **이 회귀는 태스크 21의 보상 E2E를 조용히 무력화한다** — `scenario = 'DECLINE'`을 설정해도 결제 경로는 다른 인스턴스를 쓰므로 승인이 나고, 테스트는 "거절 시 예약이 해제된다"를 검증하는 대신 승인 경로를 돈다.
되돌린다.

**(b) 웹훅 멱등성이 살아 있는가**
`Payment.recordCallback`의 중복 `pgTxId` 검사를 지운다.
Expected: FAIL — 통합 테스트의 `'같은 pgTxId로 다시 콜백'`이 `accepted: true`를 받거나, `payment_attempts`의 유니크 제약에 걸려 500이 난다. 어느 쪽인지 관측하고 보고서에 적는다 — 둘 다 잡히지만 **도메인이 먼저 막는 편이 낫다**(DB 제약까지 가면 500이 나가고 PG는 재시도를 계속한다).
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 통과한다 — payment는 어느 모듈도 import하지 않는다.

```bash
git add apps/api/src packages/contracts/src
git commit -m "feat(payment): PG 웹훅 계약과 컨트롤러를 배선한다"
```

---

### Task 7: Ordering 도메인 — `Cart`

**Files:**
- Create: `apps/api/src/modules/ordering/domain/cart/{cart.errors.ts, cart-line.ts, cart.ts, cart.spec.ts}`
- Create: `apps/api/src/modules/ordering/testing/ordering.fixtures.ts`

**Interfaces:**
- Consumes: `CartId`, `CustomerId`, `SkuId`, `Quantity`, `DomainError`
- Produces:
  - `CartLine` — `{ skuId: SkuId; quantity: Quantity }` (VO)
  - `Cart.create({ id, customerId }): Cart` / `Cart.rehydrate({ id, customerId, lines }): Cart`
  - `cart.addItem(skuId, quantity)` / `cart.removeItem(skuId)` / `cart.changeQuantity(skuId, quantity)` / `cart.clear()`
  - `cart.lines: readonly CartLine[]`, `cart.isEmpty: boolean`
  - `CartLineNotFoundError`(404) / `CartLineLimitExceededError`(422)

**`Cart`에는 가격이 없다.** 스펙 §10.8의 `cart_lines`는 `cart_id, sku_id, quantity`뿐이다. 장바구니는 "무엇을 몇 개"만 들고, 가격은 주문 시점에 Catalog에서 스냅샷으로 온다(스펙 §5.3). 장바구니에 가격을 넣으면 상품 가격이 바뀌었을 때 장바구니가 낡은 값을 보여주고, 그 값을 신뢰해 주문하면 결제 금액이 달라진다.

**`Cart`는 `AggregateRoot`를 상속하지 않는다.** 장바구니 변경은 아무 이벤트도 발행하지 않는다 — 스펙 §5.6의 이벤트 목록에 장바구니가 없고, 구독자가 없는 이벤트를 발행하는 것은 outbox에 쓰레기를 쌓는 일이다. 계획 3의 `Product`가 같은 판단을 했다.

- [ ] **Step 1: 에러와 `CartLine`을 만든다**

`cart.errors.ts`:

```ts
import { DomainError } from '../../../../shared/kernel/domain-error';

/** 장바구니에 없는 SKU를 빼거나 수량을 바꾸려 했다. 404다. */
export class CartLineNotFoundError extends DomainError {
  static readonly CODE = 'CART_LINE_NOT_FOUND';
  readonly code = CartLineNotFoundError.CODE;

  constructor(skuId: string) {
    super(`장바구니에 없는 상품입니다: ${skuId}`);
  }
}

/**
 * 장바구니 줄 수 상한. 상한이 없으면 한 요청이 수천 줄을 만들고, 주문 시점에
 * 그 수만큼 재고 예약 트랜잭션이 열린다(태스크 12). 사가의 비용이 입력에 비례해
 * 무한히 커지는 것을 여기서 막는다.
 */
export class CartLineLimitExceededError extends DomainError {
  static readonly CODE = 'CART_LINE_LIMIT_EXCEEDED';
  readonly code = CartLineLimitExceededError.CODE;

  constructor(limit: number) {
    super(`장바구니에는 최대 ${limit}종류까지 담을 수 있습니다.`);
  }
}
```

`cart-line.ts`:

```ts
import type { SkuId } from '../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../shared/kernel/quantity';

/**
 * 장바구니 한 줄. **불변 VO다** — 수량을 바꾸면 새 인스턴스를 만든다.
 *
 * 계획 3의 `SavedAddress`가 가변으로 시작했다가 `withPrice`로 바뀐 교훈을 따른다.
 * 가변 엔티티를 컬렉션에 담으면 `Cart` 밖으로 새어 나간 참조가 애그리거트의 불변식을
 * 우회해 상태를 바꾼다.
 */
export class CartLine {
  constructor(
    readonly skuId: SkuId,
    readonly quantity: Quantity,
  ) {}

  withQuantity(quantity: Quantity): CartLine {
    return new CartLine(this.skuId, quantity);
  }
}
```

- [ ] **Step 2: 픽스처를 만든다**

`ordering.fixtures.ts`:

```ts
const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

/**
 * 마지막 그룹은 **16진수 12자리**여야 한다. 마커에 16진수가 아닌 글자를 쓰면
 * `InvalidIdError`가 난다 — 계획 3에서 `'l'`과 `'ver'`로 두 번 깨졌다.
 */
export const cartUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1a00', suffix)}`;
export const orderUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1b00', suffix)}`;
export const skuUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1c00', suffix)}`;
export const customerUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1d00', suffix)}`;
export const addressUuid = (suffix: string): string => `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1e00', suffix)}`;
export const FIXED_NOW = new Date('2026-03-01T00:00:00.000Z');
```

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`cart.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity, QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { cartUuid, customerUuid, skuUuid } from '../../testing/ordering.fixtures';
import { Cart } from './cart';
import { CartLine } from './cart-line';
import { CartLineLimitExceededError, CartLineNotFoundError } from './cart.errors';

const SKU_A = SkuId.of(skuUuid('1'));
const SKU_B = SkuId.of(skuUuid('2'));

const empty = (): Cart =>
  Cart.create({ id: CartId.of(cartUuid('1')), customerId: CustomerId.of(customerUuid('1')) });

describe('Cart.addItem', () => {
  it('새 SKU를 담으면 줄이 생긴다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity.value).toBe(2);
  });

  it('같은 SKU를 다시 담으면 수량이 합쳐진다', () => {
    // 같은 SKU가 두 줄로 들어가지 않는다 — 스펙 §5.1의 Cart 불변식이다.
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_A, Quantity.positive(3));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity.value).toBe(5);
  });

  it('수량 0으로는 담을 수 없다', () => {
    // Quantity.positive가 막는다. 0개를 담는 것은 줄 자체가 없어야 한다는 뜻이다.
    expect(() => empty().addItem(SKU_A, Quantity.positive(0))).toThrow(QuantityBelowMinimumError);
  });

  it('20종류를 넘기면 CartLineLimitExceededError다', () => {
    // 상한이 없으면 주문 시점에 그 수만큼 예약 트랜잭션이 열린다(태스크 12).
    const cart = empty();
    for (let i = 1; i <= 20; i += 1) {
      cart.addItem(SkuId.of(skuUuid(String(i))), Quantity.positive(1));
    }
    expect(() => cart.addItem(SkuId.of(skuUuid('21')), Quantity.positive(1))).toThrow(
      CartLineLimitExceededError,
    );
  });

  it('이미 담긴 SKU는 상한을 넘지 않는다', () => {
    // 수량 합치기는 줄을 늘리지 않으므로 상한과 무관해야 한다.
    const cart = empty();
    for (let i = 1; i <= 20; i += 1) {
      cart.addItem(SkuId.of(skuUuid(String(i))), Quantity.positive(1));
    }
    expect(() => cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1))).not.toThrow();
    expect(cart.lines).toHaveLength(20);
  });
});

describe('Cart.changeQuantity', () => {
  it('수량을 바꾼다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.changeQuantity(SKU_A, Quantity.positive(7));

    expect(cart.lines[0]?.quantity.value).toBe(7);
  });

  it('없는 SKU의 수량을 바꾸면 CartLineNotFoundError다', () => {
    expect(() => empty().changeQuantity(SKU_A, Quantity.positive(1))).toThrow(
      CartLineNotFoundError,
    );
  });

  it('다른 줄은 건드리지 않는다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_B, Quantity.positive(3));
    cart.changeQuantity(SKU_A, Quantity.positive(9));

    expect(cart.lines.find((line) => line.skuId === SKU_B)?.quantity.value).toBe(3);
  });
});

describe('Cart.removeItem', () => {
  it('줄을 뺀다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.addItem(SKU_B, Quantity.positive(1));
    cart.removeItem(SKU_A);

    expect(cart.lines.map((line) => line.skuId)).toEqual([SKU_B]);
  });

  it('없는 SKU를 빼면 CartLineNotFoundError다', () => {
    // 조용히 넘어가면 클라이언트가 UI를 잘못 그리고 있다는 사실이 드러나지 않는다.
    expect(() => empty().removeItem(SKU_A)).toThrow(CartLineNotFoundError);
  });
});

describe('Cart.clear', () => {
  it('주문이 만들어지면 장바구니를 비운다', () => {
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(2));
    cart.clear();

    expect(cart.isEmpty).toBe(true);
    expect(cart.lines).toHaveLength(0);
  });
});

describe('Cart.lines 캡슐화', () => {
  it('돌려준 배열을 바꿔도 장바구니는 바뀌지 않는다', () => {
    // 애그리거트 밖으로 내부 배열이 새면 불변식(중복 없음·상한)이 우회된다.
    const cart = empty();
    cart.addItem(SKU_A, Quantity.positive(1));

    (cart.lines as CartLine[]).push(new CartLine(SKU_B, Quantity.positive(1)));

    expect(cart.lines).toHaveLength(1);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain/cart`
Expected: FAIL — `cart.ts`가 없다.

- [ ] **Step 5: `Cart`를 구현한다**

```ts
import type { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../shared/kernel/quantity';
import { CartLine } from './cart-line';
import { CartLineLimitExceededError, CartLineNotFoundError } from './cart.errors';

/** 상한의 근거는 `CartLineLimitExceededError`의 주석에 있다. */
const MAX_LINES = 20;

/**
 * 장바구니 애그리거트.
 *
 * **`AggregateRoot`를 상속하지 않는다.** 장바구니 변경은 이벤트를 발행하지 않는다 —
 * 스펙 §5.6의 이벤트 목록에 장바구니가 없고, 구독자 없는 이벤트는 outbox에 쌓이는
 * 쓰레기다.
 *
 * **가격이 없다.** 장바구니는 "무엇을 몇 개"만 들고 가격은 주문 시점에 Catalog에서
 * 스냅샷으로 온다(스펙 §5.3). 장바구니가 가격을 들면 상품 가격이 바뀌었을 때 낡은
 * 값을 보여주게 되고, 그 값을 신뢰해 주문하면 결제 금액이 달라진다.
 */
export class Cart {
  private constructor(
    readonly id: CartId,
    readonly customerId: CustomerId,
    private readonly lineList: CartLine[],
  ) {}

  static create(params: { id: CartId; customerId: CustomerId }): Cart {
    return new Cart(params.id, params.customerId, []);
  }

  static rehydrate(params: { id: CartId; customerId: CustomerId; lines: CartLine[] }): Cart {
    return new Cart(params.id, params.customerId, [...params.lines]);
  }

  /** 복사본을 돌려준다 — 내부 배열이 새면 중복 없음·상한 불변식이 우회된다. */
  get lines(): readonly CartLine[] {
    return [...this.lineList];
  }

  get isEmpty(): boolean {
    return this.lineList.length === 0;
  }

  addItem(skuId: SkuId, quantity: Quantity): void {
    const index = this.indexOf(skuId);
    if (index >= 0) {
      // 같은 SKU는 줄을 늘리지 않고 수량을 합친다 — 스펙 §5.1의 "같은 SKU 중복 없음".
      // 상한 검사보다 먼저 와야 한다. 이미 담긴 것을 더 담는 것은 줄을 늘리지 않는다.
      const existing = this.lineList[index] as CartLine;
      this.lineList[index] = existing.withQuantity(existing.quantity.plus(quantity));
      return;
    }
    if (this.lineList.length >= MAX_LINES) {
      throw new CartLineLimitExceededError(MAX_LINES);
    }
    this.lineList.push(new CartLine(skuId, quantity));
  }

  changeQuantity(skuId: SkuId, quantity: Quantity): void {
    const index = this.requireIndexOf(skuId);
    this.lineList[index] = (this.lineList[index] as CartLine).withQuantity(quantity);
  }

  removeItem(skuId: SkuId): void {
    this.lineList.splice(this.requireIndexOf(skuId), 1);
  }

  /** 주문이 만들어지면 비운다. 주문 실패 시에는 부르지 않는다 — 태스크 12. */
  clear(): void {
    this.lineList.length = 0;
  }

  private indexOf(skuId: SkuId): number {
    return this.lineList.findIndex((line) => line.skuId === skuId);
  }

  private requireIndexOf(skuId: SkuId): number {
    const index = this.indexOf(skuId);
    if (index < 0) {
      throw new CartLineNotFoundError(skuId);
    }
    return index;
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain/cart`
Expected: PASS (12개)

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) `lines`가 복사본인가**
`get lines()`의 `[...this.lineList]`를 `this.lineList`로 바꾼다.
Expected: FAIL — `'돌려준 배열을 바꿔도 장바구니는 바뀌지 않는다'`가 2줄을 받아 실패한다.
되돌린다.

**(b) 상한 검사가 합치기보다 뒤에 있는가**
`addItem`에서 상한 검사를 `indexOf` 분기보다 **앞으로** 옮긴다.
Expected: FAIL — `'이미 담긴 SKU는 상한을 넘지 않는다'`가 실패한다. 이 순서가 뒤바뀌면 20종류를 담은 고객이 기존 상품의 수량조차 늘리지 못한다.
되돌린다.

**(c) 중복 합치기가 실제로 있는가**
`addItem`의 `if (index >= 0)` 분기를 지우고 항상 `push`하게 만든다.
Expected: FAIL — `'같은 SKU를 다시 담으면 수량이 합쳐진다'`가 2줄을 받아 실패한다. 그리고 이 회귀는 DB의 `cart_lines` 복합 기본키(태스크 2)에도 걸린다 — 그물이 둘이다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): Cart 애그리거트를 추가한다"
```

---

### Task 8: Ordering 도메인 — `OrderLine`, `ShippingAddress`, `PricedItem`, 상태 타입

**Files:**
- Create: `apps/api/src/modules/ordering/domain/order/{order-line.ts, shipping-address.ts, order-status.ts, order.errors.ts}` + `order-line.spec.ts`, `shipping-address.spec.ts`
- Create: `apps/api/src/modules/ordering/domain/priced-item.ts`

**Interfaces:**
- Consumes: `SkuId`, `Money`, `Quantity`, `DomainError`, `Money.multiply(Quantity)`(태스크 1)
- Produces:
  - `OrderLine.of({ skuId, nameSnapshot, unitPrice, quantity })` / `OrderLine.fromPersistence(...)` / `line.subtotal: Money`
  - `ShippingAddress.of({ recipient, phone, zip, line1, line2 })` / `ShippingAddress.fromPersistence(...)`
  - `PricedItem` — `{ skuId: SkuId; nameSnapshot: string; unitPrice: Money }`
  - `OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'PAYMENT_FAILED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED'`
  - `EmptyOrderError`(422) / `MixedCurrencyOrderError`(422) / `OrderConflictError`(409) / `OrderNotOwnedError`(403) / `OrderNotFoundError`(404) / `CorruptedOrderError`(평문) / `InvalidShippingAddressError`(400) / `CorruptedShippingAddressError`(평문)

**`ShippingAddress`에 `id`도 `label`도 없다.** Customer의 `SavedAddress`(id를 가진 엔티티)와 별개의 VO다(스펙 §5.3) — 고객이 이사해서 주소록을 고쳐도 과거 주문의 배송지는 그대로 남아야 한다. `label`("집", "회사")은 주소록을 고르기 위한 메타데이터이지 배송에 필요한 정보가 아니므로 스냅샷에 담지 않는다.

**`of` / `fromPersistence` 분리는 두 VO 모두에 적용된다** (계획 1의 M7). 인바운드에서 빈 수령인은 400이고, 저장된 행의 빈 수령인은 500이다.

- [ ] **Step 1: 에러를 정의한다**

`order.errors.ts`:

```ts
import { DomainError } from '../../../../shared/kernel/domain-error';

/** 라인이 없는 주문은 만들 수 없다 — 스펙 §5.1의 "최소 1줄". */
export class EmptyOrderError extends DomainError {
  static readonly CODE = 'EMPTY_ORDER';
  readonly code = EmptyOrderError.CODE;

  constructor() {
    super('주문에는 최소 한 개의 상품이 있어야 합니다.');
  }
}

/**
 * 통화가 다른 라인이 섞였다 — 편차 2.
 *
 * 계획 3의 `money.ts`에 남은 `TODO(plan 4)`가 요구한 것이다. 이것이 없으면
 * `Money.plus`의 `CurrencyMismatchError`(평문 `Error`)가 튀어나와 500이 나가고,
 * 사용자는 왜 실패했는지 알 수 없다. 여기서 막으면 422와 함께 이유를 말할 수 있다.
 */
export class MixedCurrencyOrderError extends DomainError {
  static readonly CODE = 'MIXED_CURRENCY_ORDER';
  readonly code = MixedCurrencyOrderError.CODE;

  constructor(currencies: readonly string[]) {
    super(`한 주문에 통화를 섞을 수 없습니다: ${currencies.join(', ')}`);
  }
}

/** 되돌릴 수 없는 상태 전이를 시도했다. 409다. */
export class OrderConflictError extends DomainError {
  static readonly CODE = 'ORDER_CONFLICT';
  readonly code = OrderConflictError.CODE;

  constructor(orderId: string, from: string, to: string) {
    super(`${from} 상태의 주문을 ${to}로 바꿀 수 없습니다: ${orderId}`);
  }
}

/**
 * 남의 주문을 취소하려 했다.
 *
 * **가드가 아니라 도메인에 있다** — 스펙 §5.5가 명시한 유일한 도메인 인가 규칙이다.
 * 가드로 처리하면 HTTP가 아닌 경로(배치, 이벤트 핸들러, 관리자 CLI)로 들어올 때
 * 규칙이 통째로 사라진다.
 */
export class OrderNotOwnedError extends DomainError {
  static readonly CODE = 'ORDER_NOT_OWNED';
  readonly code = OrderNotOwnedError.CODE;

  constructor(orderId: string) {
    super(`이 주문에 접근할 수 없습니다: ${orderId}`);
  }
}

export class OrderNotFoundError extends DomainError {
  static readonly CODE = 'ORDER_NOT_FOUND';
  readonly code = OrderNotFoundError.CODE;

  constructor(orderId: string) {
    super(`주문을 찾을 수 없습니다: ${orderId}`);
  }
}

/** 저장된 주문 행이 알 수 없는 상태를 담고 있다. 데이터 손상이므로 500이다. */
export class CorruptedOrderError extends Error {
  constructor(orderId: string, detail: string) {
    super(`저장된 주문을 해석할 수 없습니다 (${orderId}): ${detail}`);
    this.name = 'CorruptedOrderError';
  }
}

/** 인바운드 배송지가 비어 있다. 사용자가 고칠 수 있으므로 400이다. */
export class InvalidShippingAddressError extends DomainError {
  static readonly CODE = 'INVALID_SHIPPING_ADDRESS';
  readonly code = InvalidShippingAddressError.CODE;

  constructor(field: string) {
    super(`배송지 정보가 올바르지 않습니다: ${field}`);
  }
}

/** 저장된 배송지가 비어 있다. 우리 데이터가 깨진 것이므로 500이다. */
export class CorruptedShippingAddressError extends Error {
  constructor(field: string) {
    super(`저장된 배송지 값이 비어 있습니다: ${field}`);
    this.name = 'CorruptedShippingAddressError';
  }
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`order-line.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { skuUuid } from '../../testing/ordering.fixtures';
import { OrderLine } from './order-line';

const line = (amount: bigint, qty: number): OrderLine =>
  OrderLine.of({
    skuId: SkuId.of(skuUuid('1')),
    nameSnapshot: '티셔츠 RED-M',
    unitPrice: Money.of(amount),
    quantity: Quantity.positive(qty),
  });

describe('OrderLine', () => {
  it('소계는 단가 × 수량이다', () => {
    // Money.multiply(Quantity) — 태스크 1이 추가한 오버로드의 첫 사용처다.
    expect(line(1200n, 3).subtotal.amount).toBe(3600n);
  });

  it('수량 0으로는 만들 수 없다', () => {
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.of(1000n),
        quantity: Quantity.of(0),
      }),
    ).toThrow(/수량은 1개 이상/);
  });

  it('이름 스냅샷이 비어 있으면 만들 수 없다', () => {
    // 이름이 없으면 주문 내역이 "무엇을 샀는지"를 말하지 못한다.
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '   ',
        unitPrice: Money.of(1000n),
        quantity: Quantity.positive(1),
      }),
    ).toThrow(/이름/);
  });

  it('단가가 0 이하면 만들 수 없다', () => {
    expect(() =>
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.zero(),
        quantity: Quantity.positive(1),
      }),
    ).toThrow(/단가/);
  });

  it('fromPersistence는 손상된 값에 평문 Error를 던진다', () => {
    // 저장된 행이 깨진 것이므로 400이 아니라 500이다(계획 1의 M7).
    const broken = () =>
      OrderLine.fromPersistence({
        skuId: SkuId.fromPersistence(skuUuid('1')),
        nameSnapshot: '',
        unitPrice: Money.of(1000n),
        quantity: Quantity.of(1),
      });
    expect(broken).toThrow(/저장된/);
  });
});
```

`shipping-address.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../shared/kernel/domain-error';
import { CorruptedShippingAddressError, InvalidShippingAddressError } from './order.errors';
import { ShippingAddress } from './shipping-address';

const VALID = {
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '3층',
};

describe('ShippingAddress.of', () => {
  it('유효한 값으로 만들어진다', () => {
    const address = ShippingAddress.of(VALID);
    expect(address.recipient).toBe('홍길동');
    expect(address.line2).toBe('3층');
  });

  it('line2는 없어도 된다', () => {
    expect(ShippingAddress.of({ ...VALID, line2: null }).line2).toBeNull();
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(ShippingAddress.of({ ...VALID, recipient: '  홍길동  ' }).recipient).toBe('홍길동');
  });

  it.each(['recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 비면 InvalidShippingAddressError다',
    (field) => {
      expect(() => ShippingAddress.of({ ...VALID, [field]: '   ' })).toThrow(
        InvalidShippingAddressError,
      );
    },
  );

  it('InvalidShippingAddressError는 DomainError다', () => {
    expect(new InvalidShippingAddressError('recipient')).toBeInstanceOf(DomainError);
  });
});

describe('ShippingAddress.fromPersistence', () => {
  it('저장된 값이 비면 CorruptedShippingAddressError다', () => {
    // 요청은 멀쩡했고 우리 데이터가 깨진 것이다. 400을 돌려주면 거짓말이다.
    expect(() => ShippingAddress.fromPersistence({ ...VALID, recipient: '' })).toThrow(
      CorruptedShippingAddressError,
    );
  });

  it('CorruptedShippingAddressError는 DomainError가 아니다', () => {
    expect(new CorruptedShippingAddressError('recipient')).not.toBeInstanceOf(DomainError);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain/order`
Expected: FAIL — 파일이 없다.

- [ ] **Step 4: 구현한다**

`order-status.ts`:

```ts
/**
 * 주문 상태. **사가 상태를 겸한다** — 스펙 §6.2가 별도 사가 엔티티를 두지 않기로 했다.
 *
 * `REFUND_PENDING`은 스펙 §5.4의 다이어그램에 없다(편차 1). 취소 요청과 환불 완료
 * 사이에 주문이 `PAID`로 남으면 (1) 고객에게 거짓말을 하고 (2) 취소가 멱등하지 않아
 * at-least-once 배달에서 환불이 두 번 요청된다.
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** 아직 결말이 나지 않은 주문. 조회 화면이 "진행 중"으로 묶는 기준이다. */
export function isOrderOpen(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'REFUND_PENDING';
}
```

`priced-item.ts`:

```ts
import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';

/**
 * `CatalogPriceProvider` ACL이 돌려주는 타입. **Catalog의 `Product`가 아니다.**
 *
 * Ordering이 Catalog의 애그리거트를 들면 상품 가격이 바뀔 때 과거 주문 금액이 따라
 * 바뀌고(스펙 §5.3), Ordering의 도메인 테스트가 Catalog 전체를 끌고 온다.
 * ACL이 값만 복사해 이 타입으로 바꾼다.
 */
export interface PricedItem {
  readonly skuId: SkuId;
  readonly nameSnapshot: string;
  readonly unitPrice: Money;
}
```

`order-line.ts`:

```ts
import type { SkuId } from '../../../../shared/kernel/identifiers';
import type { Money } from '../../../../shared/kernel/money';
import type { Quantity } from '../../../../shared/kernel/quantity';

interface OrderLineParams {
  readonly skuId: SkuId;
  readonly nameSnapshot: string;
  readonly unitPrice: Money;
  readonly quantity: Quantity;
}

/**
 * 주문 한 줄. **불변 VO이고 자체 id가 없다** — `(order_id, sku_id)`가 자연키다(스펙 §10.8).
 *
 * `nameSnapshot`과 `unitPrice`가 스냅샷이다(스펙 §5.3). Catalog의 상품이 이름을 바꾸거나
 * 가격을 올려도 과거 주문은 그때의 값을 그대로 보여준다.
 */
export class OrderLine {
  private constructor(
    readonly skuId: SkuId,
    readonly nameSnapshot: string,
    readonly unitPrice: Money,
    readonly quantity: Quantity,
  ) {}

  /** 인바운드 전용. 실패는 400. */
  static of(params: OrderLineParams): OrderLine {
    if (params.nameSnapshot.trim().length === 0) {
      throw new Error('주문 라인의 이름 스냅샷이 비어 있습니다.');
    }
    if (params.unitPrice.amount <= 0n) {
      throw new Error(`주문 라인의 단가는 0보다 커야 합니다: ${params.unitPrice.amount}`);
    }
    if (params.quantity.value < 1) {
      throw new Error(`주문 라인의 수량은 1개 이상이어야 합니다: ${params.quantity.value}`);
    }
    return new OrderLine(
      params.skuId,
      params.nameSnapshot.trim(),
      params.unitPrice,
      params.quantity,
    );
  }

  /** 영속 복원 전용. 실패는 데이터 손상(500). */
  static fromPersistence(params: OrderLineParams): OrderLine {
    if (params.nameSnapshot.trim().length === 0) {
      throw new Error('저장된 주문 라인의 이름 스냅샷이 비어 있습니다.');
    }
    if (params.unitPrice.amount <= 0n || params.quantity.value < 1) {
      throw new Error(
        `저장된 주문 라인이 손상되었습니다: 단가 ${params.unitPrice.amount}, 수량 ${params.quantity.value}`,
      );
    }
    return new OrderLine(
      params.skuId,
      params.nameSnapshot.trim(),
      params.unitPrice,
      params.quantity,
    );
  }

  /** 태스크 1이 추가한 `Money.multiply(Quantity)`의 첫 사용처다. */
  get subtotal(): Money {
    return this.unitPrice.multiply(this.quantity);
  }
}
```

**`OrderLine.of`가 던지는 것이 `DomainError`가 아닌 평문 `Error`인 이유.** 이 세 조건(이름 있음, 단가 > 0, 수량 ≥ 1)은 사용자 입력이 아니라 **ACL이 돌려준 값과 장바구니 상태의 조합**이다. 사용자는 단가를 보내지 않는다 — Catalog가 준다. 여기 도달했다면 ACL이나 장바구니가 깨진 것이고 사용자가 고칠 수 있는 것이 없다. 500이 맞다.

`shipping-address.ts`:

```ts
import { CorruptedShippingAddressError, InvalidShippingAddressError } from './order.errors';

interface ShippingAddressParams {
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2: string | null;
}

/**
 * 배송지 스냅샷. **id도 label도 없다** — Customer의 `SavedAddress`와 별개의 VO다(스펙 §5.3).
 *
 * 고객이 이사해서 주소록을 고쳐도 과거 주문의 배송지는 그대로 남는다. `label`("집",
 * "회사")을 담지 않는 이유: 그것은 주소록에서 고르기 위한 메타데이터이지 배송에
 * 필요한 정보가 아니다.
 */
export class ShippingAddress {
  private constructor(
    readonly recipient: string,
    readonly phone: string,
    readonly zip: string,
    readonly line1: string,
    readonly line2: string | null,
  ) {}

  /** 인바운드 전용. 실패는 사용자 입력 오류(400). */
  static of(params: ShippingAddressParams): ShippingAddress {
    return ShippingAddress.build(params, (field) => new InvalidShippingAddressError(field));
  }

  /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
  static fromPersistence(params: ShippingAddressParams): ShippingAddress {
    return ShippingAddress.build(params, (field) => new CorruptedShippingAddressError(field));
  }

  private static build(
    params: ShippingAddressParams,
    onEmpty: (field: string) => Error,
  ): ShippingAddress {
    const required = { recipient: params.recipient, phone: params.phone, zip: params.zip, line1: params.line1 };
    for (const [field, value] of Object.entries(required)) {
      if (value.trim().length === 0) {
        throw onEmpty(field);
      }
    }
    const line2 = params.line2 === null ? null : params.line2.trim();
    return new ShippingAddress(
      params.recipient.trim(),
      params.phone.trim(),
      params.zip.trim(),
      params.line1.trim(),
      line2 === '' ? null : line2,
    );
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain/order`
Expected: PASS

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) `of`와 `fromPersistence`가 다른 예외를 던지는가**
`ShippingAddress.fromPersistence`를 `ShippingAddress.of`를 부르도록 바꾼다.
Expected: FAIL — `'저장된 값이 비면 CorruptedShippingAddressError다'`가 `InvalidShippingAddressError`를 받아 실패한다. **이 회귀는 깨진 행에 400을 돌려준다** — 요청은 멀쩡했는데 클라이언트에게 "당신이 잘못했다"고 말하는 것이다. 계획 2의 최종 리뷰가 정확히 이 결함을 매퍼에서 잡았다.
되돌린다.

**(b) 소계가 수량을 실제로 곱하는가**
`get subtotal()`을 `return this.unitPrice;`로 바꾼다.
Expected: FAIL — `'소계는 단가 × 수량이다'`가 `1200n`을 받아 실패한다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 주문 라인·배송지 스냅샷 VO와 상태 타입을 추가한다"
```

---

### Task 9: Ordering 도메인 — `Order` 애그리거트와 상태 머신

**Files:**
- Create: `apps/api/src/modules/ordering/domain/order/{order.events.ts, order.ts}` + `order.spec.ts`
- Modify: `apps/api/src/shared/kernel/money.ts` (`TODO(plan 4)` 주석 갱신)

**Interfaces:**
- Consumes: `OrderLine`, `ShippingAddress`, `OrderStatus`, `Money.sum`, `AggregateRoot`
- Produces:
  - `Order.place({ id, customerId, lines, shippingAddress, now }): Order`
  - `Order.rehydrate({ id, customerId, status, lines, shippingAddress, total, placedAt }): Order`
  - `order.markPaid(now): boolean` / `order.failPayment(reason, now): boolean` / `order.cancelBy(customerId, now): boolean` / `order.markRefunded(now): boolean`
  - `order.total: Money`, `order.status: OrderStatus`, `order.lines: readonly OrderLine[]`, `order.assertOwnedBy(customerId): void`
  - 이벤트 상수 `ORDER_PLACED` / `ORDER_PAID` / `ORDER_PAYMENT_FAILED` / `ORDER_CANCELLED`와 팩토리

**전이표 — 이 태스크의 계약이다**

`true` = 전이 발생 + 이벤트 발행, `false` = 이미 그 상태(멱등, 이벤트 없음), 그 외는 `OrderConflictError`.

| 현재 | `markPaid` | `failPayment` | `cancelBy` | `markRefunded` |
|---|---|---|---|---|
| `PENDING_PAYMENT` | → `PAID`, `true` | → `PAYMENT_FAILED`, `true` | → `CANCELLED`, `true` | 충돌 |
| `PAID` | `false` | 충돌 | → `REFUND_PENDING`, `true` | 충돌 |
| `PAYMENT_FAILED` | 충돌 | `false` | 충돌 | 충돌 |
| `CANCELLED` | 충돌 | 충돌 | `false` | 충돌 |
| `REFUND_PENDING` | 충돌 | 충돌 | `false` | → `REFUNDED`, `true` |
| `REFUNDED` | 충돌 | 충돌 | 충돌 | `false` |

**`PAYMENT_FAILED`에서 `cancelBy`가 충돌인 이유**: 이미 끝난 주문이다. `false`(멱등)로 처리하면 클라이언트가 "취소했다"는 응답을 받고 UI를 그리는데 실제로는 애초에 실패한 주문이다. 상태가 다르면 다르게 말해야 한다.

**`cancelBy`가 소유자 검사를 먼저 한다.** 남의 주문이면 상태와 무관하게 `OrderNotOwnedError`(403)다. 순서가 반대면 남의 주문의 상태를 응답으로 유추할 수 있다.

- [ ] **Step 1: 이벤트를 만든다**

`order.events.ts`:

```ts
import type { DomainEvent } from '../../../../shared/kernel/domain-event';
import type { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import type { Money } from '../../../../shared/kernel/money';

export const ORDER_PLACED = 'ordering.OrderPlaced';
export const ORDER_PAID = 'ordering.OrderPaid';
export const ORDER_PAYMENT_FAILED = 'ordering.OrderPaymentFailed';
export const ORDER_CANCELLED = 'ordering.OrderCancelled';

interface OrderSnapshot {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly total: Money;
}

/**
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload가 JsonB이고
 * 값 객체를 그대로 넣으면 `{}`로 직렬화되어 조용히 빈 이벤트가 나간다. `bigint`도
 * 직렬화되지 않으므로 금액은 문자열이다.
 *
 * **예약 ID를 담지 않는다.** 담으려면 `Order`가 Inventory의 내부 식별자를 들어야 하고,
 * 그것은 Core 애그리거트에 다른 컨텍스트를 박는 결합이다. Inventory는 `orderId`로
 * 자기 예약을 찾는다(태스크 17) — `reservations.order_id`에 인덱스가 이미 있다.
 */
function base(order: OrderSnapshot, eventType: string, occurredAt: Date): DomainEvent {
  return {
    eventType,
    aggregateType: 'Order',
    aggregateId: order.id,
    occurredAt,
    payload: {
      orderId: order.id,
      customerId: order.customerId,
      totalAmount: order.total.amount.toString(),
      totalCurrency: order.total.currency,
    },
  };
}

/** 구독자가 없다. 알림 기능이 붙을 자리이며, 지금은 사가의 시작을 감사 로그에 남긴다. */
export const orderPlaced = (order: OrderSnapshot, occurredAt: Date): DomainEvent =>
  base(order, ORDER_PLACED, occurredAt);

/** Inventory가 구독해 예약을 확정한다(스펙 §5.6). */
export const orderPaid = (order: OrderSnapshot, occurredAt: Date): DomainEvent =>
  base(order, ORDER_PAID, occurredAt);

/** Inventory가 구독해 예약을 해제한다. */
export function orderPaymentFailed(
  order: OrderSnapshot,
  reason: string,
  occurredAt: Date,
): DomainEvent {
  const event = base(order, ORDER_PAYMENT_FAILED, occurredAt);
  return { ...event, payload: { ...event.payload, reason } };
}

/**
 * Inventory가 구독해 예약을 해제하거나 복원하고, Payment가 구독해 환불한다.
 *
 * `wasPaid`가 payload에 있는 이유: 구독자가 "예약을 해제해야 하는가(아직 확정 전)"와
 * "확정된 재고를 복원해야 하는가(이미 차감됨)"를 갈라야 한다. 이 값이 없으면
 * Inventory가 예약 상태를 보고 추측해야 하고, 추측은 경합에서 틀린다.
 */
export function orderCancelled(
  order: OrderSnapshot,
  wasPaid: boolean,
  occurredAt: Date,
): DomainEvent {
  const event = base(order, ORDER_CANCELLED, occurredAt);
  return { ...event, payload: { ...event.payload, wasPaid } };
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`order.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../shared/kernel/domain-error';
import { CustomerId, OrderId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { customerUuid, FIXED_NOW, orderUuid, skuUuid } from '../../testing/ordering.fixtures';
import { Order } from './order';
import { OrderLine } from './order-line';
import {
  ORDER_CANCELLED,
  ORDER_PAID,
  ORDER_PAYMENT_FAILED,
  ORDER_PLACED,
} from './order.events';
import {
  CorruptedOrderError,
  EmptyOrderError,
  MixedCurrencyOrderError,
  OrderConflictError,
  OrderNotOwnedError,
} from './order.errors';
import { ShippingAddress } from './shipping-address';

const OWNER = CustomerId.of(customerUuid('1'));
const STRANGER = CustomerId.of(customerUuid('2'));

const ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

const line = (suffix: string, amount: bigint, qty: number, currency: 'KRW' | 'USD' = 'KRW') =>
  OrderLine.of({
    skuId: SkuId.of(skuUuid(suffix)),
    nameSnapshot: `상품 ${suffix}`,
    unitPrice: Money.of(amount, currency),
    quantity: Quantity.positive(qty),
  });

function place(lines = [line('1', 1200n, 3), line('2', 500n, 2)]): Order {
  return Order.place({
    id: OrderId.of(orderUuid('1')),
    customerId: OWNER,
    lines,
    shippingAddress: ADDRESS,
    now: FIXED_NOW,
  });
}

describe('Order.place', () => {
  it('PENDING_PAYMENT로 시작하고 OrderPlaced를 발행한다', () => {
    const order = place();
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.pullEvents().map((e) => e.eventType)).toEqual([ORDER_PLACED]);
  });

  it('총액은 라인 소계의 합이다', () => {
    // 1200×3 + 500×2 = 4600
    expect(place().total.amount).toBe(4600n);
  });

  it('라인이 없으면 EmptyOrderError다', () => {
    expect(() => place([])).toThrow(EmptyOrderError);
  });

  it('통화가 섞이면 MixedCurrencyOrderError다', () => {
    // 편차 2. 이것이 없으면 Money.plus의 CurrencyMismatchError(평문 Error)가
    // 튀어나와 500이 나가고 사용자는 왜 실패했는지 알 수 없다.
    expect(() => place([line('1', 1000n, 1, 'KRW'), line('2', 1000n, 1, 'USD')])).toThrow(
      MixedCurrencyOrderError,
    );
  });

  it('MixedCurrencyOrderError는 DomainError다 — 500이 아니라 422다', () => {
    expect(new MixedCurrencyOrderError(['KRW', 'USD'])).toBeInstanceOf(DomainError);
  });

  it('같은 SKU가 두 줄이면 CorruptedOrderError다', () => {
    // 장바구니가 중복을 막지만(태스크 7) 주문 조립이 그것을 신뢰하지 않는다.
    // 중복 라인은 (order_id, sku_id) 기본키에도 걸려 저장 자체가 실패한다.
    expect(() => place([line('1', 1000n, 1), line('1', 2000n, 1)])).toThrow(CorruptedOrderError);
  });

  it('돌려준 lines를 바꿔도 주문은 바뀌지 않는다', () => {
    const order = place();
    (order.lines as OrderLine[]).pop();
    expect(order.lines).toHaveLength(2);
  });
});

describe('Order 상태 전이 — 결제', () => {
  it('결제되면 PAID가 되고 OrderPaid를 발행한다', () => {
    const order = place();
    order.pullEvents();

    expect(order.markPaid(FIXED_NOW)).toBe(true);

    expect(order.status).toBe('PAID');
    expect(order.pullEvents().map((e) => e.eventType)).toEqual([ORDER_PAID]);
  });

  it('두 번 결제 처리하면 false를 돌려주고 이벤트를 다시 내지 않는다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    order.pullEvents();

    expect(order.markPaid(FIXED_NOW)).toBe(false);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('결제 실패하면 PAYMENT_FAILED가 되고 이유가 payload에 실린다', () => {
    const order = place();
    order.pullEvents();

    expect(order.failPayment('카드 한도를 초과했습니다.', FIXED_NOW)).toBe(true);

    const events = order.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([ORDER_PAYMENT_FAILED]);
    expect(events[0]?.payload).toMatchObject({ reason: '카드 한도를 초과했습니다.' });
  });

  it('이미 결제된 주문은 실패 처리할 수 없다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.failPayment('늦은 거절', FIXED_NOW)).toThrow(OrderConflictError);
  });
});

describe('Order.cancelBy — 도메인 인가', () => {
  it('남의 주문은 상태와 무관하게 OrderNotOwnedError다', () => {
    // 스펙 §5.5: 가드가 아니라 도메인에 있다. 순서도 중요하다 — 상태 검사가
    // 먼저면 남의 주문 상태를 응답으로 유추할 수 있다.
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.cancelBy(STRANGER, FIXED_NOW)).toThrow(OrderNotOwnedError);
  });

  it('OrderNotOwnedError는 DomainError다', () => {
    expect(new OrderNotOwnedError('id')).toBeInstanceOf(DomainError);
  });

  it('결제 전 취소는 CANCELLED가 되고 wasPaid가 false다', () => {
    const order = place();
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(true);

    expect(order.status).toBe('CANCELLED');
    const events = order.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([ORDER_CANCELLED]);
    expect(events[0]?.payload).toMatchObject({ wasPaid: false });
  });

  it('결제 후 취소는 REFUND_PENDING이 되고 wasPaid가 true다', () => {
    // 편차 1. PAID로 남겨두면 고객에게 거짓말을 하고 취소가 멱등하지 않다.
    // wasPaid가 구독자에게 "해제"인지 "복원"인지를 알려준다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(true);

    expect(order.status).toBe('REFUND_PENDING');
    expect(order.pullEvents()[0]?.payload).toMatchObject({ wasPaid: true });
  });

  it('취소를 두 번 하면 false이고 이벤트가 다시 나가지 않는다', () => {
    // OrderCancelled가 at-least-once로 배달된다. 여기서 막지 못하면 환불이 두 번 요청된다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(false);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('결제 실패한 주문은 취소할 수 없다', () => {
    // 이미 끝난 주문이다. false로 넘기면 클라이언트가 "취소했다"고 표시하는데
    // 실제로는 애초에 실패한 주문이다.
    const order = place();
    order.failPayment('거절', FIXED_NOW);
    expect(() => order.cancelBy(OWNER, FIXED_NOW)).toThrow(OrderConflictError);
  });
});

describe('Order.markRefunded', () => {
  it('REFUND_PENDING에서만 REFUNDED가 된다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.pullEvents();

    expect(order.markRefunded(FIXED_NOW)).toBe(true);
    expect(order.status).toBe('REFUNDED');
    // 구독자가 없는 이벤트는 발행하지 않는다.
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('PAID 상태에서 환불 완료가 오면 충돌이다', () => {
    // 취소 요청 없이 환불 완료가 왔다는 것은 사가가 순서를 잃었다는 뜻이다.
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.markRefunded(FIXED_NOW)).toThrow(OrderConflictError);
  });

  it('두 번 오면 false다', () => {
    // PaymentRefunded도 at-least-once로 배달된다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.markRefunded(FIXED_NOW);

    expect(order.markRefunded(FIXED_NOW)).toBe(false);
  });
});

describe('Order.assertOwnedBy', () => {
  it('본인이면 통과한다', () => {
    expect(() => place().assertOwnedBy(OWNER)).not.toThrow();
  });

  it('남이면 OrderNotOwnedError다', () => {
    // 조회에도 같은 규칙이 필요하다 — 태스크 14의 GetOrder가 쓴다.
    expect(() => place().assertOwnedBy(STRANGER)).toThrow(OrderNotOwnedError);
  });
});

describe('Order.rehydrate', () => {
  it('알 수 없는 상태는 CorruptedOrderError다', () => {
    expect(() =>
      Order.rehydrate({
        id: OrderId.fromPersistence(orderUuid('9')),
        customerId: CustomerId.fromPersistence(customerUuid('1')),
        status: 'WEIRD',
        lines: [line('1', 1000n, 1)],
        shippingAddress: ADDRESS,
        total: Money.of(1000n),
        placedAt: FIXED_NOW,
      }),
    ).toThrow(CorruptedOrderError);
  });

  it('저장된 총액이 라인 합과 다르면 CorruptedOrderError다', () => {
    // 스펙 §5.1의 불변식 "합계 = Σ(단가×수량)". 어긋난 채 읽어들이면 그 주문은
    // 영원히 틀린 금액을 보여준다 — 소리 나게 실패하는 편이 낫다.
    expect(() =>
      Order.rehydrate({
        id: OrderId.fromPersistence(orderUuid('9')),
        customerId: CustomerId.fromPersistence(customerUuid('1')),
        status: 'PAID',
        lines: [line('1', 1000n, 2)],
        shippingAddress: ADDRESS,
        total: Money.of(9999n),
        placedAt: FIXED_NOW,
      }),
    ).toThrow(CorruptedOrderError);
  });

  it('CorruptedOrderError는 DomainError가 아니다', () => {
    expect(new CorruptedOrderError('id', 'detail')).not.toBeInstanceOf(DomainError);
  });

  it('복원된 주문은 이벤트를 갖지 않는다', () => {
    // 읽어들인 것만으로 이벤트가 생기면 저장할 때마다 outbox에 중복이 쌓인다.
    const order = Order.rehydrate({
      id: OrderId.fromPersistence(orderUuid('9')),
      customerId: CustomerId.fromPersistence(customerUuid('1')),
      status: 'PAID',
      lines: [line('1', 1000n, 2)],
      shippingAddress: ADDRESS,
      total: Money.of(2000n),
      placedAt: FIXED_NOW,
    });
    expect(order.hasUncommittedEvents).toBe(false);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain/order/order.spec.ts`
Expected: FAIL — `order.ts`가 없다.

- [ ] **Step 4: `Order`를 구현한다**

```ts
import { AggregateRoot } from '../../../../shared/kernel/aggregate-root';
import type { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { OrderLine } from './order-line';
import { isOrderStatus, type OrderStatus } from './order-status';
import {
  orderCancelled,
  orderPaid,
  orderPaymentFailed,
  orderPlaced,
} from './order.events';
import {
  CorruptedOrderError,
  EmptyOrderError,
  MixedCurrencyOrderError,
  OrderConflictError,
  OrderNotOwnedError,
} from './order.errors';
import type { ShippingAddress } from './shipping-address';

/**
 * 주문 애그리거트. **상태 머신이 사가 상태를 겸한다** — 스펙 §6.2가 별도 사가
 * 엔티티를 두지 않기로 했고, `Order` 자체가 이미 상태 머신인데 그 위에 또 하나를
 * 얹는 것은 이 규모에 과하다.
 *
 * 전이 메서드는 **성공하면 `true`, 이미 그 상태면 `false`, 되돌릴 수 없으면 던진다.**
 * 이벤트가 outbox를 거쳐 at-least-once로 배달되므로(스펙 §6.3) 같은 전이가 두 번
 * 요청될 수 있고, 두 번째가 이벤트를 다시 발행하면 환불이 두 번 나간다.
 */
export class Order extends AggregateRoot {
  private constructor(
    readonly id: OrderId,
    readonly customerId: CustomerId,
    private statusValue: OrderStatus,
    private readonly lineList: OrderLine[],
    readonly shippingAddress: ShippingAddress,
    readonly total: Money,
    readonly placedAt: Date,
  ) {
    super();
  }

  static place(params: {
    id: OrderId;
    customerId: CustomerId;
    lines: OrderLine[];
    shippingAddress: ShippingAddress;
    now: Date;
  }): Order {
    if (params.lines.length === 0) {
      throw new EmptyOrderError();
    }
    Order.assertSingleCurrency(params.lines);
    Order.assertNoDuplicateSku(params.id, params.lines);

    const total = Money.sum(params.lines.map((line) => line.subtotal));
    const order = new Order(
      params.id,
      params.customerId,
      'PENDING_PAYMENT',
      [...params.lines],
      params.shippingAddress,
      total,
      params.now,
    );
    order.raise(orderPlaced(order, params.now));
    return order;
  }

  static rehydrate(params: {
    id: OrderId;
    customerId: CustomerId;
    status: string;
    lines: OrderLine[];
    shippingAddress: ShippingAddress;
    total: Money;
    placedAt: Date;
  }): Order {
    if (!isOrderStatus(params.status)) {
      throw new CorruptedOrderError(params.id, `알 수 없는 상태 "${params.status}"`);
    }
    if (params.lines.length === 0) {
      throw new CorruptedOrderError(params.id, '라인이 없습니다');
    }
    const computed = Money.sum(params.lines.map((line) => line.subtotal), params.total.currency);
    if (!computed.equals(params.total)) {
      // 스펙 §5.1의 불변식 "합계 = Σ(단가×수량)". 어긋난 채 읽어들이면 그 주문은
      // 영원히 틀린 금액을 보여준다.
      throw new CorruptedOrderError(
        params.id,
        `총액이 라인 합과 다릅니다: 저장 ${params.total.amount}, 계산 ${computed.amount}`,
      );
    }
    return new Order(
      params.id,
      params.customerId,
      params.status,
      [...params.lines],
      params.shippingAddress,
      params.total,
      params.placedAt,
    );
  }

  get status(): OrderStatus {
    return this.statusValue;
  }

  /** 복사본을 돌려준다 — 내부 배열이 새면 총액 불변식이 우회된다. */
  get lines(): readonly OrderLine[] {
    return [...this.lineList];
  }

  markPaid(now: Date): boolean {
    if (this.statusValue === 'PAID') {
      return false;
    }
    this.assertFrom('PENDING_PAYMENT', 'PAID');
    this.statusValue = 'PAID';
    this.raise(orderPaid(this, now));
    return true;
  }

  failPayment(reason: string, now: Date): boolean {
    if (this.statusValue === 'PAYMENT_FAILED') {
      return false;
    }
    this.assertFrom('PENDING_PAYMENT', 'PAYMENT_FAILED');
    this.statusValue = 'PAYMENT_FAILED';
    this.raise(orderPaymentFailed(this, reason, now));
    return true;
  }

  /**
   * **도메인 인가가 여기 있다** — 스펙 §5.5. 가드로 처리하면 HTTP가 아닌 경로
   * (배치, 이벤트 핸들러, 관리자 CLI)로 들어올 때 규칙이 통째로 사라진다.
   *
   * 소유자 검사가 상태 검사보다 **먼저** 온다. 순서가 반대면 남의 주문의 상태를
   * 응답으로 유추할 수 있다.
   */
  cancelBy(customerId: CustomerId, now: Date): boolean {
    this.assertOwnedBy(customerId);

    if (this.statusValue === 'CANCELLED' || this.statusValue === 'REFUND_PENDING') {
      return false;
    }
    if (this.statusValue === 'PENDING_PAYMENT') {
      this.statusValue = 'CANCELLED';
      this.raise(orderCancelled(this, false, now));
      return true;
    }
    if (this.statusValue === 'PAID') {
      // 편차 1: 환불이 끝날 때까지 REFUND_PENDING으로 둔다.
      this.statusValue = 'REFUND_PENDING';
      this.raise(orderCancelled(this, true, now));
      return true;
    }
    throw new OrderConflictError(this.id, this.statusValue, 'CANCELLED');
  }

  /** `PaymentRefunded` 구독자가 부른다(태스크 13). 구독자가 없으므로 이벤트를 내지 않는다. */
  markRefunded(now: Date): boolean {
    void now;
    if (this.statusValue === 'REFUNDED') {
      return false;
    }
    this.assertFrom('REFUND_PENDING', 'REFUNDED');
    this.statusValue = 'REFUNDED';
    return true;
  }

  assertOwnedBy(customerId: CustomerId): void {
    if (this.customerId !== customerId) {
      throw new OrderNotOwnedError(this.id);
    }
  }

  private assertFrom(expected: OrderStatus, to: OrderStatus): void {
    if (this.statusValue !== expected) {
      throw new OrderConflictError(this.id, this.statusValue, to);
    }
  }

  private static assertSingleCurrency(lines: readonly OrderLine[]): void {
    const currencies = [...new Set(lines.map((line) => line.unitPrice.currency))];
    if (currencies.length > 1) {
      throw new MixedCurrencyOrderError(currencies);
    }
  }

  private static assertNoDuplicateSku(id: OrderId, lines: readonly OrderLine[]): void {
    // 장바구니가 중복을 막지만(태스크 7) 주문 조립이 그것을 신뢰하지 않는다.
    // 중복이 통과하면 (order_id, sku_id) 기본키에 걸려 저장이 500으로 죽는데,
    // 그때는 원인이 어디였는지 알 수 없다.
    if (new Set(lines.map((line) => line.skuId)).size !== lines.length) {
      throw new CorruptedOrderError(id, '같은 SKU가 두 줄에 있습니다');
    }
  }
}
```

`markRefunded`의 `void now;`는 시그니처를 다른 전이 메서드와 맞추기 위한 것이다. 지금은 쓰이지 않지만 환불 시각을 기록하게 되면 여기서 쓴다 — 그때 호출부를 고치지 않아도 되도록 남긴다.

- [ ] **Step 5: `money.ts`의 TODO를 갱신한다**

`CurrencyMismatchError`의 주석에서 `TODO(plan 4): Cart에 단일 통화 불변식을 추가해 이 경로 자체가 발생하지 않도록 한다.`를 지우고 이렇게 바꾼다.

```
 * 주문 경로에서는 `Order.place`가 먼저 `MixedCurrencyOrderError`(422)로 막으므로
 * 이 예외에 도달하지 않는다 — 계획 4의 편차 2가 그 판단이다. `Cart`가 아니라 `Order`인
 * 이유: 장바구니에는 가격이 없고 통화가 처음 만나는 곳이 주문 라인 조립이기 때문이다.
 * 여기 도달했다면 그 경로를 우회한 호출자가 있다는 뜻이고, 그것은 사용자가 고칠 수
 * 없으므로 500이 맞다.
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/domain`
Expected: PASS

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 소유자 검사가 상태 검사보다 먼저인가**
`cancelBy`의 `this.assertOwnedBy(customerId);`를 메서드 **끝**(모든 상태 분기 뒤)으로 옮긴다.
Expected: FAIL — `'남의 주문은 상태와 무관하게 OrderNotOwnedError다'`가 `PAID`를 취소해 `true`를 받고 실패한다. **이 회귀는 남이 내 주문을 취소하게 만든다.**
되돌린다.

**(b) 취소 멱등성이 있는가**
`cancelBy`의 `if (this.statusValue === 'CANCELLED' || this.statusValue === 'REFUND_PENDING') return false;`를 지운다.
Expected: FAIL — `'취소를 두 번 하면 false이고 이벤트가 다시 나가지 않는다'`가 `OrderConflictError`를 받아 실패한다. **at-least-once 배달에서 환불이 두 번 요청되는 회귀다.**
되돌린다.

**(c) 총액 불변식이 `rehydrate`에 있는가**
`computed.equals(params.total)` 검사를 지운다.
Expected: FAIL — `'저장된 총액이 라인 합과 다르면 CorruptedOrderError다'`가 실패한다.
되돌린다.

**(d) 통화 검사가 `Money.sum`보다 먼저인가**
`place`에서 `Order.assertSingleCurrency(params.lines);`를 `Money.sum` 호출 **뒤로** 옮긴다.
Expected: FAIL — `'통화가 섞이면 MixedCurrencyOrderError다'`가 `CurrencyMismatchError`(평문 `Error`)를 받아 실패한다. **이것이 편차 2가 막으려는 바로 그 회귀다** — 500이 나가고 사용자는 이유를 알 수 없다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `modules/ordering/domain/**` 커버리지가 95/90을 넘는지 확인한다.

```bash
git add apps/api/src/modules/ordering apps/api/src/shared/kernel/money.ts
git commit -m "feat(ordering): Order 애그리거트와 사가 상태 머신을 추가한다"
```

---

### Task 10: Ordering 애플리케이션 — 장바구니 유스케이스와 `CartRepository`

**Files:**
- Create: `apps/api/src/modules/ordering/application/ports/out/cart.repository.ts`
- Create: `apps/api/src/modules/ordering/application/ports/in/{add-item-to-cart,remove-item-from-cart,change-cart-item-quantity}.usecase.ts`
- Create: `apps/api/src/modules/ordering/application/services/manage-cart.service.ts` + `manage-cart.service.spec.ts`
- Create: `apps/api/src/modules/ordering/testing/{in-memory-cart.repository.ts, cart-repository.contract.ts}` + `in-memory-cart.repository.spec.ts`
- Create: `apps/api/src/modules/ordering/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Consumes: `Cart`, `CartLine`, `TransactionManager`, `IdGenerator`
- Produces:
  - `CartRepository` — `findByCustomerId(customerId, tx?)`, `save(cart, tx?)`, `delete(cartId, tx?)`
  - `AddItemToCartUseCase.execute({ customerId, skuId, quantity })` + `ADD_ITEM_TO_CART_USECASE`
  - `RemoveItemFromCartUseCase.execute({ customerId, skuId })` + `REMOVE_ITEM_FROM_CART_USECASE`
  - `ChangeCartItemQuantityUseCase.execute({ customerId, skuId, quantity })` + `CHANGE_CART_ITEM_QUANTITY_USECASE`
  - `ManageCartService`가 셋을 `addItem` / `removeItem` / `changeQuantity`로 구현한다
  - `CartNotFoundError`(404)

**장바구니는 없으면 만든다 — 단, 담을 때만.** `addItem`은 장바구니가 없으면 새로 만든다(고객이 처음 담는 순간). `removeItem`과 `changeQuantity`는 없으면 `CartNotFoundError`다 — 없는 장바구니에서 무언가를 빼겠다는 요청은 클라이언트가 상태를 잘못 알고 있다는 신호이고, 조용히 성공시키면 그 사실이 드러나지 않는다.

- [ ] **Step 1: 포트를 정의한다**

`cart.repository.ts`:

```ts
import type { CartId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Cart } from '../../../domain/cart/cart';

export interface CartRepository {
  /** 고객당 장바구니는 하나다 — `carts.customer_id`가 유니크다. */
  findByCustomerId(customerId: CustomerId, tx?: TransactionContext): Promise<Cart | null>;
  save(cart: Cart, tx?: TransactionContext): Promise<void>;
  /** 주문이 만들어지면 장바구니를 지운다(태스크 12). 없으면 조용히 넘어간다. */
  delete(cartId: CartId, tx?: TransactionContext): Promise<void>;
}

export const CART_REPOSITORY = Symbol('CartRepository');
```

세 인바운드 포트는 각각 커맨드 인터페이스와 `execute` 하나, 그리고 토큰이다.

```ts
// add-item-to-cart.usecase.ts
export interface AddItemToCartCommand {
  readonly customerId: string;
  readonly skuId: string;
  readonly quantity: number;
}

export interface AddItemToCartUseCase {
  execute(command: AddItemToCartCommand): Promise<void>;
}

export const ADD_ITEM_TO_CART_USECASE = Symbol('AddItemToCartUseCase');
```

```ts
// remove-item-from-cart.usecase.ts
export interface RemoveItemFromCartCommand {
  readonly customerId: string;
  readonly skuId: string;
}

export interface RemoveItemFromCartUseCase {
  execute(command: RemoveItemFromCartCommand): Promise<void>;
}

export const REMOVE_ITEM_FROM_CART_USECASE = Symbol('RemoveItemFromCartUseCase');
```

```ts
// change-cart-item-quantity.usecase.ts
export interface ChangeCartItemQuantityCommand {
  readonly customerId: string;
  readonly skuId: string;
  readonly quantity: number;
}

export interface ChangeCartItemQuantityUseCase {
  execute(command: ChangeCartItemQuantityCommand): Promise<void>;
}

export const CHANGE_CART_ITEM_QUANTITY_USECASE = Symbol('ChangeCartItemQuantityUseCase');
```

`cart.errors.ts`에 `CartNotFoundError`를 더한다.

```ts
/** 없는 장바구니에서 무언가를 빼려 했다. 클라이언트가 상태를 잘못 알고 있다는 신호다. */
export class CartNotFoundError extends DomainError {
  static readonly CODE = 'CART_NOT_FOUND';
  readonly code = CartNotFoundError.CODE;

  constructor(customerId: string) {
    super(`장바구니가 없습니다: ${customerId}`);
  }
}
```

- [ ] **Step 2: in-memory 구현과 계약 스위트를 쓴다**

`in-memory-cart.repository.ts` — **저장할 때 복사한다.** 계획 3의 in-memory 재고 리포지토리가 이 버그(저장본을 그대로 넘김)로 계약 스위트를 거짓 통과시켰다.

```ts
import type { CartId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CartRepository } from '../application/ports/out/cart.repository';
import { Cart } from '../domain/cart/cart';
import { CartLine } from '../domain/cart/cart-line';

export class InMemoryCartRepository implements CartRepository {
  private readonly byCustomer = new Map<string, Cart>();

  async findByCustomerId(customerId: CustomerId, _tx?: TransactionContext): Promise<Cart | null> {
    const found = this.byCustomer.get(customerId);
    return found === undefined ? null : InMemoryCartRepository.copy(found);
  }

  async save(cart: Cart, _tx?: TransactionContext): Promise<void> {
    this.byCustomer.set(cart.customerId, InMemoryCartRepository.copy(cart));
  }

  async delete(cartId: CartId, _tx?: TransactionContext): Promise<void> {
    for (const [customerId, cart] of this.byCustomer.entries()) {
      if (cart.id === cartId) {
        this.byCustomer.delete(customerId);
        return;
      }
    }
  }

  private static copy(cart: Cart): Cart {
    return Cart.rehydrate({
      id: cart.id,
      customerId: cart.customerId,
      lines: cart.lines.map((line) => new CartLine(line.skuId, line.quantity)),
    });
  }
}
```

`cart-repository.contract.ts` — 같은 스위트가 in-memory와 Prisma 양쪽에 돈다.

```ts
import { describe, expect, it } from 'vitest';
import { CartId, CustomerId, SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import type { CartRepository } from '../application/ports/out/cart.repository';
import { Cart } from '../domain/cart/cart';
import { cartUuid, customerUuid, skuUuid } from './ordering.fixtures';

export function cartRepositoryContract(
  name: string,
  createRepo: () => Promise<CartRepository>,
): void {
  describe(`CartRepository 계약 — ${name}`, () => {
    const make = (suffix: string): Cart =>
      Cart.create({
        id: CartId.of(cartUuid(suffix)),
        customerId: CustomerId.of(customerUuid(suffix)),
      });

    it('없는 고객의 장바구니는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findByCustomerId(CustomerId.of(customerUuid('99')))).toBeNull();
    });

    it('저장한 장바구니를 고객 id로 찾는다', async () => {
      const repo = await createRepo();
      const cart = make('1');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(2));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('1')));
      expect(found?.id).toBe(cartUuid('1'));
      expect(found?.lines).toHaveLength(1);
      expect(found?.lines[0]?.quantity.value).toBe(2);
    });

    it('줄을 추가하면 저장된다', async () => {
      const repo = await createRepo();
      const cart = make('2');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.addItem(SkuId.of(skuUuid('2')), Quantity.positive(3));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('2')));
      expect(found?.lines).toHaveLength(2);
    });

    it('줄을 빼면 저장본에서도 사라진다', async () => {
      // save가 append-only면 이 테스트가 실패한다. 장바구니는 통째로 갈아끼워야 한다.
      const repo = await createRepo();
      const cart = make('3');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      cart.addItem(SkuId.of(skuUuid('2')), Quantity.positive(1));
      await repo.save(cart);

      cart.removeItem(SkuId.of(skuUuid('1')));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('3')));
      expect(found?.lines.map((line) => line.skuId)).toEqual([skuUuid('2')]);
    });

    it('수량 변경이 저장된다', async () => {
      const repo = await createRepo();
      const cart = make('4');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.changeQuantity(SkuId.of(skuUuid('1')), Quantity.positive(9));
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('4')));
      expect(found?.lines[0]?.quantity.value).toBe(9);
    });

    it('빈 장바구니도 저장되고 복원된다', async () => {
      // clear() 후 저장하면 줄이 0개인 장바구니가 남는다. 그것이 null과 구분돼야
      // "장바구니는 있는데 비었다"와 "장바구니가 없다"를 클라이언트가 구분할 수 있다.
      const repo = await createRepo();
      const cart = make('5');
      cart.addItem(SkuId.of(skuUuid('1')), Quantity.positive(1));
      await repo.save(cart);

      cart.clear();
      await repo.save(cart);

      const found = await repo.findByCustomerId(CustomerId.of(customerUuid('5')));
      expect(found).not.toBeNull();
      expect(found?.isEmpty).toBe(true);
    });

    it('삭제하면 null이 된다', async () => {
      const repo = await createRepo();
      await repo.save(make('6'));
      await repo.delete(CartId.of(cartUuid('6')));
      expect(await repo.findByCustomerId(CustomerId.of(customerUuid('6')))).toBeNull();
    });

    it('없는 장바구니를 지워도 던지지 않는다', async () => {
      // 주문이 두 번 처리돼도(at-least-once) 두 번째 삭제가 실패하면 안 된다.
      const repo = await createRepo();
      await expect(repo.delete(CartId.of(cartUuid('98')))).resolves.toBeUndefined();
    });

    it('돌려준 장바구니를 바꿔도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(make('7'));

      const first = await repo.findByCustomerId(CustomerId.of(customerUuid('7')));
      first?.addItem(SkuId.of(skuUuid('1')), Quantity.positive(5));

      const second = await repo.findByCustomerId(CustomerId.of(customerUuid('7')));
      expect(second?.lines).toHaveLength(0);
    });
  });
}
```

- [ ] **Step 3: `ManageCartService`의 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { CustomerId } from '../../../../shared/kernel/identifiers';
import { QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { CartLineNotFoundError, CartNotFoundError } from '../../domain/cart/cart.errors';
import { InMemoryCartRepository } from '../../testing/in-memory-cart.repository';
import { customerUuid, skuUuid } from '../../testing/ordering.fixtures';
import { ManageCartService } from './manage-cart.service';

const CUSTOMER = customerUuid('1');
const SKU = skuUuid('1');

function build() {
  const carts = new InMemoryCartRepository();
  const service = new ManageCartService(
    carts,
    new PassthroughTransactionManager(),
    new SequentialIdGenerator(),
  );
  return { carts, service };
}

describe('ManageCartService.addItem', () => {
  it('장바구니가 없으면 만들어서 담는다', async () => {
    const { service, carts } = build();

    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 2 });

    const cart = await carts.findByCustomerId(CustomerId.of(CUSTOMER));
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]?.quantity.value).toBe(2);
  });

  it('두 번 담으면 장바구니가 하나만 만들어진다', async () => {
    // 매번 새로 만들면 carts.customer_id 유니크에 걸려 두 번째가 500으로 죽는다.
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });
    const first = await carts.findByCustomerId(CustomerId.of(CUSTOMER));

    await service.addItem({ customerId: CUSTOMER, skuId: skuUuid('2'), quantity: 1 });

    const second = await carts.findByCustomerId(CustomerId.of(CUSTOMER));
    expect(second?.id).toBe(first?.id);
    expect(second?.lines).toHaveLength(2);
  });

  it('수량 0은 QuantityBelowMinimumError다', async () => {
    const { service } = build();
    await expect(
      service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 0 }),
    ).rejects.toThrow(QuantityBelowMinimumError);
  });

  it('수량 0이면 장바구니를 만들지 않는다', async () => {
    // 값 객체 생성이 저장 전에 있어야 한다. 순서가 반대면 실패한 요청이
    // 빈 장바구니를 남긴다.
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 0 }).catch(() => undefined);

    expect(await carts.findByCustomerId(CustomerId.of(CUSTOMER))).toBeNull();
  });
});

describe('ManageCartService.removeItem', () => {
  it('줄을 뺀다', async () => {
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await service.removeItem({ customerId: CUSTOMER, skuId: SKU });

    expect((await carts.findByCustomerId(CustomerId.of(CUSTOMER)))?.isEmpty).toBe(true);
  });

  it('장바구니가 없으면 CartNotFoundError다', async () => {
    // 조용히 성공시키면 클라이언트가 상태를 잘못 알고 있다는 사실이 드러나지 않는다.
    const { service } = build();
    await expect(service.removeItem({ customerId: CUSTOMER, skuId: SKU })).rejects.toThrow(
      CartNotFoundError,
    );
  });

  it('없는 줄을 빼면 CartLineNotFoundError다', async () => {
    const { service } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await expect(
      service.removeItem({ customerId: CUSTOMER, skuId: skuUuid('9') }),
    ).rejects.toThrow(CartLineNotFoundError);
  });
});

describe('ManageCartService.changeQuantity', () => {
  it('수량을 바꾼다', async () => {
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await service.changeQuantity({ customerId: CUSTOMER, skuId: SKU, quantity: 7 });

    expect((await carts.findByCustomerId(CustomerId.of(CUSTOMER)))?.lines[0]?.quantity.value).toBe(7);
  });

  it('장바구니가 없으면 CartNotFoundError다', async () => {
    const { service } = build();
    await expect(
      service.changeQuantity({ customerId: CUSTOMER, skuId: SKU, quantity: 1 }),
    ).rejects.toThrow(CartNotFoundError);
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering`
Expected: FAIL — `manage-cart.service.ts`가 없다.

- [ ] **Step 5: `ManageCartService`를 구현한다**

```ts
import { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../shared/kernel/quantity';
import { Cart } from '../../domain/cart/cart';
import { CartNotFoundError } from '../../domain/cart/cart.errors';
import type { AddItemToCartCommand } from '../ports/in/add-item-to-cart.usecase';
import type { ChangeCartItemQuantityCommand } from '../ports/in/change-cart-item-quantity.usecase';
import type { RemoveItemFromCartCommand } from '../ports/in/remove-item-from-cart.usecase';
import type { CartRepository } from '../ports/out/cart.repository';

/**
 * 장바구니 유스케이스 셋. 셋 다 "장바구니를 찾고, 애그리거트 메서드를 한 번 부르고,
 * 저장한다"는 같은 세 줄이라 한 서비스로 둔다 — 나누면 그 세 줄이 세 번 복제된다.
 * 포트는 셋으로 나눠 컨트롤러와 DI가 보는 표면을 유스케이스 단위로 유지한다.
 * 계획 2의 `ManageAddressesService`가 같은 판단을 했다.
 */
export class ManageCartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly transactions: TransactionManager,
    private readonly ids: IdGenerator,
  ) {}

  async addItem(command: AddItemToCartCommand): Promise<void> {
    // 값 객체 생성이 트랜잭션 밖이다 — 수량 0처럼 성공할 수 없는 요청으로 트랜잭션을
    // 열지 않고, 무엇보다 실패한 요청이 빈 장바구니를 남기지 않는다.
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);
    const quantity = Quantity.positive(command.quantity);

    await this.transactions.run(async (tx) => {
      const cart =
        (await this.carts.findByCustomerId(customerId, tx)) ??
        Cart.create({ id: CartId.of(this.ids.nextId()), customerId });
      cart.addItem(skuId, quantity);
      await this.carts.save(cart, tx);
    });
  }

  async removeItem(command: RemoveItemFromCartCommand): Promise<void> {
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);

    await this.transactions.run(async (tx) => {
      const cart = await this.requireCart(customerId, tx);
      cart.removeItem(skuId);
      await this.carts.save(cart, tx);
    });
  }

  async changeQuantity(command: ChangeCartItemQuantityCommand): Promise<void> {
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);
    const quantity = Quantity.positive(command.quantity);

    await this.transactions.run(async (tx) => {
      const cart = await this.requireCart(customerId, tx);
      cart.changeQuantity(skuId, quantity);
      await this.carts.save(cart, tx);
    });
  }

  private async requireCart(
    customerId: CustomerId,
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
  ): Promise<Cart> {
    const cart = await this.carts.findByCustomerId(customerId, tx);
    if (cart === null) {
      throw new CartNotFoundError(customerId);
    }
    return cart;
  }
}
```

`requireCart`의 `tx` 타입이 장황하다. `import type { TransactionContext } from '../../../../shared/kernel/ports/transaction-manager';`를 더하고 `tx: TransactionContext`로 쓴다.

- [ ] **Step 6: `port-tokens.spec.ts`를 쓴다**

계획 3의 inventory 것과 같은 형태다. **`coverage.all`이 켜져 있어 이 파일이 없으면 포트들이 0%로 잡히고 application 임계값(90/85)을 실패시킨다.** 태스크 11·12·13·14가 포트를 더할 때마다 이 목록을 확장한다.

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering`
Expected: PASS

- [ ] **Step 8: 이 검사가 무엇을 잡는지 증명한다**

**(a) 값 객체 생성이 저장보다 먼저인가**
`addItem`에서 `Quantity.positive(command.quantity)`를 `transactions.run` 콜백 **안**으로 옮긴다.
Expected: FAIL — `'수량 0이면 장바구니를 만들지 않는다'`가 실패한다. `PassthroughTransactionManager`는 롤백하지 않으므로 실패한 요청이 빈 장바구니를 남긴다. **진짜 트랜잭션에서는 롤백되지만, 그 사실에 기대는 것은 트랜잭션 경계를 방어로 쓰는 것이고 in-memory 경로에서는 방어가 없다.**
되돌린다.

**(b) 장바구니 재사용이 실제로 있는가**
`addItem`의 `(await this.carts.findByCustomerId(customerId, tx)) ??`를 지우고 항상 `Cart.create`하게 만든다.
Expected: FAIL — `'두 번 담으면 장바구니가 하나만 만들어진다'`가 다른 `id`를 받아 실패한다. **이 회귀는 `carts.customer_id` 유니크에 걸려 두 번째 담기가 500으로 죽는다.**
되돌린다.

**(c) `save`가 통째로 갈아끼우는가 (in-memory)**
`InMemoryCartRepository.copy`가 `cart.lines` 대신 기존 저장본의 줄을 합치도록 바꾼다... 는 복잡하다. 대신 **계약의 `'줄을 빼면 저장본에서도 사라진다'`가 Prisma 어댑터에서 무엇을 잡는지는 태스크 15에서 확인한다.** 여기서는 in-memory `copy`의 `lines.map`을 지우고 빈 배열을 넣는 프루브를 돌린다.
Expected: FAIL — 계약의 여러 케이스가 줄을 잃고 실패한다.
되돌린다.

- [ ] **Step 9: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 장바구니 유스케이스와 리포지토리 계약을 추가한다"
```

---

### Task 11: Ordering 아웃바운드 포트 넷과 fake

**Files:**
- Create: `apps/api/src/modules/ordering/application/ports/out/{catalog-price.provider.ts, customer-address.provider.ts, inventory-reserver.ts, payment.gateway.ts, order.repository.ts}`
- Create: `apps/api/src/modules/ordering/testing/{fake-catalog-price.provider.ts, fake-customer-address.provider.ts, fake-inventory-reserver.ts, fake-payment-gateway.ts, in-memory-order.repository.ts, order-repository.contract.ts}` + `in-memory-order.repository.spec.ts`
- Modify: `apps/api/src/modules/ordering/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces:
  - `CatalogPriceProvider.findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]>` + `CATALOG_PRICE_PROVIDER`
  - `CustomerAddressProvider.findAddress(customerId, addressId): Promise<ShippingAddress | null>` + `CUSTOMER_ADDRESS_PROVIDER`
  - `InventoryReserver.reserve({ orderId, skuId, quantity }): Promise<ReserveOutcome>` / `.release({ reservationId }): Promise<void>` + `INVENTORY_RESERVER`
  - `ReserveOutcome = { ok: true; reservationId: string; expiresAt: Date } | { ok: false; reason: 'OUT_OF_STOCK' | 'SKU_UNKNOWN' }`
  - `PaymentGateway.authorize({ orderId, amount }): Promise<AuthorizeOutcome>` + `PAYMENT_GATEWAY`
  - `AuthorizeOutcome = { ok: true; paymentId: string; pgTxId: string } | { ok: false; reason: string }`
  - `OrderRepository` — `findById`, `listByCustomer`, `save` (조회 포트 `OrderQuery.listByCustomer`와 이름을 맞춘다 — 돌려주는 것은 다르지만(애그리거트 대 요약 뷰) 같은 질문에 답하므로 이름이 갈리면 호출부에서 헷갈린다)
  - fake 넷: `FakeCatalogPriceProvider`(가격표를 주입), `FakeCustomerAddressProvider`, `FakeInventoryReserver`(SKU별 결과와 호출 이력), `FakePaymentGateway`(`outcome` 가변 + 호출 이력)

**`InventoryReserver`가 예외 대신 결과 유니온을 돌려주는 이유.** 재고 부족은 **주문 실패의 정상적인 이유**이지 오류가 아니다. 그리고 `InsufficientStockError`는 inventory의 도메인 예외이고 `inventory/index.ts`가 내보내지 않으므로 ordering이 `instanceof`로 판별할 수도 없다 — 내보내게 하면 Core가 Supporting의 예외 타입에 묶인다. ACL 어댑터(태스크 16)가 inventory의 예외를 구조적으로(`code` 필드) 읽어 이 유니온으로 번역한다.

**`PaymentGateway`도 같은 이유로 유니온이다.** 사가의 4a/4b 갈림길(스펙 §6.2)이 이 반환값 하나로 결정되고, 예외로 만들면 `PlaceOrderService`가 정상 분기를 `catch`에서 처리하게 되어 진짜 오류와 구분이 사라진다.

- [ ] **Step 1: 네 포트를 정의한다**

```ts
// catalog-price.provider.ts
import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { PricedItem } from '../../../domain/priced-item';

/**
 * Catalog로 나가는 ACL. **`Product`를 받지 않고 값만 받는다**(스펙 §5.3).
 *
 * 없는 SKU는 **결과에서 빠진다** — 던지지 않는다. 호출자(`PlaceOrderService`)가
 * 요청한 SKU 수와 결과 수를 비교해 무엇이 빠졌는지 판단한다. 던지면 "어느 SKU가
 * 없는지"를 예외 메시지에서 파싱해야 한다.
 */
export interface CatalogPriceProvider {
  findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]>;
}

export const CATALOG_PRICE_PROVIDER = Symbol('CatalogPriceProvider');
```

```ts
// customer-address.provider.ts
import type { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { ShippingAddress } from '../../../domain/order/shipping-address';

/**
 * Customer로 나가는 ACL. `SavedAddress`(id를 가진 엔티티)를 `ShippingAddress`(id 없는
 * VO)로 바꾼다(스펙 §5.3).
 *
 * **`addressId`를 필수로 받는다.** "기본 배송지를 알아서 쓴다"로 만들면 고객이 어느
 * 주소로 배송되는지 모른 채 주문하게 되고, 테스트도 숨은 기본값에 의존하게 된다.
 * 고객이 주소록에서 고른 것을 명시적으로 넘긴다.
 *
 * 남의 주소를 넘기면 `null`이다 — `customerId`로 범위가 좁혀지므로 인가가 조회에
 * 내장된다.
 */
export interface CustomerAddressProvider {
  findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null>;
}

export const CUSTOMER_ADDRESS_PROVIDER = Symbol('CustomerAddressProvider');
```

```ts
// inventory-reserver.ts
import type { OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../../shared/kernel/quantity';

export type ReserveOutcome =
  | { readonly ok: true; readonly reservationId: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: 'OUT_OF_STOCK' | 'SKU_UNKNOWN' };

/**
 * Inventory로 나가는 ACL (스펙 §4.2의 호출 경로).
 *
 * 재고 부족이 예외가 아니라 결과인 이유: 주문 실패의 **정상적인 이유**이고,
 * `InsufficientStockError`는 inventory의 도메인 예외라 ordering이 `instanceof`로
 * 판별하려면 Core가 Supporting의 예외 타입에 묶여야 한다.
 *
 * `release`는 보상 경로에서 쓴다 — 여러 줄을 예약하다 중간에 실패하면 이미 잡은
 * 것들을 풀어야 한다(태스크 12). 실패해도 TTL이 결국 회수하므로 예외를 던져도
 * 사가가 멈추지 않게 호출자가 감싼다.
 */
export interface InventoryReserver {
  reserve(params: { orderId: OrderId; skuId: SkuId; quantity: Quantity }): Promise<ReserveOutcome>;
  release(params: { reservationId: string }): Promise<void>;
}

export const INVENTORY_RESERVER = Symbol('InventoryReserver');
```

```ts
// payment.gateway.ts
import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';

export type AuthorizeOutcome =
  | { readonly ok: true; readonly paymentId: string; readonly pgTxId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Payment로 나가는 ACL. **PG를 직접 부르지 않는다** — payment 모듈을 부른다(스펙 §7.4).
 *
 * 거절이 `ok: false`인 것이 사가의 갈림길이다(스펙 §6.2의 4a/4b). PG 타임아웃 같은
 * 진짜 오류는 그대로 던져 올라오고, 그때 사가는 결제 여부를 알 수 없으므로 예약을
 * 풀고 TTL에 맡긴다.
 */
export interface PaymentGateway {
  authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
```

```ts
// order.repository.ts
import type { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Order } from '../../../domain/order/order';

export interface OrderRepository {
  findById(id: OrderId, tx?: TransactionContext): Promise<Order | null>;
  /** 최신 주문부터. `orders_customer_placed_at_idx`가 이 정렬을 지원한다(태스크 2). */
  listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
    tx?: TransactionContext,
  ): Promise<Order[]>;
  save(order: Order, tx?: TransactionContext): Promise<void>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
```

- [ ] **Step 2: fake 넷을 쓴다**

**`vi.mock`을 쓰지 않는다** (스펙 §9.1). 손으로 쓴 fake는 호출 이력을 노출해 사가의 보상 순서를 검증할 수 있게 한다 — 목 라이브러리의 자동 스텁으로는 태스크 12의 "부분 예약 실패 시 이미 잡은 것들을 푼다"를 확인할 수 없다.

```ts
// fake-catalog-price.provider.ts
import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import type { CatalogPriceProvider } from '../application/ports/out/catalog-price.provider';
import type { PricedItem } from '../domain/priced-item';

export class FakeCatalogPriceProvider implements CatalogPriceProvider {
  private readonly catalog = new Map<string, { nameSnapshot: string; unitPrice: Money }>();
  readonly calls: Array<readonly SkuId[]> = [];

  put(skuId: SkuId, nameSnapshot: string, unitPrice: Money): this {
    this.catalog.set(skuId, { nameSnapshot, unitPrice });
    return this;
  }

  async findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]> {
    this.calls.push([...skuIds]);
    // 없는 SKU는 결과에서 빠진다 — 포트의 계약이다.
    return skuIds.flatMap((skuId) => {
      const entry = this.catalog.get(skuId);
      return entry === undefined ? [] : [{ skuId, ...entry }];
    });
  }
}
```

```ts
// fake-customer-address.provider.ts
import type { AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import type { CustomerAddressProvider } from '../application/ports/out/customer-address.provider';
import type { ShippingAddress } from '../domain/order/shipping-address';

export class FakeCustomerAddressProvider implements CustomerAddressProvider {
  private readonly byKey = new Map<string, ShippingAddress>();

  put(customerId: CustomerId, addressId: AddressId, address: ShippingAddress): this {
    this.byKey.set(`${customerId}:${addressId}`, address);
    return this;
  }

  async findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null> {
    return this.byKey.get(`${customerId}:${addressId}`) ?? null;
  }
}
```

```ts
// fake-inventory-reserver.ts
import type { OrderId, SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';
import type {
  InventoryReserver,
  ReserveOutcome,
} from '../application/ports/out/inventory-reserver';

/**
 * 예약 결과를 SKU별로 지정할 수 있고 **호출 이력을 남긴다.**
 *
 * 이력이 이 fake의 존재 이유다. 태스크 12의 "3번째 줄 예약이 실패하면 1·2번째를
 * 푼다"는 `released`를 보지 않고는 검증할 수 없고, 목 라이브러리의 자동 스텁으로는
 * 그 순서를 확인하기 어렵다(스펙 §9.1).
 */
export class FakeInventoryReserver implements InventoryReserver {
  readonly reserved: Array<{ orderId: string; skuId: string; quantity: number }> = [];
  readonly released: string[] = [];

  private readonly failures = new Map<string, 'OUT_OF_STOCK' | 'SKU_UNKNOWN'>();
  private releaseError: Error | null = null;
  private sequence = 0;

  failFor(skuId: SkuId, reason: 'OUT_OF_STOCK' | 'SKU_UNKNOWN' = 'OUT_OF_STOCK'): this {
    this.failures.set(skuId, reason);
    return this;
  }

  /** 보상 자체가 실패하는 경우를 만든다 — TTL이 마지막 그물임을 확인할 때 쓴다. */
  failReleaseWith(error: Error): this {
    this.releaseError = error;
    return this;
  }

  async reserve(params: {
    orderId: OrderId;
    skuId: SkuId;
    quantity: Quantity;
  }): Promise<ReserveOutcome> {
    const failure = this.failures.get(params.skuId);
    if (failure !== undefined) {
      return { ok: false, reason: failure };
    }
    this.sequence += 1;
    this.reserved.push({
      orderId: params.orderId,
      skuId: params.skuId,
      quantity: params.quantity.value,
    });
    return {
      ok: true,
      reservationId: `reservation-${this.sequence}`,
      expiresAt: new Date('2026-03-01T00:15:00.000Z'),
    };
  }

  async release(params: { reservationId: string }): Promise<void> {
    if (this.releaseError !== null) {
      throw this.releaseError;
    }
    this.released.push(params.reservationId);
  }
}
```

```ts
// fake-payment-gateway.ts
import type { OrderId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import type {
  AuthorizeOutcome,
  PaymentGateway,
} from '../application/ports/out/payment.gateway';

export class FakePaymentGateway implements PaymentGateway {
  readonly calls: Array<{ orderId: string; amount: string }> = [];

  private outcome: AuthorizeOutcome = { ok: true, paymentId: 'payment-1', pgTxId: 'pgtx-1' };
  private failure: Error | null = null;

  approve(): this {
    this.outcome = { ok: true, paymentId: 'payment-1', pgTxId: 'pgtx-1' };
    this.failure = null;
    return this;
  }

  decline(reason = '카드 한도를 초과했습니다.'): this {
    this.outcome = { ok: false, reason };
    this.failure = null;
    return this;
  }

  /** PG 타임아웃처럼 결과가 아니라 오류인 경우. 사가는 결제 여부를 알 수 없다. */
  throwWith(error: Error): this {
    this.failure = error;
    return this;
  }

  async authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome> {
    this.calls.push({ orderId: params.orderId, amount: params.amount.amount.toString() });
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.outcome;
  }
}
```

- [ ] **Step 3: `OrderRepository`의 in-memory 구현과 계약 스위트를 쓴다**

`order-repository.contract.ts`는 다음을 덮는다.

- 저장한 주문을 id로 찾고 총액·상태·라인·배송지가 그대로다
- 없는 id는 `null`
- 상태 변화가 저장된다 (`markPaid` 후 다시 읽으면 `PAID`)
- 라인이 순서대로 복원된다
- **돌려준 주문을 바꿔도 저장본은 바뀌지 않는다**
- `listByCustomer`가 **최신 주문부터** 돌려준다 (`placedAt` 내림차순)
- `listByCustomer`가 다른 고객의 주문을 섞지 않는다
- `limit`/`offset`이 동작한다
- 같은 주문을 두 번 저장해도 라인이 중복되지 않는다

`in-memory-order.repository.ts`는 `Map<string, Order>`에 담고 **저장·조회 시 `Order.rehydrate`로 복사한다.**

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) `listByCustomer`의 정렬이 실제로 있는가**
in-memory 구현의 정렬을 지운다.
Expected: FAIL — `'최신 주문부터 돌려준다'`가 실패한다. (삽입 순서와 `placedAt` 순서를 **다르게** 만든 픽스처여야 한다 — 같으면 정렬 없이도 통과한다. 계약 작성 시 세 주문을 `placedAt` 역순으로 저장한다.)
되돌린다.

**(b) fake가 이력을 실제로 남기는가**
`FakeInventoryReserver.release`의 `this.released.push(...)`를 지운다.
Expected: 지금은 아무 테스트도 실패하지 않는다. **그것이 정상이다** — 이 이력을 소비하는 것은 태스크 12다. 관측 결과를 보고서에 적고, 태스크 12의 프루브가 이 fake를 실제로 검증한다는 것을 기록한다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 아웃바운드 포트 넷과 손으로 쓴 fake를 추가한다"
```

---

### Task 12: `PlaceOrderService` — 사가 오케스트레이션

**이 계획에서 가장 중요한 태스크다.** 스펙 §6.2의 다섯 단계가 여기 구현된다.

**Files:**
- Create: `apps/api/src/modules/ordering/application/ports/in/place-order.usecase.ts`
- Create: `apps/api/src/modules/ordering/application/services/place-order.service.ts` + `place-order.service.spec.ts`
- Modify: `apps/api/src/modules/ordering/domain/order/order.errors.ts` (`UnknownSkuError`, `OutOfStockError`, `EmptyCartError` 추가)
- Modify: `apps/api/src/modules/ordering/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Consumes: `CartRepository`, `OrderRepository`, `CatalogPriceProvider`, `CustomerAddressProvider`, `InventoryReserver`, `PaymentGateway`, `TransactionManager`, `DomainEventPublisher`, `Clock`, `IdGenerator`
- Produces:
  - `PlaceOrderCommand { customerId: string; addressId: string }`
  - `PlaceOrderResult { orderId: string; status: OrderStatus }`
  - `PlaceOrderUseCase` + `PLACE_ORDER_USECASE`
  - `PlaceOrderService(carts, orders, catalog, addresses, inventory, payments, transactions, events, clock, ids)`
  - `EmptyCartError`(422) / `UnknownSkuError`(422) / `OutOfStockError`(409) / `ShippingAddressNotFoundError`(404)

**트랜잭션 경계 — 스펙 §6.2의 구조를 그대로 따른다**

```
[트랜잭션 1] 장바구니 읽기 → 가격·주소 스냅샷 → Order.place → 저장 + OrderPlaced 발행 → 장바구니 삭제
[트랜잭션 없음] 줄마다 재고 예약 (Inventory가 자기 트랜잭션을 연다)
[트랜잭션 없음] 결제 승인 (외부 PG)
[트랜잭션 3] markPaid 또는 failPayment → 저장 + 이벤트 발행
```

**왜 결제를 트랜잭션 안에 넣지 않는가**: 외부 HTTP 응답을 기다리며 DB 트랜잭션을 열어두면 커넥션 풀이 말라죽는다(스펙 §6.1). 재고 예약도 같은 이유로 밖이다 — Inventory가 자기 트랜잭션에서 `SELECT ... FOR UPDATE`로 행을 잠그는데, 그 잠금을 우리 트랜잭션이 감싸면 잠금 보유 시간이 결제 시간만큼 늘어난다.

**부분 예약 실패의 보상 — 이 태스크에서 가장 놓치기 쉬운 것**

주문은 여러 줄이고 예약은 SKU 단위다. 3줄 중 3번째 예약이 실패하면 **이미 잡은 1·2번째를 풀어야 한다.** 풀지 않으면 그 재고가 TTL(15분)까지 묶인다.

그리고 **보상 자체가 실패해도 사가는 멈추지 않는다.** `release`가 던지면 로그를 남기고 계속 진행해 주문을 `PAYMENT_FAILED`로 끝낸다 — 스펙 §6.2의 5단계가 "보상 트랜잭션 자체가 실패해도 TTL이 결국 재고를 회복시킨다"고 못박은 그 자리다. 보상 실패를 사용자에게 500으로 돌려주면, 주문은 실패했는데 클라이언트는 "서버 오류"만 보고 재시도해 예약을 또 쌓는다.

**장바구니를 언제 비우는가**: `Order.place`가 성공한 트랜잭션 1에서 지운다. 예약이나 결제가 실패해도 장바구니를 되살리지 않는다 — 주문은 이미 만들어졌고(`PAYMENT_FAILED`로 끝날 뿐) 같은 장바구니로 다시 주문하면 두 개의 주문이 생긴다. 사용자는 실패한 주문 화면에서 "다시 시도"를 누르고, 그것이 새 주문을 만든다.

- [ ] **Step 1: 에러를 더한다**

`order.errors.ts`에 추가한다.

```ts
/** 빈 장바구니로는 주문할 수 없다. */
export class EmptyCartError extends DomainError {
  static readonly CODE = 'EMPTY_CART';
  readonly code = EmptyCartError.CODE;

  constructor() {
    super('장바구니가 비어 있습니다.');
  }
}

/**
 * 장바구니에 있는 SKU를 Catalog가 모른다. 상품이 삭제되거나 비활성화된 경우다.
 *
 * 422인 이유: 사용자가 장바구니에서 그 줄을 빼면 해결된다. 어느 SKU인지 메시지에
 * 담아 클라이언트가 그 줄을 표시할 수 있게 한다.
 */
export class UnknownSkuError extends DomainError {
  static readonly CODE = 'UNKNOWN_SKU';
  readonly code = UnknownSkuError.CODE;

  constructor(skuIds: readonly string[]) {
    super(`판매 중이 아닌 상품이 있습니다: ${skuIds.join(', ')}`);
  }
}

/**
 * 재고가 모자라 예약에 실패했다.
 *
 * Inventory의 `InsufficientStockError`를 그대로 쓰지 않는다 — Core가 Supporting의
 * 예외 타입에 묶이면 Inventory를 별도 서비스로 떼어낼 때 그 타입이 프로세스 경계를
 * 넘어야 한다. ACL이 값만 번역해 이 예외로 바꾼다.
 */
export class OutOfStockError extends DomainError {
  static readonly CODE = 'OUT_OF_STOCK';
  readonly code = OutOfStockError.CODE;

  constructor(skuId: string) {
    super(`재고가 부족합니다: ${skuId}`);
  }
}

/** 주문에 지정한 배송지가 이 고객의 주소록에 없다. */
export class ShippingAddressNotFoundError extends DomainError {
  static readonly CODE = 'SHIPPING_ADDRESS_NOT_FOUND';
  readonly code = ShippingAddressNotFoundError.CODE;

  constructor(addressId: string) {
    super(`배송지를 찾을 수 없습니다: ${addressId}`);
  }
}
```

- [ ] **Step 2: 인바운드 포트를 정의한다**

```ts
import type { OrderStatus } from '../../../domain/order/order-status';

export interface PlaceOrderCommand {
  readonly customerId: string;
  /** 고객이 주소록에서 고른 배송지. 기본값에 의존하지 않는다 — 태스크 11의 포트 주석 참조. */
  readonly addressId: string;
}

export interface PlaceOrderResult {
  readonly orderId: string;
  /** `PAID` 또는 `PAYMENT_FAILED`. 예약이나 조립 단계에서 실패하면 예외가 나간다. */
  readonly status: OrderStatus;
}

export interface PlaceOrderUseCase {
  execute(command: PlaceOrderCommand): Promise<PlaceOrderResult>;
}

export const PLACE_ORDER_USECASE = Symbol('PlaceOrderUseCase');
```

**`PAYMENT_FAILED`가 예외가 아니라 결과인 이유**: 결제 거절은 주문이 정상적으로 끝난 상태다. 주문 번호가 있고, 사용자는 그 주문 화면에서 다시 시도할 수 있다. 예외로 만들면 주문 번호를 응답에 실을 수 없다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`place-order.service.spec.ts` — **분기를 전부 덮는다.** 스펙 §10.4가 이 파일을 "fake 포트로 전 분기 검증"이라고 적었다.

```ts
import { describe, expect, it } from 'vitest';
import { AddressId, CustomerId, OrderId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { ShippingAddress } from '../../domain/order/shipping-address';
import {
  ORDER_PAID,
  ORDER_PAYMENT_FAILED,
  ORDER_PLACED,
} from '../../domain/order/order.events';
import {
  EmptyCartError,
  OutOfStockError,
  ShippingAddressNotFoundError,
  UnknownSkuError,
} from '../../domain/order/order.errors';
import { FakeCatalogPriceProvider } from '../../testing/fake-catalog-price.provider';
import { FakeCustomerAddressProvider } from '../../testing/fake-customer-address.provider';
import { FakeInventoryReserver } from '../../testing/fake-inventory-reserver';
import { FakePaymentGateway } from '../../testing/fake-payment-gateway';
import { InMemoryCartRepository } from '../../testing/in-memory-cart.repository';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import {
  addressUuid,
  customerUuid,
  FIXED_NOW,
  skuUuid,
} from '../../testing/ordering.fixtures';
import { ManageCartService } from './manage-cart.service';
import { PlaceOrderService } from './place-order.service';

const CUSTOMER = customerUuid('1');
const ADDRESS = addressUuid('1');
const SKU_A = skuUuid('1');
const SKU_B = skuUuid('2');

const SHIPPING = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

async function build(lines: Array<[string, number]> = [[SKU_A, 3]]) {
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  const catalog = new FakeCatalogPriceProvider()
    .put(SkuId.of(SKU_A), '티셔츠 RED-M', Money.of(1200n))
    .put(SkuId.of(SKU_B), '모자 BLACK', Money.of(500n));
  const addresses = new FakeCustomerAddressProvider().put(
    CustomerId.of(CUSTOMER),
    AddressId.of(ADDRESS),
    SHIPPING,
  );
  const inventory = new FakeInventoryReserver();
  const payments = new FakePaymentGateway();
  const events = new RecordingEventPublisher();
  const transactions = new PassthroughTransactionManager();
  const ids = new SequentialIdGenerator();

  const cartService = new ManageCartService(carts, transactions, ids);
  for (const [skuId, quantity] of lines) {
    await cartService.addItem({ customerId: CUSTOMER, skuId, quantity });
  }

  const service = new PlaceOrderService(
    carts,
    orders,
    catalog,
    addresses,
    inventory,
    payments,
    transactions,
    events,
    new MutableClock(FIXED_NOW),
    ids,
  );
  return { service, carts, orders, catalog, addresses, inventory, payments, events };
}

const place = (service: PlaceOrderService) =>
  service.execute({ customerId: CUSTOMER, addressId: ADDRESS });

describe('PlaceOrderService — 성공 경로', () => {
  it('주문이 PAID로 끝난다', async () => {
    const { service } = await build();
    const result = await place(service);
    expect(result.status).toBe('PAID');
  });

  it('총액이 스냅샷 가격 × 수량의 합이다', async () => {
    // 1200×3 + 500×2 = 4600
    const { service, orders } = await build([[SKU_A, 3], [SKU_B, 2]]);
    const { orderId } = await place(service);

    const order = await orders.findById(OrderId.of(orderId));
    expect(order?.total.amount).toBe(4600n);
  });

  it('가격과 이름이 주문에 스냅샷으로 박힌다', async () => {
    // 스펙 §5.3. Catalog가 나중에 가격을 올려도 이 주문은 그대로다.
    const { service, orders } = await build();
    const { orderId } = await place(service);

    const order = await orders.findById(OrderId.of(orderId));
    expect(order?.lines[0]?.nameSnapshot).toBe('티셔츠 RED-M');
    expect(order?.lines[0]?.unitPrice.amount).toBe(1200n);
  });

  it('배송지가 스냅샷으로 박힌다', async () => {
    const { service, orders } = await build();
    const { orderId } = await place(service);

    expect((await orders.findById(OrderId.of(orderId)))?.shippingAddress.recipient).toBe('홍길동');
  });

  it('줄마다 재고를 예약한다', async () => {
    const { service, inventory } = await build([[SKU_A, 3], [SKU_B, 2]]);
    await place(service);

    expect(inventory.reserved.map((r) => [r.skuId, r.quantity])).toEqual([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);
  });

  it('주문 총액으로 결제를 요청한다', async () => {
    const { service, payments } = await build([[SKU_A, 3], [SKU_B, 2]]);
    await place(service);

    expect(payments.calls).toEqual([{ orderId: expect.any(String), amount: '4600' }]);
  });

  it('OrderPlaced와 OrderPaid를 순서대로 발행한다', async () => {
    const { service, events } = await build();
    await place(service);

    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_PLACED, ORDER_PAID]);
  });

  it('장바구니가 비워진다', async () => {
    const { service, carts } = await build();
    await place(service);

    expect(await carts.findByCustomerId(CustomerId.of(CUSTOMER))).toBeNull();
  });
});

describe('PlaceOrderService — 조립 단계 실패', () => {
  it('장바구니가 없으면 EmptyCartError다', async () => {
    const { service } = await build([]);
    await expect(place(service)).rejects.toThrow(EmptyCartError);
  });

  it('배송지가 없으면 ShippingAddressNotFoundError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({ customerId: CUSTOMER, addressId: addressUuid('9') }),
    ).rejects.toThrow(ShippingAddressNotFoundError);
  });

  it('Catalog가 모르는 SKU가 있으면 UnknownSkuError다', async () => {
    const { service } = await build([[skuUuid('7'), 1]]);
    await expect(place(service)).rejects.toThrow(UnknownSkuError);
  });

  it('조립에 실패하면 재고를 예약하지 않는다', async () => {
    // 예약은 주문이 만들어진 뒤에만 일어난다. 순서가 뒤바뀌면 실패한 주문이
    // 재고를 15분 묶는다.
    const { service, inventory } = await build([[skuUuid('7'), 1]]);
    await place(service).catch(() => undefined);

    expect(inventory.reserved).toHaveLength(0);
  });
});

describe('PlaceOrderService — 재고 예약 실패와 보상', () => {
  it('재고가 없으면 OutOfStockError다', async () => {
    const { service, inventory } = await build();
    inventory.failFor(SkuId.of(SKU_A));

    await expect(place(service)).rejects.toThrow(OutOfStockError);
  });

  it('여러 줄 중 뒤쪽이 실패하면 앞에서 잡은 예약을 전부 푼다', async () => {
    // 이 태스크에서 가장 놓치기 쉬운 것이다. 풀지 않으면 그 재고가 TTL까지 묶인다.
    const { service, inventory } = await build([[SKU_A, 1], [SKU_B, 1]]);
    inventory.failFor(SkuId.of(SKU_B));

    await place(service).catch(() => undefined);

    expect(inventory.reserved).toHaveLength(1);
    expect(inventory.released).toEqual(['reservation-1']);
  });

  it('예약이 실패하면 결제하지 않는다', async () => {
    const { service, inventory, payments } = await build();
    inventory.failFor(SkuId.of(SKU_A));

    await place(service).catch(() => undefined);

    expect(payments.calls).toHaveLength(0);
  });

  it('보상 자체가 실패해도 원래 예외가 나간다', async () => {
    // 스펙 §6.2의 5단계: 보상 트랜잭션이 실패해도 TTL이 결국 회수한다.
    // 여기서 보상 실패를 그대로 던지면 사용자는 "재고 부족" 대신 500을 본다.
    const { service, inventory } = await build([[SKU_A, 1], [SKU_B, 1]]);
    inventory.failFor(SkuId.of(SKU_B)).failReleaseWith(new Error('예약 해제 실패'));

    await expect(place(service)).rejects.toThrow(OutOfStockError);
  });
});

describe('PlaceOrderService — 결제 실패와 보상', () => {
  it('거절되면 주문이 PAYMENT_FAILED로 끝나고 예외를 던지지 않는다', async () => {
    // 결제 거절은 주문이 정상적으로 끝난 상태다. 주문 번호가 있고 사용자는
    // 그 화면에서 다시 시도할 수 있다.
    const { service, payments } = await build();
    payments.decline();

    const result = await place(service);

    expect(result.status).toBe('PAYMENT_FAILED');
  });

  it('거절되면 OrderPaymentFailed를 발행한다 — 예약 해제는 구독자가 한다', async () => {
    // 여기서 직접 release를 부르지 않는다. 이벤트가 outbox를 거쳐야 서버가
    // 죽어도 보상이 유실되지 않는다(스펙 §6.3).
    const { service, payments, events, inventory } = await build();
    payments.decline('카드 한도를 초과했습니다.');

    await place(service);

    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_PLACED, ORDER_PAYMENT_FAILED]);
    expect(events.published[1]?.payload).toMatchObject({ reason: '카드 한도를 초과했습니다.' });
    expect(inventory.released).toHaveLength(0);
  });

  it('PG가 던지면 예약을 풀고 예외를 올린다', async () => {
    // 타임아웃은 결과가 아니라 오류다. 결제 여부를 알 수 없으므로 이벤트로
    // "실패"를 선언할 수 없고(승인됐을 수도 있다), 예약만 풀고 TTL에 맡긴다.
    const { service, payments, inventory } = await build();
    payments.throwWith(new Error('PG 타임아웃'));

    await expect(place(service)).rejects.toThrow('PG 타임아웃');
    expect(inventory.released).toEqual(['reservation-1']);
  });

  it('PG가 던져도 주문은 PENDING_PAYMENT로 남는다', async () => {
    // 지워버리면 나중에 PG 정산에서 발견된 승인을 붙일 곳이 없어진다.
    const { service, payments, orders } = await build();
    payments.throwWith(new Error('PG 타임아웃'));
    await place(service).catch(() => undefined);

    const all = await orders.listByCustomer(CustomerId.of(CUSTOMER), { limit: 10, offset: 0 });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('PENDING_PAYMENT');
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/application`
Expected: FAIL — `place-order.service.ts`가 없다.

- [ ] **Step 5: `PlaceOrderService`를 구현한다**

```ts
import { Logger } from '@nestjs/common';
import { AddressId, CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Order } from '../../domain/order/order';
import { OrderLine } from '../../domain/order/order-line';
import {
  EmptyCartError,
  OutOfStockError,
  ShippingAddressNotFoundError,
  UnknownSkuError,
} from '../../domain/order/order.errors';
import type {
  PlaceOrderCommand,
  PlaceOrderResult,
  PlaceOrderUseCase,
} from '../ports/in/place-order.usecase';
import type { CartRepository } from '../ports/out/cart.repository';
import type { CatalogPriceProvider } from '../ports/out/catalog-price.provider';
import type { CustomerAddressProvider } from '../ports/out/customer-address.provider';
import type { InventoryReserver } from '../ports/out/inventory-reserver';
import type { OrderRepository } from '../ports/out/order.repository';
import type { PaymentGateway } from '../ports/out/payment.gateway';

/**
 * 주문 사가. 스펙 §6.2의 다섯 단계를 오케스트레이션한다.
 *
 * **Order의 상태 머신이 사가 상태를 겸한다** — 별도 사가 엔티티가 없다.
 *
 * 트랜잭션 경계:
 * - [트랜잭션 1] 조립 + 저장 + `OrderPlaced` + 장바구니 삭제
 * - [트랜잭션 없음] 줄마다 재고 예약 — Inventory가 자기 트랜잭션을 연다
 * - [트랜잭션 없음] 결제 승인 — 외부 PG
 * - [트랜잭션 3] `markPaid` 또는 `failPayment` + 이벤트 발행
 *
 * 예약과 결제를 트랜잭션 밖에 두는 이유: 외부 응답을 기다리며 DB 트랜잭션을 열어두면
 * 커넥션 풀이 말라죽는다(스펙 §6.1). 예약도 마찬가지다 — Inventory가 `FOR UPDATE`로
 * 잠근 행을 우리 트랜잭션이 감싸면 잠금 보유 시간이 결제 시간만큼 늘어난다.
 */
export class PlaceOrderService implements PlaceOrderUseCase {
  private readonly logger = new Logger(PlaceOrderService.name);

  constructor(
    private readonly carts: CartRepository,
    private readonly orders: OrderRepository,
    private readonly catalog: CatalogPriceProvider,
    private readonly addresses: CustomerAddressProvider,
    private readonly inventory: InventoryReserver,
    private readonly payments: PaymentGateway,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    const customerId = CustomerId.of(command.customerId);
    const addressId = AddressId.of(command.addressId);

    // [트랜잭션 1] 주문을 만든다. 여기까지 실패하면 아무 부수 효과도 남지 않는다.
    const order = await this.assemble(customerId, addressId);

    // [트랜잭션 없음] 줄마다 예약. 중간에 실패하면 이미 잡은 것을 푼다.
    const reservationIds = await this.reserveAll(order);

    // [트랜잭션 없음] 외부 PG.
    let outcome: Awaited<ReturnType<PaymentGateway['authorize']>>;
    try {
      outcome = await this.payments.authorize({ orderId: order.id, amount: order.total });
    } catch (error) {
      // 결과가 아니라 오류다. 승인됐는지 알 수 없으므로 "실패"를 이벤트로 선언할 수
      // 없다 — 주문은 PENDING_PAYMENT로 두고 예약만 풀어 TTL에 맡긴다.
      await this.releaseAll(reservationIds);
      throw error;
    }

    // [트랜잭션 3] 결과를 주문에 반영한다. 예약 확정·해제는 구독자가 이벤트를 받아
    // 처리한다 — 여기서 직접 부르면 서버가 죽을 때 보상이 유실된다(스펙 §6.3).
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      if (outcome.ok) {
        order.markPaid(now);
      } else {
        order.failPayment(outcome.reason, now);
      }
      await this.orders.save(order, tx);
      await this.events.publish(order.pullEvents(), tx);
      return { orderId: order.id, status: order.status };
    });
  }

  private async assemble(customerId: CustomerId, addressId: AddressId): Promise<Order> {
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const cart = await this.carts.findByCustomerId(customerId, tx);
      if (cart === null || cart.isEmpty) {
        throw new EmptyCartError();
      }

      const shippingAddress = await this.addresses.findAddress(customerId, addressId);
      if (shippingAddress === null) {
        throw new ShippingAddressNotFoundError(addressId);
      }

      const skuIds = cart.lines.map((line) => line.skuId);
      const priced = await this.catalog.findPrices(skuIds);
      const bySkuId = new Map(priced.map((item) => [item.skuId as string, item]));

      // 없는 SKU는 결과에서 빠진다 — 포트의 계약이다. 무엇이 빠졌는지 여기서 센다.
      const missing = skuIds.filter((skuId) => !bySkuId.has(skuId));
      if (missing.length > 0) {
        throw new UnknownSkuError(missing);
      }

      const lines = cart.lines.map((line) => {
        const item = bySkuId.get(line.skuId);
        if (item === undefined) {
          // 위에서 이미 걸렀다. 타입을 좁히기 위한 방어선이다.
          throw new UnknownSkuError([line.skuId]);
        }
        return OrderLine.of({
          skuId: line.skuId,
          nameSnapshot: item.nameSnapshot,
          unitPrice: item.unitPrice,
          quantity: line.quantity,
        });
      });

      const order = Order.place({
        id: OrderId.of(this.ids.nextId()),
        customerId,
        lines,
        shippingAddress,
        now,
      });
      await this.orders.save(order, tx);
      await this.events.publish(order.pullEvents(), tx);

      // 주문이 만들어졌으므로 장바구니를 비운다. 이후 단계가 실패해도 되살리지
      // 않는다 — 주문은 이미 존재하고, 같은 장바구니로 다시 주문하면 주문이 둘이 된다.
      await this.carts.delete(cart.id, tx);
      return order;
    });
  }

  /**
   * 줄마다 예약한다. **중간에 실패하면 이미 잡은 것을 전부 푼다.**
   *
   * 풀지 않으면 그 재고가 TTL(15분)까지 묶인다. 재고가 하나 부족했을 뿐인데 나머지
   * 상품까지 15분간 팔 수 없게 되는 것이다.
   */
  private async reserveAll(order: Order): Promise<string[]> {
    const acquired: string[] = [];

    for (const line of order.lines) {
      const outcome = await this.inventory.reserve({
        orderId: order.id,
        skuId: line.skuId,
        quantity: line.quantity,
      });
      if (outcome.ok) {
        acquired.push(outcome.reservationId);
        continue;
      }
      await this.releaseAll(acquired);
      if (outcome.reason === 'OUT_OF_STOCK') {
        throw new OutOfStockError(line.skuId);
      }
      // SKU_UNKNOWN: Catalog는 아는데 Inventory는 모르는 SKU다. 재고 등록이
      // 빠진 것이므로 사용자가 고칠 수 없다 — UnknownSkuError(422)로 말하면
      // "장바구니에서 빼라"는 잘못된 안내가 된다.
      throw new Error(`재고가 등록되지 않은 SKU입니다: ${line.skuId}`);
    }
    return acquired;
  }

  /**
   * 보상. **실패해도 던지지 않는다.**
   *
   * 스펙 §6.2의 5단계: 보상 트랜잭션 자체가 실패해도 TTL이 결국 재고를 회복시킨다.
   * 여기서 던지면 원래 실패 이유(재고 부족, PG 타임아웃)가 보상 실패에 가려지고
   * 사용자는 500만 본다.
   */
  private async releaseAll(reservationIds: readonly string[]): Promise<void> {
    for (const reservationId of reservationIds) {
      try {
        await this.inventory.release({ reservationId });
      } catch (error) {
        this.logger.error(
          `예약 해제 실패 (reservationId=${reservationId}): ${String(error)} — TTL 만료가 회수한다`,
        );
      }
    }
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering`
Expected: PASS (19개)

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다 — 이 계획에서 가장 중요한 프루브다**

**(a) 부분 예약 실패 보상이 실제로 있는가**
`reserveAll`의 `await this.releaseAll(acquired);`를 지운다.
Expected: FAIL — `'여러 줄 중 뒤쪽이 실패하면 앞에서 잡은 예약을 전부 푼다'`가 `released`를 빈 배열로 받아 실패한다. **이 회귀는 재고 하나가 부족할 때 나머지 상품을 15분간 판매 불가로 만든다.** 태스크 11의 프루브 (b)가 "지금은 아무것도 잡지 못한다"고 기록한 `released` 이력이 여기서 쓰인다.
되돌린다.

**(b) 보상 실패를 삼키는가**
`releaseAll`의 `try`/`catch`를 걷어낸다.
Expected: FAIL — `'보상 자체가 실패해도 원래 예외가 나간다'`가 `OutOfStockError` 대신 `'예약 해제 실패'`를 받아 실패한다. **사용자가 "재고 부족" 대신 500을 본다.**
되돌린다.

**(c) 예약이 주문 생성보다 뒤에 있는가**
`execute`에서 `reserveAll`을 `assemble`보다 **앞으로** 옮긴다... 는 불가능하다(`reserveAll`이 `order`를 받는다). 대신 `assemble`의 `UnknownSkuError` 검사를 지워 조립이 늦게 실패하도록 만든다.
Expected: FAIL — `'Catalog가 모르는 SKU가 있으면 UnknownSkuError다'`가 `OrderLine.of`의 평문 `Error`를 받아 실패하고, `'조립에 실패하면 재고를 예약하지 않는다'`는 여전히 통과한다. 두 결과를 모두 보고서에 적는다 — 후자가 통과하는 것은 **조립 전체가 예약보다 앞에 있다는 구조적 보장** 덕분이고, 그것이 이 순서의 값이다.
되돌린다.

**(d) 거절이 이벤트로 나가는가 (직접 해제가 아니라)**
`execute`의 `else` 분기에 `await this.releaseAll(reservationIds);`를 더한다.
Expected: FAIL — `'거절되면 OrderPaymentFailed를 발행한다 — 예약 해제는 구독자가 한다'`가 `released`에 1건을 받아 실패한다. **직접 해제하면 서버가 그 사이에 죽을 때 보상이 유실된다** — 이벤트를 outbox에 쓰는 이유가 그것이다(스펙 §6.3).
되돌린다.

**(e) PG 예외 경로가 예약을 푸는가**
`catch` 블록의 `await this.releaseAll(reservationIds);`를 지운다.
Expected: FAIL — `'PG가 던지면 예약을 풀고 예외를 올린다'`가 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `modules/ordering/application/**` 커버리지가 90/85를 넘는지 확인한다.

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 예약 기반 주문 사가를 구현한다"
```

---

### Task 13: `CancelOrderService`와 이벤트 핸들러 둘

**Files:**
- Create: `apps/api/src/modules/ordering/application/ports/in/{cancel-order.usecase.ts, handle-payment-refunded.usecase.ts, handle-stock-reservation-expired.usecase.ts}`
- Create: `apps/api/src/modules/ordering/application/services/cancel-order.service.ts` + spec
- Create: `apps/api/src/modules/ordering/application/services/handlers/{on-payment-refunded.service.ts, on-stock-reservation-expired.service.ts}` + 각각 spec
- Modify: `apps/api/src/modules/ordering/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces:
  - `CancelOrderUseCase.execute({ orderId, customerId }): Promise<{ status: OrderStatus }>` + `CANCEL_ORDER_USECASE`
  - `HandlePaymentRefundedUseCase.execute({ orderId }): Promise<boolean>` + `HANDLE_PAYMENT_REFUNDED_USECASE`
  - `HandleStockReservationExpiredUseCase.execute({ orderId }): Promise<boolean>` + `HANDLE_STOCK_RESERVATION_EXPIRED_USECASE`
  - `CancelOrderService(orders, transactions, events, clock)`
  - `OnPaymentRefundedService(orders, transactions, clock)` / `OnStockReservationExpiredService(orders, transactions, events, clock)`

**세 개가 한 태스크인 이유.** 셋 다 "주문을 찾고, 전이 메서드를 부르고, `false`면 아무것도 하지 않고, 저장하고 이벤트를 발행한다"는 같은 골격이며 같은 멱등성 규약을 공유한다. 리뷰어가 하나만 반려하고 나머지를 승인할 상황이 없다.

**`HandleStockReservationExpired`가 필요한 이유.** 스펙 §5.6의 마지막 줄이다 — `StockReservationExpired` → Ordering → 주문 실패 처리. 계획 3이 이 이벤트를 발행했지만 구독자가 없었다. TTL이 만료됐다는 것은 결제가 끝나지 않은 채 15분이 지났다는 뜻이므로 주문을 `PAYMENT_FAILED`로 끝낸다. **이미 `PAID`인 주문에 만료 이벤트가 오면 아무것도 하지 않는다** — 결제와 만료 스캔이 경합해 둘 다 이겼을 수 있고, 그때는 결제가 이긴 것이 정답이다(예약은 이미 확정됐다).

- [ ] **Step 1: 인바운드 포트를 정의한다**

```ts
// cancel-order.usecase.ts
import type { OrderStatus } from '../../../domain/order/order-status';

export interface CancelOrderCommand {
  readonly orderId: string;
  /** 본인 확인용. `Order.cancelBy`가 도메인에서 검사한다(스펙 §5.5). */
  readonly customerId: string;
}

export interface CancelOrderResult {
  /** 결제 전이면 `CANCELLED`, 결제 후면 `REFUND_PENDING`. */
  readonly status: OrderStatus;
}

export interface CancelOrderUseCase {
  execute(command: CancelOrderCommand): Promise<CancelOrderResult>;
}

export const CANCEL_ORDER_USECASE = Symbol('CancelOrderUseCase');
```

```ts
// handle-payment-refunded.usecase.ts
export interface HandlePaymentRefundedCommand {
  readonly orderId: string;
}

export interface HandlePaymentRefundedUseCase {
  /** 전이가 실제로 일어났으면 `true`. 이미 REFUNDED면 `false`. */
  execute(command: HandlePaymentRefundedCommand): Promise<boolean>;
}

export const HANDLE_PAYMENT_REFUNDED_USECASE = Symbol('HandlePaymentRefundedUseCase');
```

```ts
// handle-stock-reservation-expired.usecase.ts
export interface HandleStockReservationExpiredCommand {
  readonly orderId: string;
}

export interface HandleStockReservationExpiredUseCase {
  /** 주문을 실패 처리했으면 `true`. 이미 결말이 난 주문이면 `false`. */
  execute(command: HandleStockReservationExpiredCommand): Promise<boolean>;
}

export const HANDLE_STOCK_RESERVATION_EXPIRED_USECASE = Symbol(
  'HandleStockReservationExpiredUseCase',
);
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`cancel-order.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { Order } from '../../domain/order/order';
import { OrderLine } from '../../domain/order/order-line';
import { ORDER_CANCELLED } from '../../domain/order/order.events';
import { OrderNotFoundError, OrderNotOwnedError } from '../../domain/order/order.errors';
import { ShippingAddress } from '../../domain/order/shipping-address';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import { customerUuid, FIXED_NOW, orderUuid, skuUuid } from '../../testing/ordering.fixtures';
import { CancelOrderService } from './cancel-order.service';

const OWNER = customerUuid('1');
const STRANGER = customerUuid('2');
const ORDER = orderUuid('1');

const ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

async function build(paid: boolean) {
  const orders = new InMemoryOrderRepository();
  const order = Order.place({
    id: OrderId.of(ORDER),
    customerId: CustomerId.of(OWNER),
    lines: [
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.of(1000n),
        quantity: Quantity.positive(2),
      }),
    ],
    shippingAddress: ADDRESS,
    now: FIXED_NOW,
  });
  order.pullEvents();
  if (paid) {
    order.markPaid(FIXED_NOW);
    order.pullEvents();
  }
  await orders.save(order);

  const events = new RecordingEventPublisher();
  const service = new CancelOrderService(
    orders,
    new PassthroughTransactionManager(),
    events,
    new MutableClock(FIXED_NOW),
  );
  return { service, orders, events };
}

const cancel = (service: CancelOrderService, customerId = OWNER) =>
  service.execute({ orderId: ORDER, customerId });

describe('CancelOrderService', () => {
  it('결제 전 주문은 CANCELLED가 되고 wasPaid가 false다', async () => {
    const { service, events } = await build(false);

    const result = await cancel(service);

    expect(result.status).toBe('CANCELLED');
    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_CANCELLED]);
    expect(events.published[0]?.payload).toMatchObject({ wasPaid: false });
  });

  it('결제 후 주문은 REFUND_PENDING이 되고 wasPaid가 true다', async () => {
    // 편차 1. 환불이 끝날 때까지 PAID로 두면 고객에게 거짓말을 한다.
    const { service, events } = await build(true);

    const result = await cancel(service);

    expect(result.status).toBe('REFUND_PENDING');
    expect(events.published[0]?.payload).toMatchObject({ wasPaid: true });
  });

  it('두 번 취소하면 이벤트가 한 번만 나간다', async () => {
    // 여기서 막지 못하면 환불이 두 번 요청된다.
    const { service, events } = await build(true);
    await cancel(service);
    await cancel(service);

    expect(events.published).toHaveLength(1);
  });

  it('남의 주문은 OrderNotOwnedError다', async () => {
    const { service } = await build(true);
    await expect(cancel(service, STRANGER)).rejects.toThrow(OrderNotOwnedError);
  });

  it('남의 주문 취소는 이벤트를 남기지 않는다', async () => {
    const { service, events } = await build(true);
    await cancel(service, STRANGER).catch(() => undefined);
    expect(events.published).toHaveLength(0);
  });

  it('없는 주문은 OrderNotFoundError다', async () => {
    const { service } = await build(false);
    await expect(
      service.execute({ orderId: orderUuid('9'), customerId: OWNER }),
    ).rejects.toThrow(OrderNotFoundError);
  });
});
```

`on-payment-refunded.service.spec.ts` — `cancel-order.service.spec.ts`의 `ADDRESS` 상수와 같은 값을 쓴다.

```ts
import { describe, expect, it } from 'vitest';
import { CustomerId, OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../../shared/testing/passthrough-transaction-manager';
import { Order } from '../../../domain/order/order';
import { OrderLine } from '../../../domain/order/order-line';
import type { OrderStatus } from '../../../domain/order/order-status';
import { OrderConflictError, OrderNotFoundError } from '../../../domain/order/order.errors';
import { ShippingAddress } from '../../../domain/order/shipping-address';
import { InMemoryOrderRepository } from '../../../testing/in-memory-order.repository';
import { customerUuid, FIXED_NOW, orderUuid, skuUuid } from '../../../testing/ordering.fixtures';
import { OnPaymentRefundedService } from './on-payment-refunded.service';

const OWNER = customerUuid('1');
const ORDER = orderUuid('1');

const ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

/** 주문을 원하는 상태까지 몰고 간다. 전이는 애그리거트 메서드로만 한다. */
async function build(status: OrderStatus) {
  const orders = new InMemoryOrderRepository();
  const order = Order.place({
    id: OrderId.of(ORDER),
    customerId: CustomerId.of(OWNER),
    lines: [
      OrderLine.of({
        skuId: SkuId.of(skuUuid('1')),
        nameSnapshot: '티셔츠',
        unitPrice: Money.of(1000n),
        quantity: Quantity.positive(2),
      }),
    ],
    shippingAddress: ADDRESS,
    now: FIXED_NOW,
  });
  if (status !== 'PENDING_PAYMENT') {
    order.markPaid(FIXED_NOW);
  }
  if (status === 'REFUND_PENDING' || status === 'REFUNDED') {
    order.cancelBy(CustomerId.of(OWNER), FIXED_NOW);
  }
  if (status === 'REFUNDED') {
    order.markRefunded(FIXED_NOW);
  }
  order.pullEvents();
  await orders.save(order);

  const service = new OnPaymentRefundedService(
    orders,
    new PassthroughTransactionManager(),
    new MutableClock(FIXED_NOW),
  );
  return { service, orders };
}

describe('OnPaymentRefundedService', () => {
  it('REFUND_PENDING 주문을 REFUNDED로 만든다', async () => {
    const { service, orders } = await build('REFUND_PENDING');

    expect(await service.execute({ orderId: ORDER })).toBe(true);

    expect((await orders.findById(OrderId.of(ORDER)))?.status).toBe('REFUNDED');
  });

  it('두 번 오면 두 번째는 false다', async () => {
    // PaymentRefunded도 outbox를 거쳐 at-least-once로 배달된다(스펙 §6.3).
    const { service } = await build('REFUND_PENDING');
    await service.execute({ orderId: ORDER });

    expect(await service.execute({ orderId: ORDER })).toBe(false);
  });

  it('없는 주문이면 OrderNotFoundError다', async () => {
    // 조용히 넘기면 정합이 깨진 사실이 영영 드러나지 않는다. 던지면 릴레이가
    // 재시도하다 데드레터로 보내고 last_error가 사람이 찾을 단서를 남긴다.
    const { service } = await build('REFUND_PENDING');
    await expect(service.execute({ orderId: orderUuid('9') })).rejects.toThrow(OrderNotFoundError);
  });

  it('PAID 상태에 환불 완료가 오면 OrderConflictError다', async () => {
    // 취소 요청 없이 환불이 왔다는 것은 사가가 순서를 잃었다는 뜻이다.
    const { service } = await build('PAID');
    await expect(service.execute({ orderId: ORDER })).rejects.toThrow(OrderConflictError);
  });
});
```

`on-stock-reservation-expired.service.spec.ts`가 덮는 것:

- `PENDING_PAYMENT` 주문에 만료가 오면 `PAYMENT_FAILED`가 되고 `OrderPaymentFailed`를 발행한다 (`reason`에 "예약 만료"가 들어간다)
- **`PAID` 주문에 만료가 오면 `false`를 돌려주고 아무것도 바꾸지 않는다** — 결제와 만료 스캔이 경합해 둘 다 이겼을 때 결제가 이긴 것이 정답이다
- `PAYMENT_FAILED` 주문에 다시 오면 `false`다
- 없는 주문이면 `OrderNotFoundError`다

- [ ] **Step 3: 구현한다**

```ts
// cancel-order.service.ts
export class CancelOrderService implements CancelOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: CancelOrderCommand): Promise<CancelOrderResult> {
    const orderId = OrderId.of(command.orderId);
    const customerId = CustomerId.of(command.customerId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        throw new OrderNotFoundError(command.orderId);
      }
      // 소유자 검사는 도메인에 있다(스펙 §5.5). 여기서 하면 배치나 이벤트
      // 핸들러로 들어올 때 규칙이 사라진다.
      const changed = order.cancelBy(customerId, now);
      if (changed) {
        await this.orders.save(order, tx);
        await this.events.publish(order.pullEvents(), tx);
      }
      return { status: order.status };
    });
  }
}
```

```ts
// handlers/on-payment-refunded.service.ts
/**
 * `PaymentRefunded` 구독자(스펙 §5.6). 주문을 REFUNDED로 끝낸다.
 *
 * 이벤트를 발행하지 않는다 — `OrderRefunded`를 구독하는 곳이 없고, 구독자 없는
 * 이벤트는 outbox에 쌓이는 쓰레기다.
 */
export class OnPaymentRefundedService implements HandlePaymentRefundedUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(command: HandlePaymentRefundedCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        // 조용히 넘기면 정합이 깨진 사실이 영영 드러나지 않는다. 던지면 릴레이가
        // 재시도하다 데드레터로 보내고 `last_error`가 사람이 찾을 단서를 남긴다.
        throw new OrderNotFoundError(command.orderId);
      }
      const changed = order.markRefunded(now);
      if (changed) {
        await this.orders.save(order, tx);
      }
      return changed;
    });
  }
}
```

```ts
// handlers/on-stock-reservation-expired.service.ts
/** 만료로 인한 실패 사유. 사용자에게 그대로 보인다. */
const EXPIRY_REASON = '결제 시간이 초과되어 예약이 만료되었습니다.';

/**
 * `StockReservationExpired` 구독자(스펙 §5.6). 계획 3이 이 이벤트를 발행했지만
 * 구독자가 없었다 — 여기서 그 고리가 닫힌다.
 *
 * **`PAID` 주문에는 아무것도 하지 않는다.** 결제 성공과 만료 스캔이 경합해 둘 다
 * 이겼을 수 있고, 그때는 결제가 이긴 것이 정답이다 — 예약은 이미 확정됐고 재고도
 * 차감됐다. `failPayment`를 부르면 `OrderConflictError`가 나고 릴레이가 그 이벤트를
 * 영원히 재시도한다.
 */
export class OnStockReservationExpiredService implements HandleStockReservationExpiredUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: HandleStockReservationExpiredCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        throw new OrderNotFoundError(command.orderId);
      }
      if (order.status !== 'PENDING_PAYMENT') {
        // 이미 결말이 났다. PAID면 결제가 경합에서 이긴 것이고, 그 외면 이미
        // 실패·취소된 주문이다. 어느 쪽이든 만료가 할 일은 없다.
        return false;
      }
      const changed = order.failPayment(EXPIRY_REASON, now);
      if (changed) {
        await this.orders.save(order, tx);
        await this.events.publish(order.pullEvents(), tx);
      }
      return changed;
    });
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering/application`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 취소 이벤트가 멱등한가**
`CancelOrderService`의 `if (changed)` 조건을 지우고 항상 저장·발행하게 한다.
Expected: FAIL — `'두 번 취소하면 이벤트가 한 번만 나간다'`가 2건을 받아 실패한다. **`pullEvents()`가 두 번째에는 빈 배열이므로 `publish([])`가 되어 실제로는 이벤트가 늘지 않을 수도 있다** — 그 경우 관측 결과를 보고서에 적고, 멱등성의 진짜 보증이 `Order.cancelBy`의 `false` 반환에 있음을 기록한다.
되돌린다.

**(b) `PAID`에 만료가 와도 안전한가**
`OnStockReservationExpiredService`의 `if (order.status !== 'PENDING_PAYMENT') return false;`를 지운다.
Expected: FAIL — `'PAID 주문에 만료가 오면 false를 돌려주고 아무것도 바꾸지 않는다'`가 `OrderConflictError`를 받아 실패한다. **이 회귀는 결제 성공한 주문의 만료 이벤트를 릴레이가 영원히 재시도하게 만든다** — 데드레터에 도달할 때까지 outbox의 head-of-line을 차지한다.
되돌린다.

**(c) 소유자 검사가 도메인에 있는가**
`CancelOrderService`에 `order.assertOwnedBy(customerId)`를 추가하고 `cancelBy`에서 소유자 검사를 지운다.
Expected: **모든 테스트가 통과한다.** 그것이 요점이다 — 단위 테스트로는 인가가 어느 계층에 있는지 구분할 수 없다. 스펙 §5.5가 도메인을 고른 이유는 테스트가 아니라 **HTTP가 아닌 경로**(배치, 이벤트 핸들러, 관리자 CLI) 때문이고, 그런 경로는 아직 존재하지 않는다. 관측 결과를 보고서에 적고 되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 주문 취소와 환불·만료 이벤트 핸들러를 추가한다"
```

---

### Task 14: Ordering 조회 — 장바구니·주문 상세·내 주문 목록

**Files:**
- Create: `apps/api/src/modules/ordering/application/ports/in/queries/{get-cart,get-order,list-my-orders}.query.ts`
- Create: `apps/api/src/modules/ordering/application/ports/out/order.query.ts`
- Create: `apps/api/src/modules/ordering/application/services/{get-cart,get-order,list-my-orders}.service.ts` + 각각 spec
- Create: `apps/api/src/modules/ordering/testing/in-memory-order.query.ts`
- Modify: `apps/api/src/modules/ordering/application/ports/port-tokens.spec.ts`

**Interfaces:**
- Produces:
  - `CartView { cartId: string | null; lines: CartLineView[]; total: MoneyView; unavailableSkuIds: string[] }`, `CartLineView { skuId; nameSnapshot; unitPrice: MoneyView; quantity; subtotal: MoneyView }`
  - `OrderView { id; status; total: MoneyView; placedAt: string; shippingAddress: ShippingAddressView; lines: OrderLineView[] }`
  - `OrderSummaryView { id; status; total: MoneyView; placedAt: string; lineCount: number }`
  - `MoneyView { amount: string; currency: string }`
  - `GetCartQuery.execute({ customerId })` / `GetOrderQuery.execute({ orderId, customerId })` / `ListMyOrdersQuery.execute({ customerId, limit, offset })` + 토큰 셋
  - `OrderQuery` (아웃바운드) — `findById(orderId)`, `listByCustomer(customerId, { limit, offset })`

**세 조회의 경로가 서로 다르다 — 그 차이가 이 태스크의 내용이다.**

| 조회 | 경로 | 이유 |
|---|---|---|
| `GetCart` | `CartRepository` + `CatalogPriceProvider` | 장바구니에는 가격이 없다. **현재 가격**을 Catalog에서 가져와 보여준다 — 주문 시점의 스냅샷과 다를 수 있고, 그것이 정상이다 |
| `GetOrder` | `OrderQuery` (읽기 전용 포트) | 주문은 스냅샷을 갖고 있어 다른 컨텍스트를 부를 필요가 없다. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다(스펙 §7.2) |
| `ListMyOrders` | `OrderQuery` | 같은 이유. 목록에 라인 전체를 실으면 20건 조회에 200줄이 딸려온다 — `lineCount`만 준다 |

**`GetOrder`가 인가를 어디서 하는가.** `OrderQuery`는 DTO를 돌려주므로 `Order.assertOwnedBy`를 부를 수 없다. `OrderQuery.findById`가 `customerId`를 함께 돌려주고 서비스가 비교해 `OrderNotOwnedError`를 던진다. **도메인 규칙이 애플리케이션으로 새는 것처럼 보이지만 그렇지 않다** — 스펙 §5.5가 도메인에 두라고 한 것은 "본인 주문만 **취소** 가능"이고, 그것은 `Order.cancelBy`에 있다. 조회 인가는 상태를 바꾸지 않으므로 불변식이 아니다.

**`GetCart`가 없는 SKU를 만나면**: 그 줄을 결과에서 빼고 `unavailableSkuIds`에 담아 돌려준다. 던지면 상품 하나가 판매 중지됐다는 이유로 장바구니 화면 전체가 열리지 않는다.

- [ ] **Step 1: 읽기 모델과 포트를 정의한다**

`order.query.ts`(아웃바운드)는 `OrderView`/`OrderSummaryView`와 함께 다음을 갖는다. **`customerId`가 뷰에 있는 것이 인가의 근거다.**

```ts
export interface OrderView {
  readonly id: string;
  /** 인가 비교용. 컨트롤러가 DTO로 옮길 때 뺀다. */
  readonly customerId: string;
  readonly status: string;
  readonly total: MoneyView;
  readonly placedAt: string;
  readonly shippingAddress: ShippingAddressView;
  readonly lines: OrderLineView[];
}
```

`@commerce/contracts`의 DTO를 쓰지 않는다 — 애플리케이션 계층이 와이어 계약에 묶이지 않기 위해서다(계획 2·3의 `AddressView`·`ProductView`와 같은 판단). 컨트롤러가 옮긴다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`get-cart.service.spec.ts`가 덮는 것:

- 장바구니가 없으면 빈 뷰를 돌려준다(`cartId: null`, `lines: []`, `total: 0`) — 404가 아니다. 처음 방문한 고객의 장바구니는 "없는 것"이 아니라 "빈 것"이다
- 줄마다 현재 가격과 소계가 붙는다
- 총액이 소계의 합이다
- **Catalog가 모르는 SKU는 `unavailableSkuIds`에 담기고 `lines`에서 빠지며, 총액에 포함되지 않는다**
- 통화가 섞이면? — Catalog가 단일 통화를 보장하지 않으므로 `Money.sum`이 던진다. **이 경우를 테스트로 고정한다**: `CurrencyMismatchError`가 나가고 500이 된다. 장바구니 화면에서 그것이 나는 것은 카탈로그 데이터가 잘못됐다는 뜻이고, 사용자가 고칠 수 없다

`get-order.service.spec.ts`가 덮는 것:

- 본인 주문을 돌려준다
- 남의 주문은 `OrderNotOwnedError`(403)
- 없는 주문은 `OrderNotFoundError`(404)
- **남의 주문과 없는 주문이 다른 예외다** — 같게 만들면 존재 여부가 새지 않지만, 이 프로젝트는 주문 ID가 UUID v7이라 추측이 사실상 불가능하므로 진단 가능성을 택한다. 이 판단을 서비스 doc 주석에 적는다

`list-my-orders.service.spec.ts`가 덮는 것:

- 최신 주문부터 돌려준다
- 다른 고객의 주문이 섞이지 않는다
- `limit`/`offset`이 동작한다
- `lineCount`가 라인 수다
- `limit` 상한이 있다 — 100을 넘기면 100으로 자른다(계획 3의 `searchProductsQuerySchema`가 같은 상한을 둔다)

`in-memory-order.query.ts`는 `InMemoryOrderRepository`가 들고 있는 `Order`를 뷰로 변환해 돌려준다. **두 fake가 같은 저장소를 공유하도록 생성자에서 리포지토리를 받는다** — 따로 두면 테스트가 같은 데이터를 두 번 준비해야 하고 그 둘이 어긋나기 시작한다.

- [ ] **Step 3: 구현한다**

`GetCartService`의 핵심:

```ts
  async execute(command: { customerId: string }): Promise<CartView> {
    const customerId = CustomerId.of(command.customerId);
    const cart = await this.carts.findByCustomerId(customerId);
    if (cart === null || cart.isEmpty) {
      // 처음 방문한 고객의 장바구니는 "없는 것"이 아니라 "빈 것"이다. 404를 내면
      // 클라이언트가 빈 장바구니 화면을 그리지 못한다.
      return { cartId: cart?.id ?? null, lines: [], total: ZERO_VIEW, unavailableSkuIds: [] };
    }

    const priced = await this.catalog.findPrices(cart.lines.map((line) => line.skuId));
    const bySkuId = new Map(priced.map((item) => [item.skuId as string, item]));

    const available = cart.lines.flatMap((line) => {
      const item = bySkuId.get(line.skuId);
      return item === undefined ? [] : [{ line, item }];
    });
    // 판매 중지된 상품 하나 때문에 장바구니 화면 전체가 열리지 않으면 안 된다.
    const unavailableSkuIds = cart.lines
      .filter((line) => !bySkuId.has(line.skuId))
      .map((line) => line.skuId as string);

    const subtotals = available.map(({ line, item }) => item.unitPrice.multiply(line.quantity));
    return {
      cartId: cart.id,
      lines: available.map(({ line, item }, index) => ({
        skuId: line.skuId,
        nameSnapshot: item.nameSnapshot,
        unitPrice: item.unitPrice.toDto(),
        quantity: line.quantity.value,
        subtotal: (subtotals[index] as Money).toDto(),
      })),
      total: Money.sum(subtotals).toDto(),
      unavailableSkuIds,
    };
  }
```

`ZERO_VIEW`는 파일 상단의 `const ZERO_VIEW = Money.zero().toDto();`다.

`GetOrderService`:

```ts
  /**
   * 조회 인가를 서비스가 한다. `OrderQuery`는 DTO를 돌려주므로 `Order.assertOwnedBy`를
   * 부를 수 없다. **도메인 규칙이 새는 것이 아니다** — 스펙 §5.5가 도메인에 두라고
   * 한 것은 "본인 주문만 **취소** 가능"이고 그것은 `Order.cancelBy`에 있다. 조회는
   * 상태를 바꾸지 않으므로 불변식이 아니다.
   *
   * 없는 주문(404)과 남의 주문(403)을 다른 예외로 구분한다. 같게 만들면 존재 여부가
   * 새지 않지만, 주문 ID가 UUID v7이라 추측이 사실상 불가능하므로 진단 가능성을 택한다.
   */
  async execute(command: { orderId: string; customerId: string }): Promise<OrderView> {
    const view = await this.orders.findById(OrderId.of(command.orderId));
    if (view === null) {
      throw new OrderNotFoundError(command.orderId);
    }
    if (view.customerId !== command.customerId) {
      throw new OrderNotOwnedError(command.orderId);
    }
    return view;
  }
```

`ListMyOrdersService`는 `limit`을 `Math.min(command.limit, 100)`으로 자르고 `OrderQuery.listByCustomer`에 넘긴다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run apps/api/src/modules/ordering`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 조회 인가가 실제로 있는가**
`GetOrderService`의 `if (view.customerId !== command.customerId)` 검사를 지운다.
Expected: FAIL — `'남의 주문은 OrderNotOwnedError다'`가 뷰를 받아 실패한다. **이 회귀는 주문 ID만 알면 남의 배송지와 구매 내역이 보이는 결함이다.**
되돌린다.

**(b) 판매 중지 상품이 화면을 막지 않는가**
`GetCartService`의 `flatMap` 필터를 지우고 `bySkuId.get(...)!`로 바꾼다.
Expected: FAIL — `'Catalog가 모르는 SKU는 unavailableSkuIds에 담긴다'`가 예외로 실패한다.
되돌린다.

**(c) `limit` 상한이 있는가**
`ListMyOrdersService`의 `Math.min(..., 100)`을 지운다.
Expected: FAIL — `'limit 상한이 있다'`가 실패한다. 상한이 없으면 한 요청이 고객의 전체 주문 이력을 훑는다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): 장바구니·주문 조회 유스케이스를 추가한다"
```

---

### Task 15: Ordering 영속 어댑터 — 장바구니·주문·주문 조회

**Files:**
- Create: `apps/api/src/modules/ordering/adapters/out/persistence/{cart.mapper.ts, order.mapper.ts, prisma-cart.repository.ts, prisma-order.repository.ts, prisma-order.query.ts}`
- Create: `apps/api/src/modules/ordering/adapters/out/persistence/{prisma-cart.repository.integration.spec.ts, prisma-order.repository.integration.spec.ts, prisma-order.query.integration.spec.ts}`

**Interfaces:**
- Consumes: `cartRepositoryContract`, `orderRepositoryContract`, `Cart`, `Order`, `OrderLine`, `ShippingAddress`
- Produces: `PrismaCartRepository(prisma)`, `PrismaOrderRepository(prisma)`, `PrismaOrderQuery(prisma)`

**매퍼는 `fromPersistence`를 쓴다.** `SkuId.fromPersistence`, `OrderId.fromPersistence`, `CustomerId.fromPersistence`, `OrderLine.fromPersistence`, `ShippingAddress.fromPersistence`. `.of`를 쓰면 깨진 행에 400이 나가 클라이언트에게 거짓말을 한다(계획 1의 M7, 계획 2 최종 리뷰가 잡은 결함).

**`Quantity.of`를 쓴다, `positive`가 아니라.** 저장된 수량이 0이면 그것은 데이터 손상이고 `of`가 던지는 `InvalidQuantityError`는 평문 `Error`(500)다. `positive`를 쓰면 `QuantityBelowMinimumError`(`DomainError`, 422)가 나가 손상된 행을 사용자 잘못으로 만든다. 계획 3의 `reservation.mapper.ts`가 같은 판단을 문서화했다.

- [ ] **Step 1: 매퍼를 쓴다**

`cart.mapper.ts`는 `{ id, customerId, lines: [{ skuId, quantity }] }` 행을 `Cart.rehydrate`로 바꾼다.

`order.mapper.ts`:

```ts
export interface OrderLineRow {
  skuId: string;
  nameSnapshot: string;
  unitPriceAmount: bigint;
  unitPriceCurrency: string;
  quantity: number;
}

export interface OrderRow {
  id: string;
  customerId: string;
  status: string;
  totalAmount: bigint;
  totalCurrency: string;
  shipRecipient: string;
  shipPhone: string;
  shipZip: string;
  shipLine1: string;
  shipLine2: string | null;
  placedAt: Date;
  lines: OrderLineRow[];
}

export function toOrderDomain(row: OrderRow): Order {
  return Order.rehydrate({
    id: OrderId.fromPersistence(row.id),
    customerId: CustomerId.fromPersistence(row.customerId),
    status: row.status,
    lines: row.lines.map((line) => toOrderLineDomain(line, row.id)),
    shippingAddress: ShippingAddress.fromPersistence({
      recipient: row.shipRecipient,
      phone: row.shipPhone,
      zip: row.shipZip,
      line1: row.shipLine1,
      line2: row.shipLine2,
    }),
    total: Money.of(row.totalAmount, asCurrency(row.totalCurrency, row.id)),
    placedAt: row.placedAt,
  });
}

function toOrderLineDomain(row: OrderLineRow, orderId: string): OrderLine {
  return OrderLine.fromPersistence({
    skuId: SkuId.fromPersistence(row.skuId),
    nameSnapshot: row.nameSnapshot,
    unitPrice: Money.of(row.unitPriceAmount, asCurrency(row.unitPriceCurrency, orderId)),
    // `positive`가 아니라 `of`다. 저장된 0은 사용자 잘못이 아니라 데이터 손상이고,
    // `positive`의 QuantityBelowMinimumError(422)는 그것을 사용자 잘못으로 만든다.
    quantity: Quantity.of(row.quantity),
  });
}

function asCurrency(value: string, orderId: string): Currency {
  if (value !== 'KRW' && value !== 'USD') {
    throw new CorruptedOrderError(orderId, `알 수 없는 통화 "${value}"`);
  }
  return value;
}
```

- [ ] **Step 2: 리포지토리 둘을 쓴다**

**`save`는 라인을 통째로 갈아끼운다** — 장바구니와 주문 모두. `deleteMany` + `createMany`를 한 트랜잭션 안에서 한다.

```ts
// prisma-cart.repository.ts의 save
  async save(cart: Cart, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    await client.cart.upsert({
      where: { id: cart.id },
      create: { id: cart.id, customerId: cart.customerId, createdAt: new Date(), updatedAt: new Date() },
      update: { updatedAt: new Date() },
    });
    // 통째로 갈아끼운다. append-only면 줄을 뺀 것이 저장본에 반영되지 않는다 —
    // 계약의 '줄을 빼면 저장본에서도 사라진다'가 그것을 잡는다.
    await client.cartLine.deleteMany({ where: { cartId: cart.id } });
    if (cart.lines.length > 0) {
      await client.cartLine.createMany({
        data: cart.lines.map((line) => ({
          cartId: cart.id,
          skuId: line.skuId,
          quantity: line.quantity.value,
        })),
      });
    }
  }
```

**주문의 라인은 불변이므로 갈아끼울 필요가 없지만 같은 형태로 쓴다.** 주문 라인은 `place` 이후 바뀌지 않으므로 `createMany` + `skipDuplicates`로도 충분하다. 그런데 `deleteMany` + `createMany`를 쓰는 이유: 라인이 불변이라는 것은 **지금의 도메인 규칙**이고, 나중에 주문 수정이 생기면 append-only 저장은 조용히 틀린 결과를 낸다. 두 리포지토리가 같은 형태를 쓰면 그 규칙 변화가 저장 코드를 건드리지 않는다.

`delete`는 `deleteMany({ where: { id: cartId } })`를 쓴다 — `delete`는 없는 행에 P2025를 던지고, 계약의 `'없는 장바구니를 지워도 던지지 않는다'`가 그것을 막는다.

- [ ] **Step 3: `PrismaOrderQuery`를 쓴다**

**애그리거트를 만들지 않는다** (스펙 §7.2). Prisma가 직접 projection해 뷰를 만든다.

```ts
  async listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
  ): Promise<OrderSummaryView[]> {
    const rows = await this.prisma.order.findMany({
      where: { customerId },
      // orders_customer_placed_at_idx가 이 정렬을 지원한다(태스크 2).
      orderBy: { placedAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      // 목록에 라인 전체를 실으면 20건 조회에 200줄이 딸려온다. 개수만 센다.
      select: {
        id: true,
        status: true,
        totalAmount: true,
        totalCurrency: true,
        placedAt: true,
        _count: { select: { lines: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      total: { amount: row.totalAmount.toString(), currency: row.totalCurrency },
      placedAt: row.placedAt.toISOString(),
      lineCount: row._count.lines,
    }));
  }
```

- [ ] **Step 4: 계약 스위트를 두 어댑터에 돌리고 어댑터 전용 테스트를 더한다**

```ts
cartRepositoryContract('prisma', async () => new PrismaCartRepository(await testDb()));
orderRepositoryContract('prisma', async () => new PrismaOrderRepository(await testDb()));
```

어댑터 전용으로 확인할 것 — 계약이 볼 수 없는 것만.

- 알 수 없는 `status`가 저장된 주문 행을 읽으면 `CorruptedOrderError`
- 알 수 없는 통화가 저장된 행을 읽으면 `CorruptedOrderError`
- **저장된 `total_amount`가 라인 합과 다르면 `CorruptedOrderError`** — 원시 SQL로 어긋난 행을 만들어 확인한다. 스펙 §5.1의 불변식이 읽기 경로에서도 지켜지는지를 보는 유일한 테스트다
- `cart_lines`에 같은 `(cart_id, sku_id)`를 두 번 넣으면 유니크 위반 (원시 SQL)
- `PrismaOrderQuery.listByCustomer`가 `placedAt` 내림차순이고 `lineCount`가 맞다

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) `save`가 통째로 갈아끼우는가**
`prisma-cart.repository.ts`의 `deleteMany`를 지운다.
Expected: FAIL — 계약의 `'줄을 빼면 저장본에서도 사라진다'`가 실패하고, `'수량 변경이 저장된다'`는 `createMany`의 P2002로 실패한다. **in-memory 구현은 통과한다** — 그 비대칭이 계약을 두 구현에 돌리는 이유다. 관측 결과를 보고서에 적는다.
되돌린다.

**(b) 매퍼가 `fromPersistence`를 쓰는가**
`order.mapper.ts`의 `OrderLine.fromPersistence`를 `OrderLine.of`로 바꾸고, 원시 SQL로 `name_snapshot`이 빈 문자열인 라인을 만들어 읽는다.
Expected: **두 경우 모두 평문 `Error`가 난다.** `OrderLine.of`도 `fromPersistence`도 `DomainError`가 아니기 때문이다(태스크 8의 판단). 관측 결과를 보고서에 적고, **이 자리에서는 두 팩토리의 차이가 관측되지 않는다**는 사실을 기록한다. 차이가 나는 것은 `ShippingAddress`이므로 그쪽으로 프루브를 옮긴다: `ShippingAddress.fromPersistence`를 `.of`로 바꾸고 `ship_recipient`가 빈 행을 읽으면 `InvalidShippingAddressError`(400)가 난다 — 그것이 M7이 막으려는 거짓말이다.
되돌린다.

**(c) `delete`가 없는 행에 던지지 않는가**
`deleteMany`를 `delete`로 바꾼다.
Expected: FAIL — 계약의 `'없는 장바구니를 지워도 던지지 않는다'`가 P2025로 실패한다. **이 회귀는 주문이 두 번 처리될 때(at-least-once) 두 번째를 500으로 만든다.**
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/ordering
git commit -m "feat(ordering): Prisma 장바구니·주문 리포지토리와 조회 어댑터를 추가한다"
```

---

### Task 16: ACL 어댑터 넷과 catalog·customer 공개 API 확장

**Files:**
- Create: `apps/api/src/modules/catalog/application/ports/in/queries/find-sku-prices.query.ts`
- Create: `apps/api/src/modules/catalog/application/services/find-sku-prices.service.ts` + spec
- Modify: `apps/api/src/modules/catalog/application/ports/out/product.query.ts` (`findSkus` 추가), `prisma-product.query.ts`, `in-memory-product.query.ts`, `catalog.module.ts`, `catalog/index.ts`, `port-tokens.spec.ts`
- Modify: `apps/api/src/modules/customer/{index.ts, customer.module.ts}`
- Create: `apps/api/src/modules/ordering/adapters/out/{catalog/in-process-catalog.adapter.ts, customer/in-process-customer.adapter.ts, inventory/in-process-inventory.adapter.ts, payment/in-process-payment.adapter.ts}` + 각각 spec

**Interfaces:**
- Produces:
  - catalog: `SkuPriceView { skuId; productName; skuCode; amount; currency }`, `FindSkuPricesQuery.execute(skuIds: readonly string[]): Promise<SkuPriceView[]>` + `FIND_SKU_PRICES_QUERY`
  - customer: `GET_ADDRESS_BOOK_QUERY`와 `AddressView`를 `index.ts`에서 내보내고 `customer.module.ts`의 `exports`에 추가
  - ordering: `InProcessCatalogAdapter`, `InProcessCustomerAdapter`, `InProcessInventoryAdapter`, `InProcessPaymentAdapter`

**스펙 §4.2가 이 태스크의 근거다.** "같은 프로세스 안에서 두 겹 감싸는 것은 약간 과하다. 유지하는 이유는 이 5줄이 Inventory를 별도 서비스로 떼어낼 때 고칠 유일한 파일이기 때문이다." 스펙 §13의 성공 기준에도 "`InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음"이 있다.

**`nameSnapshot`을 어떻게 만드는가.** `${productName} ${skuCode}` — 예: "티셔츠 RED-M". 상품 이름만으로는 고객이 어떤 변형을 샀는지 알 수 없고, SKU 코드만으로는 무엇인지 알 수 없다. 주문 내역은 몇 달 뒤에 읽히므로 둘 다 필요하다.

**`customer`에 새 유스케이스를 만들지 않는 이유.** `GetAddressBookQuery`가 이미 고객의 주소를 전부 돌려주고 기본 배송지가 맨 앞에 온다. 주소록은 작으므로(고객당 수 개) ACL이 목록을 받아 메모리에서 id로 고른다. 전용 조회 포트를 만들면 호출자가 하나뿐이고 테스트에서 바꿔치기할 이유도 없는 포트가 생긴다 — 스펙 §7.7의 기준("테스트에서 바꿔치기해야 하는가, 혹은 나중에 교체될 수 있는가. 둘 다 아니면 포트가 아니다")에 걸린다.

- [ ] **Step 1: catalog에 SKU 가격 조회를 더한다**

`ProductQuery`(아웃바운드)에 메서드를 추가한다.

```ts
export interface SkuPriceView {
  readonly skuId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly amount: string;
  readonly currency: string;
}

export interface ProductQuery {
  findById(productId: ProductId): Promise<ProductView | null>;
  search(criteria: SearchCriteria): Promise<ProductView[]>;
  /**
   * ACTIVE 상품의 SKU만 돌려준다. **없는 SKU는 결과에서 빠진다** — 던지지 않는다.
   * Ordering의 `CatalogPriceProvider` 포트가 같은 계약을 갖는다.
   */
  findSkus(skuIds: readonly string[]): Promise<SkuPriceView[]>;
}
```

`PrismaProductQuery.findSkus`는 `sku.findMany({ where: { id: { in: skuIds }, product: { status: 'ACTIVE' } }, include: { product: { select: { name: true } } } })`로 한 번에 읽는다. **N+1을 만들지 않는다** — 장바구니 20줄이면 쿼리가 20개가 된다.

`FindSkuPricesService`는 `ProductQuery.findSkus`를 그대로 위임한다. 얇지만 인바운드 포트가 있어야 `catalog/index.ts`가 아웃바운드 포트를 내보내지 않고도 조회를 열 수 있다.

`catalog/index.ts`에 더한다:

```ts
export {
  FIND_SKU_PRICES_QUERY,
  type FindSkuPricesQuery,
} from './application/ports/in/queries/find-sku-prices.query';
export type { SkuPriceView } from './application/ports/out/product.query';
```

`SkuPriceView`를 아웃바운드 포트 파일에서 내보내는 것이 어색해 보이지만, 타입 하나를 위해 파일을 하나 더 만드는 것보다 낫다. **`ProductQuery` 인터페이스 자체는 내보내지 않는다** — 타입만 재수출한다.

`catalog.module.ts`의 `exports`에 `FIND_SKU_PRICES_QUERY`를 더한다.

**`inventory/index.ts`에 코드 상수 둘을 더한다.** 태스크 17이 이 파일을 다시 손대지만, ACL이 지금 필요로 하므로 여기서 넣는다.

```ts
/**
 * ACL이 구조적으로 판별할 때 쓰는 코드 문자열. **클래스가 아니라 값만 내보낸다** —
 * 예외 클래스를 내보내면 다른 컨텍스트가 우리 타입에 묶이고, 이 모듈을 별도
 * 프로세스로 떼어낼 때 그 클래스가 경계를 넘어야 한다.
 *
 * 출처가 하나여야 하는 이유: ordering이 `'INSUFFICIENT_STOCK'`을 복붙해 두면
 * 여기서 코드를 바꿀 때 조용히 어긋나고, 재고 부족이 409 대신 500으로 나간다.
 */
export const INSUFFICIENT_STOCK_CODE = InsufficientStockError.CODE;
export const STOCK_NOT_FOUND_CODE = StockNotFoundError.CODE;
```

`import { InsufficientStockError, StockNotFoundError } from './domain/stock.errors';`를 `index.ts` 상단에 더한다. **`index.ts`가 도메인을 import하는 것은 규칙 위반이 아니다** — `no-cross-module-internals`는 *다른* 모듈이 내부를 보는 것을 막고, 자기 `index.ts`가 자기 도메인을 보는 것은 공개 API를 조립하는 정상 경로다.

- [ ] **Step 2: customer의 공개 API를 넓힌다**

`customer/index.ts`에 더한다:

```ts
export {
  GET_ADDRESS_BOOK_QUERY,
  type GetAddressBookCommand,
  type GetAddressBookQuery,
} from './application/ports/in/queries/get-address-book.query';
export type { AddressView } from './application/ports/out/address.query';
```

`customer.module.ts`의 `exports`에 `GET_ADDRESS_BOOK_QUERY`를 더한다. **`exports`에 넣지 않으면 `index.ts`가 토큰을 내보내도 Nest가 다른 모듈에서 해석하지 못한다** — 두 곳을 함께 고쳐야 한다.

- [ ] **Step 3: ACL 어댑터 넷을 쓴다**

```ts
// in-process-catalog.adapter.ts
import { FIND_SKU_PRICES_QUERY, type FindSkuPricesQuery } from '../../../../catalog';
import { Inject, Injectable } from '@nestjs/common';
import type { SkuId } from '../../../../../shared/kernel/identifiers';
import { SkuId as SkuIdFactory } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import type { Currency } from '../../../../../shared/kernel/money';
import type { CatalogPriceProvider } from '../../../application/ports/out/catalog-price.provider';
import type { PricedItem } from '../../../domain/priced-item';

/**
 * Catalog로 나가는 ACL (스펙 §4.2). **이 파일이 Catalog를 별도 서비스로 떼어낼 때
 * 고칠 유일한 파일이다.**
 *
 * `Product` 애그리거트를 받지 않고 `SkuPriceView`(값)를 받아 `PricedItem`으로 바꾼다.
 * 그 변환이 ACL의 전부다 — 두 컨텍스트의 모델이 서로를 모르게 하는 것.
 *
 * `nameSnapshot`이 `"상품명 SKU코드"`인 이유: 상품 이름만으로는 어떤 변형을 샀는지
 * 알 수 없고, SKU 코드만으로는 무엇인지 알 수 없다. 주문 내역은 몇 달 뒤에 읽힌다.
 */
@Injectable()
export class InProcessCatalogAdapter implements CatalogPriceProvider {
  constructor(@Inject(FIND_SKU_PRICES_QUERY) private readonly skuPrices: FindSkuPricesQuery) {}

  async findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]> {
    const views = await this.skuPrices.execute([...skuIds]);
    return views.map((view) => ({
      // Catalog가 돌려준 것은 저장된 값이므로 fromPersistence다 — 사용자 입력이 아니다.
      skuId: SkuIdFactory.fromPersistence(view.skuId),
      nameSnapshot: `${view.productName} ${view.skuCode}`,
      unitPrice: Money.of(BigInt(view.amount), view.currency as Currency),
    }));
  }
}
```

```ts
// in-process-customer.adapter.ts
/**
 * Customer로 나가는 ACL. `SavedAddress`(id를 가진 엔티티)를 `ShippingAddress`(id 없는
 * VO)로 바꾼다(스펙 §5.3).
 *
 * 주소록 전체를 받아 메모리에서 고른다. 전용 조회 포트를 만들지 않는 이유: 주소록은
 * 고객당 수 개이고, 호출자가 하나뿐이며 테스트에서 바꿔치기할 이유도 없는 포트는
 * 포트가 아니다(스펙 §7.7).
 *
 * `customerId`로 범위가 좁혀지므로 **남의 주소를 넘기면 `null`이다** — 인가가 조회에
 * 내장된다.
 */
@Injectable()
export class InProcessCustomerAdapter implements CustomerAddressProvider {
  constructor(@Inject(GET_ADDRESS_BOOK_QUERY) private readonly addressBook: GetAddressBookQuery) {}

  async findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null> {
    const addresses = await this.addressBook.execute({ customerId });
    const found = addresses.find((address) => address.id === addressId);
    if (found === undefined) {
      return null;
    }
    // label을 담지 않는다 — 주소록에서 고르기 위한 메타데이터이지 배송 정보가 아니다.
    return ShippingAddress.fromPersistence({
      recipient: found.recipient,
      phone: found.phone,
      zip: found.zip,
      line1: found.line1,
      line2: found.line2,
    });
  }
}
```

```ts
// in-process-inventory.adapter.ts
import {
  INSUFFICIENT_STOCK_CODE,
  RELEASE_RESERVATION_USECASE,
  RESERVE_STOCK_USECASE,
  STOCK_NOT_FOUND_CODE,
  type ReleaseReservationUseCase,
  type ReserveStockUseCase,
} from '../../../../inventory';

/**
 * Inventory로 나가는 ACL (스펙 §4.2). **스펙 §13의 성공 기준이 이 파일을 지목한다** —
 * "`InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음".
 *
 * inventory의 도메인 예외를 ordering의 결과 유니온으로 번역하는 것이 ACL의 일이다.
 * 판별을 **구조적으로**(`code` 필드) 한다 — `InsufficientStockError` 클래스를
 * import하려면 inventory가 그것을 내보내야 하고, 그러면 Core가 Supporting의 예외
 * 타입에 묶여 Inventory를 별도 프로세스로 떼어낼 때 그 타입이 경계를 넘어야 한다.
 * 계획 2의 `PrismaAccountRepository`가 Prisma 오류에 같은 방식을 썼다.
 */
@Injectable()
export class InProcessInventoryAdapter implements InventoryReserver {
  constructor(
    @Inject(RESERVE_STOCK_USECASE) private readonly reserveStock: ReserveStockUseCase,
    @Inject(RELEASE_RESERVATION_USECASE) private readonly releaseReservation: ReleaseReservationUseCase,
  ) {}

  async reserve(params: {
    orderId: OrderId;
    skuId: SkuId;
    quantity: Quantity;
  }): Promise<ReserveOutcome> {
    try {
      const { reservationId, expiresAt } = await this.reserveStock.execute({
        skuId: params.skuId,
        orderId: params.orderId,
        quantity: params.quantity.value,
      });
      return { ok: true, reservationId, expiresAt };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === INSUFFICIENT_STOCK_CODE) {
        return { ok: false, reason: 'OUT_OF_STOCK' };
      }
      if (code === STOCK_NOT_FOUND_CODE) {
        return { ok: false, reason: 'SKU_UNKNOWN' };
      }
      // 그 밖의 예외는 진짜 오류다. 삼키면 사가가 조용히 틀린 길로 간다.
      throw error;
    }
  }

  async release(params: { reservationId: string }): Promise<void> {
    await this.releaseReservation.execute({ reservationId: params.reservationId });
  }
}
```

```ts
// in-process-payment.adapter.ts
import {
  AUTHORIZE_PAYMENT_USECASE,
  type AuthorizePaymentUseCase,
} from '../../../../payment';

/**
 * Payment로 나가는 ACL. **PG를 직접 부르지 않는다** — payment 모듈을 부른다(스펙 §7.4).
 *
 * 결과 유니온을 그대로 옮긴다. 두 유니온의 모양이 같은 것은 우연이 아니라 같은
 * 판단(거절은 결과, 오류는 예외)에서 나온 것이고, 모양이 갈라지는 순간 이 파일만 바뀐다.
 */
@Injectable()
export class InProcessPaymentAdapter implements PaymentGateway {
  constructor(
    @Inject(AUTHORIZE_PAYMENT_USECASE) private readonly authorizePayment: AuthorizePaymentUseCase,
  ) {}

  async authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome> {
    const result = await this.authorizePayment.execute({
      orderId: params.orderId,
      amount: params.amount.amount.toString(),
      currency: params.amount.currency,
    });
    return result.ok
      ? { ok: true, paymentId: result.paymentId, pgTxId: result.pgTxId }
      : { ok: false, reason: result.reason };
  }
}
```

- [ ] **Step 4: 어댑터 spec을 쓴다**

넷 다 **손으로 쓴 fake 유스케이스**로 단위 테스트한다. 각각이 확인할 것:

- `InProcessCatalogAdapter`: `nameSnapshot`이 `"상품명 SKU코드"`다 / 없는 SKU는 결과에서 빠진다 / 금액 문자열이 `bigint`로 복원된다
- `InProcessCustomerAdapter`: id로 고른다 / 없는 id면 `null` / **`label`이 `ShippingAddress`에 담기지 않는다**(`ShippingAddress`에 `label` 필드가 없으므로 타입으로 보장되지만, `line2`가 `null`인 경우가 그대로 넘어가는지 확인한다)
- `InProcessInventoryAdapter`: 성공하면 `ok: true` / `code === 'INSUFFICIENT_STOCK'`인 예외는 `{ ok: false, reason: 'OUT_OF_STOCK' }` / `code === 'STOCK_NOT_FOUND'`는 `'SKU_UNKNOWN'` / **그 밖의 예외는 그대로 던진다**
- `InProcessPaymentAdapter`: `ok: true`를 옮긴다 / `ok: false`와 `reason`을 옮긴다 / 금액이 문자열로 넘어간다 / **유스케이스가 던지면 그대로 던진다**

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 코드 상수의 출처가 하나인가 — 이 태스크에서 가장 중요한 프루브다**
`apps/api/src/modules/inventory/domain/stock.errors.ts`의 `InsufficientStockError.CODE`를 `'INSUFFICIENT_STOCK_V2'`로 바꾼다.
Expected: **어댑터 테스트는 통과한다.** 그것이 이 설계의 요점이다 — `INSUFFICIENT_STOCK_CODE`가 같은 상수를 재수출하므로 양쪽이 함께 움직인다. 문자열을 어댑터에 복붙했다면 여기서 조용히 어긋나 재고 부족이 500으로 나갔을 것이다.
**대신 `app.module.spec.ts`의 에러 매핑 단언이 실패해야 한다**(계획 3이 `InsufficientStockError.CODE`로 매핑을 등록했다). 그것까지 확인하고 두 관측을 보고서에 적는다.
되돌린다.

**(a-2) 어댑터가 모르는 예외를 삼키지 않는가**
`InProcessInventoryAdapter`의 마지막 `throw error;`를 `return { ok: false, reason: 'OUT_OF_STOCK' };`로 바꾼다.
Expected: FAIL — `'그 밖의 예외는 그대로 던진다'`가 실패한다. **이 회귀는 DB 장애를 "재고 부족"으로 둔갑시킨다** — 사가는 정상적으로 주문을 실패 처리하고, 진짜 원인은 어디에도 남지 않는다.
되돌린다.

**(b) N+1이 없는가**
`PrismaProductQuery.findSkus`를 `skuIds.map((id) => this.prisma.sku.findUnique(...))`로 바꾼다.
Expected: **모든 테스트가 통과한다.** 쿼리 수를 세는 테스트가 없기 때문이다. 관측 결과를 보고서에 적고, 장바구니 20줄이면 쿼리가 20개가 된다는 사실을 기록한다. 되돌린다. (쿼리 수를 세는 장치를 만드는 것은 이 계획의 범위를 넘는다 — 백로그로 태스크 22에 적는다.)

**(c) `customer.module.ts`의 `exports`가 필요한가**
`GET_ADDRESS_BOOK_QUERY`를 `exports`에서 뺀다.
Expected: FAIL — `app.module.spec.ts`가 `OrderingModule` 컴파일 시 `CustomerAddressProvider` 해석에 실패한다. `index.ts`가 토큰을 내보내는 것만으로는 부족하다는 것을 이 프루브가 고정한다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 통과한다 — ordering이 catalog·customer·inventory·payment의 `index.ts`만 import한다.

```bash
git add apps/api/src/modules
git commit -m "feat(ordering): 카탈로그·고객·재고·결제 ACL 어댑터를 추가한다"
```

---

### Task 17: Inventory 확장 — `RESTORED` 전이와 주문 단위 유스케이스

**Files:**
- Modify: `apps/api/src/modules/inventory/domain/reservation.ts` + `reservation.spec.ts`
- Modify: `apps/api/src/modules/inventory/domain/stock-item.ts` + `stock-item.spec.ts`
- Modify: `apps/api/src/modules/inventory/application/ports/out/reservation.repository.ts` + `reservation-repository.contract.ts`
- Modify: `apps/api/src/modules/inventory/testing/in-memory-reservation.repository.ts`, `adapters/out/persistence/prisma-reservation.repository.ts`
- Create: `apps/api/src/modules/inventory/application/ports/in/{confirm-reservations-for-order,release-reservations-for-order,restore-reservations-for-order}.usecase.ts`
- Create: `apps/api/src/modules/inventory/application/services/reservations-for-order.service.ts` + spec
- Modify: `apps/api/src/modules/inventory/{index.ts, inventory.module.ts, application/ports/port-tokens.spec.ts}`

**Interfaces:**
- Produces:
  - `ReservationStatus`에 `'RESTORED'` 추가
  - `reservation.restore(now): boolean` — `CONFIRMED` → `RESTORED`
  - `stockItem.restore(quantity): void` — 확정으로 차감된 `onHand`를 되돌린다
  - `ReservationRepository.findByOrderId(orderId, tx?): Promise<Reservation[]>`
  - `ConfirmReservationsForOrderUseCase` / `ReleaseReservationsForOrderUseCase` / `RestoreReservationsForOrderUseCase` — 각각 `execute({ orderId }): Promise<number>` (처리 건수) + 토큰 셋
  - `ReservationsForOrderService`가 셋을 `confirm` / `release` / `restore`로 구현한다

**왜 `RESTORED`가 필요한가.** PAID 주문을 취소하면 환불과 함께 재고를 복원해야 한다(스펙 §5.4). 그런데 그 예약은 이미 `CONFIRMED`이고 재고는 `onHand`에서 차감됐다 — "해제"가 아니라 "되돌리기"다. 계획 3의 전이표에서 `CONFIRMED`는 종착점이었다.

계획 3의 `RestockUseCase`를 부르는 방법도 있지만 **틀렸다.** 입고는 예약과 무관한 사건이라 링크가 없고, 같은 `OrderCancelled`가 두 번 배달되면 재고가 두 번 늘어난다. `Reservation`에 전이를 추가하면 두 번째 호출이 `false`를 돌려주고 멱등성이 예약 행에 남는다.

**확장된 전이표**

| 현재 | `confirm` | `release` | `expire` | `restore` |
|---|---|---|---|---|
| `PENDING` | → `CONFIRMED`, `true` | → `RELEASED`, `true` | → `EXPIRED`, `true` | 충돌 |
| `CONFIRMED` | `false` | 충돌 | `false` | → `RESTORED`, `true` |
| `RELEASED` | 충돌 | `false` | `false` | 충돌 |
| `EXPIRED` | 충돌 | `false` | `false` | 충돌 |
| `RESTORED` | 충돌 | 충돌 | `false` | `false` |

`RESTORED`에서 `expire`가 `false`인 이유: 만료 스캔은 `PENDING`만 찾으므로 여기 도달하지 않지만, 도달해도 조용히 넘어가는 것이 맞다 — 이미 결말이 난 예약이다.

- [ ] **Step 1: 도메인을 확장한다**

`stock-item.ts`에 추가한다.

```ts
  /**
   * 확정으로 차감된 재고를 되돌린다. PAID 주문이 취소·환불될 때 부른다(스펙 §5.4).
   *
   * `release`와 다르다: `release`는 아직 차감되지 않은 `reserved`를 줄이고,
   * `restore`는 이미 차감된 `onHand`를 늘린다. `reserved`는 확정 시점에 이미
   * 0으로 내려갔으므로 건드리지 않는다.
   *
   * `restock`과도 다르다: `restock`은 입고라는 별개의 사건이고 예약과 링크가 없다.
   * 같은 취소 이벤트가 두 번 배달되면(at-least-once) `restock`은 재고를 두 번 늘리지만,
   * `restore`는 `Reservation`의 전이가 두 번째를 막는다.
   */
  restore(quantity: Quantity): void {
    this.onHandValue = this.onHandValue.plus(quantity);
  }
```

`reservation.ts`에 `'RESTORED'`를 상태 타입에 더하고 전이를 추가한다.

```ts
  /**
   * 확정된 예약을 되돌린다. 호출자가 `StockItem.restore`를 함께 부른다.
   *
   * `CONFIRMED`에서만 가능하다. `PENDING` 예약을 복원하려는 것은 사가가 순서를
   * 잃었다는 뜻이고(확정 전인데 환불이 왔다), 조용히 넘기면 그 사실이 드러나지 않는다.
   */
  restore(_now: Date): boolean {
    if (this.statusValue === 'RESTORED') {
      return false;
    }
    if (this.statusValue !== 'CONFIRMED') {
      throw new ReservationConflictError(this.id, this.statusValue, 'RESTORED');
    }
    this.statusValue = 'RESTORED';
    return true;
  }
```

`expire`의 조기 반환 조건에 `RESTORED`가 포함되는지 확인한다 — 현재 구현은 `if (this.statusValue !== 'PENDING') return false;`이므로 자동으로 포함된다.

`reservation.spec.ts`와 `stock-item.spec.ts`에 전이표의 새 행·열을 전부 덮는 케이스를 더한다.

- [ ] **Step 2: `findByOrderId`를 더한다**

포트에 추가하고, in-memory·Prisma 두 구현에 넣고, **계약 스위트에 케이스를 더한다.**

```ts
  /**
   * 한 주문의 모든 예약. `reservations.order_id` 인덱스가 이것을 지원한다.
   *
   * 이벤트가 실어 나르는 것은 `orderId`다 — `OrderPaid`에 예약 ID 목록을 넣으려면
   * `Order`가 Inventory의 내부 식별자를 들어야 하고, 그것은 Core 애그리거트에
   * 다른 컨텍스트를 박는 결합이다.
   */
  findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Reservation[]>;
```

계약에 더할 케이스:

- 주문의 예약을 전부 돌려준다 (2건 저장 후 2건)
- 다른 주문의 예약이 섞이지 않는다
- 없는 주문이면 빈 배열이다 (`null`이 아니다)
- **상태와 무관하게 전부 돌려준다** — `CONFIRMED`도 `RELEASED`도 포함한다. 필터링은 유스케이스의 몫이다

- [ ] **Step 3: 주문 단위 유스케이스 셋을 만든다**

```ts
/**
 * 주문 하나의 예약을 한꺼번에 처리한다. 셋 다 같은 골격이다 — 주문의 예약을 찾고,
 * 각각에 전이를 시도하고, 성공한 것에 대해 재고를 움직인다.
 *
 * **예약마다 트랜잭션을 연다.** 한 주문의 예약이 여러 SKU에 걸쳐 있고, 하나가
 * 실패해도 나머지는 처리돼야 한다 — 계획 3의 `ExpireReservationsService`가 같은
 * 판단을 했다. 전부 한 트랜잭션에 넣으면 SKU 하나의 잠금 경합이 주문 전체를 막는다.
 *
 * **처리 건수를 돌려준다.** 0이면 이미 전부 처리됐다는 뜻이고, 구독 어댑터가 그것을
 * 로그로 남겨 중복 배달을 관측할 수 있게 한다.
 */
export class ReservationsForOrderService {
  private readonly logger = new Logger(ReservationsForOrderService.name);

  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async confirm(command: { orderId: string }): Promise<number> {
    return this.applyEach(command.orderId, (reservation, now) => reservation.confirm(now), (stock, quantity) =>
      stock.confirm(quantity),
    );
  }

  async release(command: { orderId: string }): Promise<number> {
    return this.applyEach(command.orderId, (reservation, now) => reservation.release(now), (stock, quantity) =>
      stock.release(quantity),
    );
  }

  async restore(command: { orderId: string }): Promise<number> {
    return this.applyEach(command.orderId, (reservation, now) => reservation.restore(now), (stock, quantity) =>
      stock.restore(quantity),
    );
  }

  private async applyEach(
    rawOrderId: string,
    transition: (reservation: Reservation, now: Date) => boolean,
    apply: (stock: StockItem, quantity: Quantity) => void,
  ): Promise<number> {
    const orderId = OrderId.of(rawOrderId);
    const now = this.clock.now();
    const found = await this.reservations.findByOrderId(orderId);

    let processed = 0;
    for (const reservation of found) {
      try {
        const changed = await this.transactions.run(async (tx) => {
          // 트랜잭션 안에서 다시 읽는다. 밖에서 읽은 것은 다른 요청이 이미
          // 바꿨을 수 있고, 그 위에 전이를 얹으면 잃어버린 갱신이 된다.
          const fresh = await this.reservations.findById(reservation.id, tx);
          if (fresh === null) {
            return false;
          }
          if (!transition(fresh, now)) {
            return false;
          }
          await this.stocks.mutate(fresh.skuId, tx, (stock) => apply(stock, fresh.quantity));
          await this.reservations.save(fresh, tx);
          return true;
        });
        if (changed) {
          processed += 1;
        }
      } catch (error) {
        // 한 예약의 실패가 나머지를 막지 않는다. 실패한 것은 TTL이 회수하거나
        // (PENDING이면) 운영자가 last_error를 보고 처리한다.
        this.logger.error(
          `주문 ${rawOrderId}의 예약 ${reservation.id} 처리 실패: ${String(error)}`,
        );
      }
    }
    return processed;
  }
}
```

**메서드 이름과 배선.** `ReservationsForOrderService`는 세 유스케이스를 구현하지만 셋 다 `execute`일 수는 없다. `confirm` / `release` / `restore`로 노출하고, `inventory.module.ts`가 각각을 얇은 객체 리터럴로 감싸 토큰에 바인딩한다 — 태스크 6의 `PaymentService`와 같은 형태다.

```ts
    {
      provide: CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
      useFactory: (service: ReservationsForOrderService): ConfirmReservationsForOrderUseCase => ({
        execute: (command) => service.confirm(command),
      }),
      inject: [ReservationsForOrderService],
    },
```

**`inventory/index.ts`에 세 유스케이스와 토큰을 내보낸다.** 태스크 18의 구독 어댑터가 같은 모듈 안에 있으므로 엄밀히는 필요 없지만, 계획 5 이후 관리자 화면이 붙을 자리이고 무엇보다 **공개 API가 이 컨텍스트의 능력을 문서화한다.**

- [ ] **Step 4: spec을 쓴다**

`reservations-for-order.service.spec.ts`가 덮는 것:

- 주문의 예약 2건을 확정하면 2를 돌려주고 두 SKU의 재고가 차감된다
- 이미 확정된 예약에 다시 부르면 0을 돌려주고 재고가 다시 줄지 않는다 (**at-least-once 멱등성**)
- 해제하면 `reserved`가 줄고 `onHand`는 그대로다
- **복원하면 `onHand`가 늘고 `reserved`는 그대로다**
- 확정되지 않은 예약을 복원하려 하면 그 예약은 건너뛰고 나머지는 처리된다 (예외를 삼킨다)
- 한 예약의 재고가 없어 실패해도 나머지가 처리된다
- 없는 주문이면 0이다

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다**

**(a) 복원 멱등성이 있는가**
`Reservation.restore`의 `if (this.statusValue === 'RESTORED') return false;`를 지운다.
Expected: FAIL — `'이미 복원된 예약에 다시 부르면 재고가 다시 늘지 않는다'`가 실패한다. **이 회귀는 취소 이벤트가 두 번 배달될 때 재고를 두 번 늘린다** — 팔 수 있는 수량이 실제보다 많아지고 초과 판매로 이어진다.
되돌린다.

**(b) 트랜잭션 안에서 다시 읽는가**
`applyEach`의 `const fresh = await this.reservations.findById(reservation.id, tx);`를 지우고 밖에서 읽은 `reservation`을 그대로 쓴다.
Expected: **순차 호출만 하는 단위 테스트는 통과한다.** 관측 결과를 보고서에 적는다 — 이 회귀는 동시 요청에서만 드러나고, 그것을 잡는 장치가 이 계획에 없다는 사실을 기록한다. (계획 3의 재고 동시성 스위트가 같은 자리를 다뤘고, 예약 전이에 대한 동시성 스위트는 백로그다 — 태스크 22에 적는다.)
되돌린다.

**(c) 한 예약의 실패가 나머지를 막지 않는가**
`applyEach`의 `try`/`catch`를 걷어낸다.
Expected: FAIL — `'한 예약의 재고가 없어 실패해도 나머지가 처리된다'`가 실패한다.
되돌린다.

- [ ] **Step 6: 전체 검증과 커밋**

```bash
git add apps/api/src/modules/inventory
git commit -m "feat(inventory): 예약 복원 전이와 주문 단위 유스케이스를 추가한다"
```

---

### Task 18: 이벤트 구독 어댑터 셋

**Files:**
- Create: `apps/api/src/modules/inventory/adapters/in/events/inventory-event.subscriber.ts` + spec
- Create: `apps/api/src/modules/ordering/adapters/in/events/ordering-event.subscriber.ts` + spec
- Create: `apps/api/src/modules/payment/adapters/in/events/payment-event.subscriber.ts` + spec
- Modify: 세 모듈의 `*.module.ts`

**Interfaces:**
- Consumes: `OutboxRecord`, `@OnEvent`, 태스크 13·17의 유스케이스
- Produces: `InventoryEventSubscriber`, `OrderingEventSubscriber`, `PaymentEventSubscriber`

**이벤트가 도는 경로 — 이 태스크가 닫는 고리다**

```
애그리거트가 raise → 유스케이스가 같은 트랜잭션에서 outbox INSERT
  → OutboxRelayScheduler(계획 3)가 폴링 → NestEventEmitterTransport.send
    → EventEmitter2.emitAsync(record.eventType, record) → @OnEvent 구독자
```

**구독자가 던지면 릴레이가 재시도한다.** `emitAsync`는 리스너의 거부를 전파하고, `OutboxRelay`는 전송 실패를 `attempts` 증가 + 지수 백오프로 다룬다. `MAX_ATTEMPTS`(10)에 도달하면 데드레터로 남고 `last_error`가 단서가 된다. **그러므로 구독자는 일시적 실패에 던져야 하고, 영구적 실패(이미 처리됨)에는 던지면 안 된다** — 후자가 던지면 그 이벤트가 데드레터에 도달할 때까지 outbox의 head-of-line을 차지한다.

**구독 표 (스펙 §5.6)**

| 이벤트 | 구독자 | 하는 일 |
|---|---|---|
| `ordering.OrderPaid` | Inventory | 예약 확정 (`confirm`) |
| `ordering.OrderPaymentFailed` | Inventory | 예약 해제 (`release`) |
| `ordering.OrderCancelled` | Inventory | `wasPaid ? restore : release` |
| `ordering.OrderCancelled` | Payment | 환불 (`wasPaid`일 때만) |
| `payment.PaymentRefunded` | Ordering | 주문 `REFUNDED` 전이 |
| `inventory.StockReservationExpired` | Ordering | 주문 `PAYMENT_FAILED` 전이 |

- [ ] **Step 1: 페이로드 읽기를 안전하게 만든다**

`OutboxRecord.payload`는 `Readonly<Record<string, unknown>>`이다. **JsonB에서 온 값이라 타입 보장이 없다.** 구독자마다 캐스팅하면 잘못된 payload가 조용히 `undefined`로 흘러 유스케이스가 `InvalidIdError`를 던진다 — 원인이 payload인지 데이터인지 알 수 없다.

`apps/api/src/shared/infrastructure/messaging/event-payload.ts`를 만든다.

```ts
/**
 * outbox payload에서 필드를 꺼낸다. JsonB에서 온 값이라 타입 보장이 없다.
 *
 * 캐스팅으로 넘기면 잘못된 payload가 조용히 `undefined`로 흘러 유스케이스가
 * `InvalidIdError`를 던지고, 원인이 payload인지 저장된 데이터인지 알 수 없게 된다.
 * 여기서 소리 나게 실패하면 릴레이의 `last_error`에 정확한 이유가 남는다.
 */
export function requireString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string,
): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${eventType} 이벤트의 payload에 문자열 "${key}"가 없습니다.`);
  }
  return value;
}

export function requireBoolean(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string,
): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${eventType} 이벤트의 payload에 불린 "${key}"가 없습니다.`);
  }
  return value;
}
```

spec은 정상 값, 없는 키, 타입이 다른 값, 빈 문자열을 덮는다.

- [ ] **Step 2: Inventory 구독자를 쓴다**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  requireBoolean,
  requireString,
} from '../../../../../shared/infrastructure/messaging/event-payload';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';

/**
 * Ordering의 이벤트를 구독해 예약을 확정·해제·복원한다(스펙 §5.6).
 *
 * **이벤트 이름 문자열을 여기 적는다.** ordering의 상수를 import하면
 * `no-cross-module-internals`에 걸리고, `ordering/index.ts`가 내보내게 하면 Supporting이
 * Core의 공개 API에 묶인다 — 역방향 의존이 이름 하나라도 생기면 `no-circular`가
 * 발화할 여지가 생긴다(스펙 §4.1). 문자열이 어긋나면 **구독자가 조용히 안 불린다**는
 * 것이 이 선택의 대가이고, 태스크 20의 사가 E2E가 그것을 잡는 유일한 장치다.
 *
 * 던지면 릴레이가 재시도한다. 이미 처리된 이벤트(처리 건수 0)에는 **던지지 않는다** —
 * 던지면 그 이벤트가 데드레터에 도달할 때까지 outbox의 head-of-line을 차지한다.
 */
@Injectable()
export class InventoryEventSubscriber {
  private readonly logger = new Logger(InventoryEventSubscriber.name);

  constructor(
    @Inject(CONFIRM_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly confirmForOrder: ConfirmReservationsForOrderUseCase,
    @Inject(RELEASE_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly releaseForOrder: ReleaseReservationsForOrderUseCase,
    @Inject(RESTORE_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly restoreForOrder: RestoreReservationsForOrderUseCase,
  ) {}

  @OnEvent('ordering.OrderPaid')
  async onOrderPaid(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    const processed = await this.confirmForOrder.execute({ orderId });
    this.log(record.eventType, orderId, processed);
  }

  @OnEvent('ordering.OrderPaymentFailed')
  async onOrderPaymentFailed(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    const processed = await this.releaseForOrder.execute({ orderId });
    this.log(record.eventType, orderId, processed);
  }

  @OnEvent('ordering.OrderCancelled')
  async onOrderCancelled(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    // 결제 전 취소면 예약은 아직 PENDING이라 해제, 결제 후면 CONFIRMED라 복원이다.
    // 이 값이 없으면 Inventory가 예약 상태를 보고 추측해야 하고, 추측은 경합에서 틀린다.
    const wasPaid = requireBoolean(record.payload, 'wasPaid', record.eventType);
    const processed = wasPaid
      ? await this.restoreForOrder.execute({ orderId })
      : await this.releaseForOrder.execute({ orderId });
    this.log(record.eventType, orderId, processed);
  }

  private log(eventType: string, orderId: string, processed: number): void {
    if (processed === 0) {
      // 중복 배달이거나 이미 처리된 주문이다. 정상이지만 빈도가 높으면 릴레이를 봐야 한다.
      this.logger.debug(`${eventType}(${orderId}): 처리할 예약이 없습니다.`);
      return;
    }
    this.logger.log(`${eventType}(${orderId}): 예약 ${processed}건을 처리했습니다.`);
  }
}
```

- [ ] **Step 3: Ordering·Payment 구독자를 쓴다**

`OrderingEventSubscriber`:
- `@OnEvent('payment.PaymentRefunded')` → `HandlePaymentRefundedUseCase`
- `@OnEvent('inventory.StockReservationExpired')` → `HandleStockReservationExpiredUseCase`

**`StockReservationExpired`의 payload에는 `orderId`가 있다** — 계획 3의 `stock.events.ts`가 `reservationId`·`skuId`·`orderId`·`quantity`를 담았다. 그 필드명을 그대로 쓴다.

`PaymentEventSubscriber`:
- `@OnEvent('ordering.OrderCancelled')` → `wasPaid`가 `true`일 때만 `RefundPaymentUseCase`. `false`면 돈이 오간 적이 없으므로 아무것도 하지 않는다.

**같은 이벤트에 구독자가 둘인 것(Inventory와 Payment가 모두 `OrderCancelled`를 듣는다)이 정상이다.** `EventEmitter2.emitAsync`는 모든 리스너를 부르고 하나라도 거부하면 전체가 거부된다 — 그러면 릴레이가 재시도하고 **이미 성공한 구독자도 다시 불린다.** 그래서 양쪽 다 멱등해야 하고, `Reservation.restore`와 `Payment.refund`가 각각 `false`를 돌려주는 것이 그 요구를 갚는다.

- [ ] **Step 4: spec을 쓴다 — 손으로 쓴 fake 유스케이스로**

각 구독자마다:
- 올바른 payload면 유스케이스를 정확한 인자로 부른다
- **payload에 `orderId`가 없으면 던진다** (릴레이가 재시도하고 `last_error`에 이유가 남는다)
- 처리 건수 0이어도 던지지 않는다
- 유스케이스가 던지면 그대로 전파한다 (릴레이가 재시도해야 한다)
- `OrderCancelled`: `wasPaid: true`면 `restore`, `false`면 `release`를 부른다 (Inventory) / `true`일 때만 환불한다 (Payment)

- [ ] **Step 5: 모듈에 등록한다**

세 모듈의 `providers`에 구독자를 더한다. **`controllers`가 아니다** — `@OnEvent`는 프로바이더에서 동작한다.

`app.module.spec.ts`에 세 구독자가 해석되는지 단언을 더한다.

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) `wasPaid` 분기가 실제로 있는가**
`InventoryEventSubscriber.onOrderCancelled`를 항상 `releaseForOrder`를 부르도록 바꾼다.
Expected: FAIL — `'wasPaid: true면 restore를 부른다'`가 실패한다. **이 회귀는 PAID 주문 취소 시 `CONFIRMED` 예약에 `release`를 시도해 `ReservationConflictError`를 내고, 재고가 영영 복원되지 않는다.**
되돌린다.

**(b) 이벤트 이름 문자열이 맞는가**
`@OnEvent('ordering.OrderPaid')`를 `@OnEvent('ordering.OrderPayed')`로 바꾼다.
Expected: **모든 단위 테스트가 통과한다.** 구독자 spec은 메서드를 직접 부르지 이벤트를 흘리지 않는다. 관측 결과를 보고서에 적고, **이 오타를 잡는 유일한 장치가 태스크 20의 사가 E2E**라는 사실을 기록한다.
되돌린다.

**(c) payload 검증이 있는가**
`requireString`을 `record.payload['orderId'] as string`으로 바꾼다.
Expected: FAIL — `'payload에 orderId가 없으면 던진다'`가 실패한다(유스케이스가 `undefined`를 받아 `InvalidIdError`를 던지거나, fake라면 조용히 통과한다). 어느 쪽인지 관측하고 보고서에 적는다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

```bash
git add apps/api/src
git commit -m "feat(api): 사가 이벤트 구독 어댑터 셋을 배선한다"
```

---

### Task 19: Ordering 계약·컨트롤러·모듈 배선

**Files:**
- Create: `packages/contracts/src/ordering/{cart.contract.ts, order.contract.ts}` + 각각 spec
- Modify: `packages/contracts/src/{index.ts, api.contract.ts}`
- Create: `apps/api/src/modules/ordering/adapters/in/http/{cart.controller.ts, order.controller.ts, ordering-domain-error-mappings.ts}` + 통합 spec 둘
- Create: `apps/api/src/modules/ordering/{ordering.module.ts, index.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`

**Interfaces:**
- Produces: `cartContract`, `orderContract`, `OrderingModule`, `ordering/index.ts`

**엔드포인트**

| 라우트 | 상태 | 비고 |
|---|---|---|
| `GET /cart` | 200, 401 | 빈 장바구니도 200이다 |
| `POST /cart/items` | 204, 400, 401, 422(`CART_LINE_LIMIT_EXCEEDED`) | |
| `PUT /cart/items/:skuId` | 204, 400, 401, 404(`CART_LINE_NOT_FOUND`) | 수량 변경 |
| `DELETE /cart/items/:skuId` | 204, 401, 404 | |
| `POST /orders` | 201, 400, 401, 404(배송지), 409(`OUT_OF_STOCK`), 422(`EMPTY_CART`/`UNKNOWN_SKU`) | 주문 생성 = 사가 |
| `GET /orders/:orderId` | 200, 401, 403(`ORDER_NOT_OWNED`), 404 | |
| `GET /orders` | 200, 400, 401 | 내 주문 목록 |
| `POST /orders/:orderId/cancel` | 200, 401, 403, 404, 409(`ORDER_CONFLICT`) | |

**`POST /orders`가 결제 거절에도 201인 이유.** 주문은 만들어졌다 — 주문 번호가 있고 상태가 `PAYMENT_FAILED`다. 4xx로 만들면 클라이언트가 주문 번호를 받을 수 없어 "다시 시도" 화면을 그리지 못한다. 응답 본문의 `status`가 결과를 말한다.

**`POST /orders/:orderId/cancel`이 200인 이유.** 취소 결과가 `CANCELLED`인지 `REFUND_PENDING`인지를 본문으로 돌려줘야 클라이언트가 "취소되었습니다"와 "환불 처리 중입니다"를 구분해 보여줄 수 있다. 204면 그 정보가 사라진다.

- [ ] **Step 1: 계약을 만든다**

```ts
// cart.contract.ts
// moneyDtoSchema는 packages/contracts/src/shared/money.dto.ts에 이미 있다.
// 새로 만들지 않는다 — 두 개가 되면 하나만 고쳐지는 날이 온다.
import { moneyDtoSchema } from '../shared/money.dto';

export const cartLineDtoSchema = z
  .object({
    skuId: z.string().uuid(),
    nameSnapshot: z.string().min(1),
    unitPrice: moneyDtoSchema,
    quantity: z.number().int().positive(),
    subtotal: moneyDtoSchema,
  })
  .strict();

export const cartDtoSchema = z
  .object({
    cartId: z.string().uuid().nullable(),
    lines: z.array(cartLineDtoSchema),
    total: moneyDtoSchema,
    /** Catalog가 더 이상 팔지 않는 SKU. 클라이언트가 그 줄을 안내와 함께 표시한다. */
    unavailableSkuIds: z.array(z.string().uuid()),
  })
  .strict();

export const addCartItemBodySchema = z
  .object({ skuId: z.string().uuid(), quantity: z.number().int().positive() })
  .strict();

export const changeCartItemBodySchema = z
  .object({ quantity: z.number().int().positive() })
  .strict();
```

```ts
// order.contract.ts
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]);

export const shippingAddressDtoSchema = z
  .object({
    recipient: z.string().min(1),
    phone: z.string().min(1),
    zip: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().nullable(),
  })
  .strict();

export const orderLineDtoSchema = z
  .object({
    skuId: z.string().uuid(),
    nameSnapshot: z.string().min(1),
    unitPrice: moneyDtoSchema,
    quantity: z.number().int().positive(),
    subtotal: moneyDtoSchema,
  })
  .strict();

export const orderDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: orderStatusSchema,
    total: moneyDtoSchema,
    placedAt: z.string().datetime(),
    shippingAddress: shippingAddressDtoSchema,
    lines: z.array(orderLineDtoSchema).min(1),
  })
  .strict();

export const orderSummaryDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: orderStatusSchema,
    total: moneyDtoSchema,
    placedAt: z.string().datetime(),
    lineCount: z.number().int().positive(),
  })
  .strict();

export const placeOrderBodySchema = z.object({ addressId: z.string().uuid() }).strict();

export const placeOrderResultSchema = z
  .object({ orderId: z.string().uuid(), status: orderStatusSchema })
  .strict();

export const cancelOrderResultSchema = z.object({ status: orderStatusSchema }).strict();

export const listMyOrdersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
```

**`orderDtoSchema`에 `customerId`가 없다.** `OrderView`에는 있지만(인가 비교용) 와이어에는 나가지 않는다 — 본인 주문만 볼 수 있으므로 클라이언트가 이미 아는 값이고, 담으면 응답이 남의 고객 id를 실을 여지가 생긴다. 컨트롤러의 `toDto`가 그 필드를 떨어뜨린다.

계약 spec은 각 스키마의 `.strict()` 동작, 열거값, `min(1)` 제약, 응답 맵의 상태 코드 목록을 확인한다.

`index.ts`에 둘 다 재수출하고 `api.contract.ts`에 `cart: cartContract, order: orderContract`를 더한다.

- [ ] **Step 2: 에러 매핑을 등록한다**

```ts
export function registerOrderingDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(CartLineNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(CartNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(CartLineLimitExceededError.CODE, {
    status: 422,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(EmptyCartError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(EmptyOrderError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  registry.register(MixedCurrencyOrderError.CODE, {
    status: 422,
    code: ErrorCode.DOMAIN_RULE_VIOLATED,
  });
  registry.register(UnknownSkuError.CODE, { status: 422, code: ErrorCode.DOMAIN_RULE_VIOLATED });
  // 계획 1이 계약에 넣어둔 ErrorCode.INSUFFICIENT_STOCK의 두 번째 사용처다.
  registry.register(OutOfStockError.CODE, { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });
  // 계획 1이 넣어둔 ORDER_NOT_CANCELLABLE의 첫 사용처다.
  registry.register(OrderConflictError.CODE, {
    status: 409,
    code: ErrorCode.ORDER_NOT_CANCELLABLE,
  });
  registry.register(OrderNotOwnedError.CODE, { status: 403, code: ErrorCode.FORBIDDEN });
  registry.register(OrderNotFoundError.CODE, { status: 404, code: ErrorCode.NOT_FOUND });
  registry.register(ShippingAddressNotFoundError.CODE, {
    status: 404,
    code: ErrorCode.NOT_FOUND,
  });
  registry.register(InvalidShippingAddressError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
}
```

- [ ] **Step 3: 컨트롤러 둘을 쓴다**

`CartController`는 `@Controller('cart')` + `@UseGuards(AccessTokenGuard)`이고 `@CurrentPrincipal()`로 `customerId`를 받는다. `OrderController`도 같다. **경로 파라미터의 uuid 검증은 값 객체가 한다** — 계획 3의 `StockController`가 같은 형태이고, `InvalidIdError`가 400으로 매핑돼 있다.

`OrderController.place`:

```ts
  /**
   * 주문 생성이 곧 사가다. 결제 거절이어도 **201이다** — 주문은 만들어졌고 주문
   * 번호가 있다. 4xx로 만들면 클라이언트가 번호를 받지 못해 "다시 시도" 화면을
   * 그릴 수 없다. 본문의 `status`가 결과를 말한다.
   */
  @Post()
  @HttpCode(201)
  async place(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(placeOrderBodySchema)) body: PlaceOrderBody,
  ): Promise<PlaceOrderResultDto> {
    return this.placeOrder.execute({
      customerId: principal.customerId,
      addressId: body.addressId,
    });
  }
```

- [ ] **Step 4: 모듈을 배선한다**

`ordering.module.ts`는 프로바이더가 많다. **`inject:` 배열이 생성자 인자 순서와 위치별로 일치해야 한다** — `PlaceOrderService`는 인자가 열 개이고 그중 넷이 ACL이라, 하나만 뒤바뀌어도 타입 검사는 통과하고 런타임에만 깨진다. 각 프로바이더 위에 생성자 시그니처를 주석으로 적는다.

```ts
    {
      // 생성자: PlaceOrderService(carts, orders, catalog, addresses, inventory,
      //                           payments, transactions, events, clock, ids)
      provide: PLACE_ORDER_USECASE,
      useFactory: (
        carts: CartRepository,
        orders: OrderRepository,
        catalog: CatalogPriceProvider,
        addresses: CustomerAddressProvider,
        inventory: InventoryReserver,
        payments: PaymentGateway,
        transactions: TransactionManager,
        events: DomainEventPublisher,
        clock: Clock,
        ids: IdGenerator,
      ) =>
        new PlaceOrderService(
          carts, orders, catalog, addresses, inventory,
          payments, transactions, events, clock, ids,
        ),
      inject: [
        CART_REPOSITORY,
        ORDER_REPOSITORY,
        CATALOG_PRICE_PROVIDER,
        CUSTOMER_ADDRESS_PROVIDER,
        INVENTORY_RESERVER,
        PAYMENT_GATEWAY,
        TRANSACTION_MANAGER,
        DOMAIN_EVENT_PUBLISHER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
```

`OrderingModule`의 `imports`에 `CatalogModule`, `CustomerModule`, `InventoryModule`, `PaymentModule`을 넣는다 — 네 ACL이 그 모듈들의 `exports`를 해석한다.

`ordering/index.ts`는 **`OrderingModule`만 내보낸다.** ordering은 Core이고 아무도 그것을 부르지 않는다 — 역방향은 전부 이벤트다(스펙 §4.1).

`app.module.ts`의 `imports`에 `OrderingModule`을 더한다.

- [ ] **Step 5: 통합 테스트를 쓴다**

`cart.controller.integration.spec.ts`와 `order.controller.integration.spec.ts` — 계획 3의 `stock.controller.integration.spec.ts` 골격을 따른다(`workerDatabaseName()`으로 `DATABASE_URL`을 바꾸고 `afterAll`에서 복원).

장바구니:
- 담기 → 204, 조회하면 줄이 있다
- 조회 응답을 `cartContract.get.responses[200]`로 파싱한다 (서버를 자기 계약에 묶는다)
- 장바구니가 없어도 조회는 200이고 `lines`가 비어 있다
- 수량 변경 → 204 / 없는 줄이면 404
- 삭제 → 204
- 토큰 없이 → 401 `UNAUTHENTICATED`
- 수량 0으로 담기 → 400 `VALIDATION_FAILED`

주문:
- **빈 장바구니로 주문 → 422 `DOMAIN_RULE_VIOLATED`**
- 남의 주문 조회 → 403 `FORBIDDEN`
- 없는 주문 조회 → 404
- 목록의 `limit`이 100을 넘으면 → 400 (Zod가 막는다)
- 경로 파라미터가 uuid가 아니면 → 400

**성공 경로 주문은 여기서 테스트하지 않는다** — 상품·재고·주소가 모두 필요하고, 그것은 태스크 20의 사가 E2E가 한다. 여기서는 컨트롤러의 배선과 에러 표면만 확인한다.

`app.module.spec.ts`에 더한다: 두 컨트롤러가 해석된다 / ordering 에러 매핑 다섯 개가 등록돼 있다 / `PLACE_ORDER_USECASE`가 `PlaceOrderService`로 해석된다.

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

**(a) `inject:` 순서가 맞는가**
`PLACE_ORDER_USECASE` 프로바이더의 `inject` 배열에서 `CATALOG_PRICE_PROVIDER`와 `CUSTOMER_ADDRESS_PROVIDER`의 순서를 바꾼다.
Expected: **타입 검사는 통과한다.** 두 포트의 타입이 다르므로 `useFactory`의 파라미터 타입과 어긋나지만 Nest의 `inject`는 타입으로 검증되지 않는다. **실패는 런타임에만 난다** — `app.module.spec.ts`가 `PLACE_ORDER_USECASE`를 해석하는 순간이거나, 더 나쁘게는 태스크 20의 E2E에서 주소 조회가 가격 조회를 부르며 터진다. 어느 시점에 잡히는지 관측하고 보고서에 적는다.
되돌린다.

**(b) 결제 거절이 201인가**
`OrderController.place`의 `@HttpCode(201)`을 지운다(Nest의 POST 기본값은 201이므로 변화가 없을 수 있다). 대신 `PlaceOrderService`가 `PAYMENT_FAILED`일 때 던지도록 바꾼다.
Expected: FAIL — 태스크 12의 `'거절되면 주문이 PAYMENT_FAILED로 끝나고 예외를 던지지 않는다'`가 실패한다. 이 프루브는 컨트롤러가 아니라 서비스가 지키는 성질임을 확인한다.
되돌린다.

**(c) `customerId`가 응답에 새지 않는가**
`orderDtoSchema`에 `customerId: z.string().uuid()`를 더하고 컨트롤러의 `toDto`가 그것을 담게 한다.
Expected: **통과한다.** 응답에 필드가 늘어도 `.strict()`는 파싱 실패를 내지 않는다(스키마가 그 필드를 허용하도록 바꿨으므로). 관측 결과를 보고서에 적고, **와이어에 무엇이 나가는지를 지키는 것은 스키마이지 테스트가 아니라는 사실**을 기록한다. 되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 순환 없음을 확인한다 — ordering이 넷을 import하고 그 넷은 ordering을 모른다.

```bash
git add apps/api/src packages/contracts/src
git commit -m "feat(ordering): 장바구니·주문 계약과 컨트롤러를 배선한다"
```

---

### Task 20: 사가 E2E — 성공 경로

**Files:**
- Create: `apps/api/test/saga/saga-support.ts`
- Create: `apps/api/test/saga/place-order.e2e.spec.ts`

**Interfaces:**
- Produces: `SagaHarness` — `boot()`, `signUp(email)`, `registerProduct(...)`, `registerStock(...)`, `addAddress(...)`, `addToCart(...)`, `placeOrder(...)`, `drainOutbox()`, `stockOf(skuId)`, `orderOf(orderId)`, `close()`

**이 태스크가 사가를 처음으로 끝까지 관통시킨다.** 지금까지의 테스트는 각 조각을 fake로 둘러싸고 확인했다. 여기서는 **실제 Nest 앱 + 실제 Postgres + 실제 outbox 릴레이 + 실제 `EventEmitter2`**를 지나간다.

**`drainOutbox()`가 이 하니스의 핵심이다.** 스케줄러는 테스트에서 꺼져 있다(계획 3의 `SCHEDULERS_ENABLED=false`). 이벤트를 흘리려면 릴레이를 **명시적으로** 돌려야 하고, 그것이 테스트를 결정론적으로 만든다 — 5초 주기를 기다리는 테스트는 느리고 불안정하다.

```ts
  /**
   * outbox를 비운다. 구독자가 새 이벤트를 낳으므로(OrderPaid → 예약 확정 → …)
   * 더 이상 보낼 것이 없을 때까지 반복한다.
   *
   * 상한이 있는 이유: 구독자가 자기가 소비한 이벤트를 다시 발행하는 버그가 있으면
   * 이 루프가 영원히 돈다. 상한에 걸리면 그 자체가 발견이다.
   */
  async drainOutbox(maxRounds = 10): Promise<number> {
    const relay = this.app.get(OutboxRelay);
    let total = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const sent = await relay.relayOnce();
      total += sent;
      if (sent === 0) {
        return total;
      }
    }
    throw new Error(`outbox가 ${maxRounds}회 안에 비워지지 않았습니다 (총 ${total}건 발행).`);
  }
```

- [ ] **Step 1: 하니스를 쓴다**

`saga-support.ts`가 하는 일:

- `Test.createTestingModule({ imports: [AppModule] })`로 앱을 띄우고 `DATABASE_URL`을 워커 DB로 바꾼다 (계획 3의 컨트롤러 통합 spec과 같은 형태, `afterAll`에서 복원)
- `signUp(email)` → `POST /auth/sign-up`으로 액세스 토큰과 `customerId`를 얻는다
- `registerProduct({ name, skus })` → `POST /products`, 반환된 SKU id 목록
- `registerStock(skuId, onHand)` → `POST /stock`
- `addAddress(token, details)` → `POST /addresses`, 반환된 `addressId`
- `addToCart(token, skuId, quantity)` → `POST /cart/items`
- `placeOrder(token, addressId)` → `POST /orders`
- `stockOf(token, skuId)` → `GET /stock/:skuId`
- `orderOf(token, orderId)` → `GET /orders/:orderId`
- `pg()` → `this.app.get(FakePgAdapter)` — 시나리오를 바꾸는 통로
- `drainOutbox()` — 위 코드

**모든 준비를 HTTP로 한다.** 원시 SQL로 데이터를 심으면 매퍼와 유스케이스를 건너뛰고, 그러면 E2E가 "우리 API가 실제로 이 흐름을 지원하는가"를 검증하지 못한다.

- [ ] **Step 2: 성공 경로 E2E를 쓴다**

```ts
describe('사가 — 주문 성공', () => {
  it('장바구니 → 주문 → 결제 승인 → 예약 확정까지 관통한다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-success@example.com');
      const addressId = await harness.addAddress(token);

      // 1) 주문 = 사가
      const placed = await harness.placeOrder(token, addressId);
      expect(placed.status).toBe('PAID');

      // 2) 이 시점에는 예약이 잡혀 있고 아직 확정되지 않았다.
      //    OrderPaid는 outbox에 있을 뿐 아직 배달되지 않았다.
      const beforeDrain = await harness.stockOf(token, skuId);
      expect(beforeDrain).toEqual({ skuId, onHand: 10, reserved: 3, available: 7 });

      // 3) 릴레이를 돌려 이벤트를 배달한다.
      await harness.drainOutbox();

      // 4) 예약이 확정되어 보유량이 차감됐다.
      const afterDrain = await harness.stockOf(token, skuId);
      expect(afterDrain).toEqual({ skuId, onHand: 7, reserved: 0, available: 7 });

      // 5) 주문 상세가 스냅샷을 담고 있다.
      const order = await harness.orderOf(token, placed.orderId);
      expect(order.total).toEqual({ amount: '36000', currency: 'KRW' });
      expect(order.lines[0]?.nameSnapshot).toBe('티셔츠 RED-M');
      expect(order.shippingAddress.recipient).toBe('홍길동');

      // 6) 장바구니가 비었다.
      expect((await harness.cartOf(token)).lines).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('상품 가격이 바뀌어도 과거 주문 금액은 그대로다', async () => {
    // 스펙 §5.3의 스냅샷 규칙. 이것이 깨지면 회계가 무너진다.
    const harness = await SagaHarness.boot();
    try {
      const { token, productId, skuId } = await scenario(harness, 'saga-snapshot@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      await harness.changePrice(token, productId, skuId, { amount: '99000', currency: 'KRW' });

      const order = await harness.orderOf(token, placed.orderId);
      expect(order.total).toEqual({ amount: '36000', currency: 'KRW' });
      expect(order.lines[0]?.unitPrice).toEqual({ amount: '12000', currency: 'KRW' });
    } finally {
      await harness.close();
    }
  });

  it('outbox가 두 번 배달돼도 재고가 두 번 차감되지 않는다', async () => {
    // at-least-once 멱등성. 편차 5(SKIP LOCKED를 넣지 않는다)를 갚는 자리다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-redeliver@example.com');
      await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();
      const afterFirst = await harness.stockOf(token, skuId);

      // 릴레이가 두 번 집는 상황을 재현한다 — 인스턴스가 둘일 때 실제로 일어난다.
      await harness.resetPublished('ordering.OrderPaid');
      await harness.drainOutbox();

      expect(await harness.stockOf(token, skuId)).toEqual(afterFirst);
    } finally {
      await harness.close();
    }
  });
});
```

**`scenario`와 `resetPublished`를 하니스에 더한다.**

```ts
/** 세 케이스가 공유하는 준비. 상품 1종·SKU 1개·재고 10·장바구니 3개. */
async function scenario(harness: SagaHarness, email: string) {
  const { token, customerId } = await harness.signUp(email);
  const { productId, skuIds } = await harness.registerProduct(token, {
    name: '티셔츠',
    skus: [{ code: 'RED-M', price: { amount: '12000', currency: 'KRW' } }],
  });
  const skuId = skuIds[0] as string;
  await harness.registerStock(token, skuId, 10);
  await harness.addToCart(token, skuId, 3);
  return { token, customerId, productId, skuId };
}
```

```ts
  /**
   * 이미 발행된 이벤트를 미발행으로 되돌린다. 릴레이 인스턴스가 둘일 때 같은 행을
   * 둘 다 집는 상황과 같다 — 편차 5가 감수하기로 한 바로 그 시나리오다.
   */
  async resetPublished(eventType: string): Promise<void> {
    const prisma = this.app.get(PrismaService);
    await prisma.outbox.updateMany({
      where: { eventType },
      data: { publishedAt: null, attempts: 0, nextAttemptAt: null },
    });
  }
```

`changePrice(token, productId, skuId, price)`는 `PUT /products/:productId/skus/:skuId/price`를 부른다. `registerProduct`는 `{ productId, skuIds }`를 돌려주도록 Step 1의 시그니처를 맞춘다.

- [ ] **Step 3: 통과를 확인한다**

Run: `pnpm test:int apps/api/test/saga`
Expected: PASS

**이 스위트가 처음 실행될 때 태스크 18의 이벤트 이름 오타가 드러난다.** 구독자가 안 불리면 4단계에서 `reserved`가 3으로 남는다.

- [ ] **Step 4: 이 검사가 무엇을 잡는지 증명한다**

**(a) 이벤트 이름이 실제로 연결돼 있는가 — 태스크 18의 프루브 (b)를 여기서 끝낸다**
`InventoryEventSubscriber`의 `@OnEvent('ordering.OrderPaid')`를 `@OnEvent('ordering.OrderPayed')`로 바꾼다.
Expected: FAIL — 4단계가 `{ onHand: 10, reserved: 3 }`을 받아 실패한다. **태스크 18에서 "단위 테스트로는 잡히지 않는다"고 기록한 오타를 이 스위트가 잡는다.**
되돌린다.

**(b) 릴레이가 실제로 필요한가**
2단계의 단언(`beforeDrain`)이 `{ onHand: 7 }`을 기대하도록 바꾼다.
Expected: FAIL — `reserved: 3, onHand: 10`을 받는다. **이 관측이 사가의 비동기성을 증명한다** — 주문 응답이 `PAID`로 돌아온 시점에 재고는 아직 차감되지 않았다. 되돌린다.

**(c) 스냅샷이 진짜 스냅샷인가**
`InProcessCatalogAdapter`가 `nameSnapshot` 대신 `view.skuCode`만 담게 바꾼다.
Expected: FAIL — 5단계가 `'티셔츠 RED-M'` 대신 `'RED-M'`을 받아 실패한다.
되돌린다.

- [ ] **Step 5: 전체 검증과 커밋**

```bash
git add apps/api/test/saga
git commit -m "test(saga): 주문 성공 경로를 E2E로 관통한다"
```

---

### Task 21: 사가 E2E — 보상 경로 셋

**Files:**
- Create: `apps/api/test/saga/payment-declined.e2e.spec.ts`
- Create: `apps/api/test/saga/cancel-paid-order.e2e.spec.ts`
- Create: `apps/api/test/saga/reservation-expiry.e2e.spec.ts`

**스펙 §13의 성공 기준 셋이 여기서 참이 된다.**

- 결제 거절 시 재고 예약이 해제되고 주문이 `PAYMENT_FAILED`로 끝남
- `PAID` 상태 주문 취소 시 환불되고 재고가 복원됨
- 예약 TTL이 만료되면 스케줄러가 재고를 자동 회복함 (계획 3이 재고 쪽을 증명했고, 여기서 **주문까지** 이어지는 것을 본다)

- [ ] **Step 1: 결제 거절 보상**

```ts
describe('사가 — 결제 거절 보상', () => {
  it('거절되면 주문이 PAYMENT_FAILED로 끝나고 예약이 해제된다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-declined@example.com');
      // FakePgAdapter를 DI에서 꺼내 시나리오를 바꾼다. 매직 금액을 쓰지 않는
      // 이유는 fake-pg.adapter.ts의 주석에 있다.
      harness.pg().scenario = 'DECLINE';

      const placed = await harness.placeOrder(token, await harness.addAddress(token));

      // 주문은 만들어졌다. 4xx가 아니라 201이고 상태가 결과를 말한다.
      expect(placed.status).toBe('PAYMENT_FAILED');

      // 이 시점에 예약은 아직 잡혀 있다 — 해제는 이벤트로 간다.
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 3 });

      await harness.drainOutbox();

      // 예약이 해제되어 재고가 완전히 돌아왔다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 10,
        reserved: 0,
        available: 10,
      });
    } finally {
      await harness.close();
    }
  });

  it('거절 사유가 주문에 남는다', async () => {
    // 사용자가 왜 실패했는지 알 수 있어야 한다. FakePgAdapter의 거절 사유가
    // OrderPaymentFailed의 payload를 거쳐 주문까지 도달하는지 확인한다.
    const harness = await SagaHarness.boot();
    try {
      const { token } = await scenario(harness, 'saga-declined-reason@example.com');
      harness.pg().scenario = 'DECLINE';
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      const order = await harness.orderOf(token, placed.orderId);
      expect(order.status).toBe('PAYMENT_FAILED');
    } finally {
      await harness.close();
    }
  });

  it('재고가 부족하면 주문 자체가 만들어지지 않고 재고가 그대로다', async () => {
    // 예약 단계 실패는 이벤트가 아니라 예외로 나간다 — 주문이 완성되기 전이다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-oos@example.com');
      // 장바구니에 3개가 담겨 있다. 재고를 1로 만든다.
      await harness.setStock(token, skuId, 1);

      await expect(
        harness.placeOrder(token, await harness.addAddress(token)),
      ).rejects.toMatchObject({ status: 409 });

      expect(await harness.stockOf(token, skuId)).toMatchObject({ reserved: 0 });
      expect(await harness.listOrders(token)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});
```

`setStock(token, skuId, onHand)`은 하니스에 더한다 — `POST /stock`이 이미 있으면 409이므로, **새 SKU를 다른 재고로 등록하는 헬퍼**로 만든다. 그편이 `scenario`를 고치지 않고 재고 부족을 만들 수 있다. 구현자는 `scenario`에 `onHand` 인자를 더하는 쪽을 택해도 된다 — 둘 중 하나를 고르고 이유를 보고서에 적는다.

- [ ] **Step 2: PAID 주문 취소 → 환불 + 재고 복원**

```ts
describe('사가 — PAID 주문 취소', () => {
  it('취소하면 REFUND_PENDING이 되고, 환불이 끝나면 REFUNDED가 되며 재고가 복원된다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();
      // 확정되어 보유량이 차감된 상태에서 시작한다.
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 7, reserved: 0 });

      // 1) 취소 요청 — 편차 1의 중간 상태
      const cancelled = await harness.cancelOrder(token, placed.orderId);
      expect(cancelled.status).toBe('REFUND_PENDING');

      // 2) OrderCancelled 배달 → Payment 환불 + Inventory 복원
      //    → PaymentRefunded 배달 → 주문 REFUNDED
      await harness.drainOutbox();

      expect((await harness.orderOf(token, placed.orderId)).status).toBe('REFUNDED');
      // 확정으로 차감됐던 보유량이 되돌아왔다 — release가 아니라 restore다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 10,
        reserved: 0,
        available: 10,
      });
      expect(harness.pg().refundedTxIds).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('취소를 두 번 요청해도 환불은 한 번이고 재고도 한 번만 복원된다', async () => {
    // 편차 5를 갚는 두 번째 자리다. 취소 요청이 둘, OrderCancelled 배달도 둘일 수 있다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel-twice@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      await harness.cancelOrder(token, placed.orderId);
      await harness.cancelOrder(token, placed.orderId);
      await harness.drainOutbox();
      await harness.resetPublished('ordering.OrderCancelled');
      await harness.drainOutbox();

      expect(harness.pg().refundedTxIds).toHaveLength(1);
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10 });
    } finally {
      await harness.close();
    }
  });

  it('결제 전 주문을 취소하면 CANCELLED가 되고 예약만 해제된다 — 환불은 없다', async () => {
    // 스펙 §5.4의 표: PENDING_PAYMENT 취소는 "예약 해제만. 돈이 안 오갔음".
    // PG를 TIMEOUT으로 두어 주문을 PENDING_PAYMENT로 남긴 뒤 취소한다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel-pending@example.com');
      harness.pg().scenario = 'TIMEOUT';
      await harness
        .placeOrder(token, await harness.addAddress(token))
        .catch(() => undefined);

      const [summary] = await harness.listOrders(token);
      expect(summary?.status).toBe('PENDING_PAYMENT');

      harness.pg().scenario = 'APPROVE';
      const cancelled = await harness.cancelOrder(token, summary?.id as string);
      expect(cancelled.status).toBe('CANCELLED');

      await harness.drainOutbox();

      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 0 });
      expect(harness.pg().refundedTxIds).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});
```

**세 번째 케이스에 주의.** PG 타임아웃 경로는 `PlaceOrderService`가 예약을 이미 풀었다(태스크 12). 그러므로 취소 시점에 예약은 `RELEASED`이고, `OrderCancelled(wasPaid: false)` → `release`가 다시 불려 `false`를 돌려준다 — 재고는 이미 돌아와 있다. **이 케이스가 검증하는 것은 "재고가 돌아왔다"가 아니라 "환불이 일어나지 않았다"이다.** 그 사실을 테스트 주석에 적는다.

- [ ] **Step 3: TTL 만료 → 주문 실패**

```ts
describe('사가 — 예약 TTL 만료', () => {
  it('만료되면 재고가 회복되고 주문이 PAYMENT_FAILED로 끝난다', async () => {
    // 계획 3이 재고 회복까지 증명했다. 여기서는 그 이벤트가 Ordering에 도달해
    // 주문까지 끝내는지를 본다 — 스펙 §5.6의 마지막 줄이다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-expiry@example.com');
      harness.pg().scenario = 'TIMEOUT';
      await harness
        .placeOrder(token, await harness.addAddress(token))
        .catch(() => undefined);
      const [summary] = await harness.listOrders(token);

      // 예약을 강제로 만료시킨다. 15분을 기다릴 수는 없다.
      await harness.expireReservations(summary?.id as string);
      await harness.runExpiryScan();
      await harness.drainOutbox();

      expect((await harness.orderOf(token, summary?.id as string)).status).toBe('PAYMENT_FAILED');
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 0 });
    } finally {
      await harness.close();
    }
  });
});
```

하니스에 둘을 더한다.

```ts
  /**
   * 예약의 `expires_at`을 과거로 민다. `Clock`을 조작하는 대신 데이터를 미는 이유:
   * 앱이 `SystemClock`으로 배선돼 있고, E2E는 배선을 바꾸지 않는 것이 목적이다.
   * 이 스위트가 검증하는 것은 시간 계산이 아니라 **이벤트 체인**이다.
   */
  async expireReservations(orderId: string): Promise<void> {
    const prisma = this.app.get(PrismaService);
    await prisma.reservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }

  /** 만료 스캔을 한 번 돌린다. 스케줄러는 테스트에서 꺼져 있다(계획 3). */
  async runExpiryScan(): Promise<number> {
    return this.app.get<ExpireReservationsUseCase>(EXPIRE_RESERVATIONS_USECASE).execute();
  }
```

**PG를 `TIMEOUT`으로 두어 주문을 `PENDING_PAYMENT`로 남기는 것이 이 시나리오의 전제다.** 결제가 성공하면 예약이 확정되어 만료 대상이 아니다.

- [ ] **Step 4: 이 검사가 무엇을 잡는지 증명한다**

**(a) `wasPaid` 분기가 실제 경로에서 동작하는가 — 태스크 18의 프루브 (a)를 실경로에서 확인한다**
`InventoryEventSubscriber.onOrderCancelled`를 항상 `releaseForOrder`를 부르게 바꾼다.
Expected: FAIL — `'취소하면 … 재고가 복원된다'`가 `onHand: 7`을 받아 실패한다. 로그에는 `ReservationConflictError`가 남는다(`CONFIRMED`에 `release`를 시도했다). **재고가 영영 돌아오지 않는 회귀다.**
되돌린다.

**(b) 결제 거절이 예약을 실제로 푸는가**
`PlaceOrderService`가 `failPayment` 대신 `markPaid`를 부르게 바꾼다... 는 너무 크다. 대신 `InventoryEventSubscriber`의 `@OnEvent('ordering.OrderPaymentFailed')` 핸들러를 지운다.
Expected: FAIL — 결제 거절 E2E가 `reserved: 3`을 받아 실패한다. **이 회귀는 거절된 주문마다 재고를 15분씩 묶는다** — TTL이 결국 회수하지만 그 사이 팔 수 있는 재고가 줄어든다.
되돌린다.

**(c) 환불 멱등성이 실경로에서 동작하는가**
`Payment.refund`의 `if (this.statusValue === 'REFUNDED') return false;`를 지운다.
Expected: FAIL — `'취소를 두 번 요청해도 환불은 한 번'`이 실패한다. 태스크 3의 프루브 (a)가 단위 수준에서 잡은 것과 같은 회귀를 **실제 이벤트 재배달 경로**에서 확인한다.
되돌린다.

**(d) TTL 만료가 주문까지 이어지는가**
`OrderingEventSubscriber`의 `@OnEvent('inventory.StockReservationExpired')` 핸들러를 지운다.
Expected: FAIL — 만료 E2E가 주문 상태 `PENDING_PAYMENT`를 받아 실패한다. **재고는 회복되는데 주문이 영원히 결제 대기로 남는 회귀다** — 계획 3이 이벤트를 발행했지만 구독자가 없었을 때의 상태가 정확히 이것이다.
되돌린다.

- [ ] **Step 5: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/test/saga
git commit -m "test(saga): 결제 거절·주문 취소·TTL 만료 보상 경로를 E2E로 검증한다"
```

---

### Task 22: 마무리 — 완료 기준 점검과 문서

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-03-payment-ordering-saga.md` (부록)

- [ ] **Step 1: 완료 기준을 하나씩 실제로 확인한다**

아래를 명령으로 확인하고 결과를 보고서에 적는다. **"통과했을 것"이 아니라 관측한 것만 적는다.**

**기능 (스펙 §13)**

| 기준 | 확인 방법 |
|---|---|
| 주문 성공 경로가 관통한다 | `apps/api/test/saga/place-order.e2e.spec.ts` |
| 결제 거절 시 예약 해제 + `PAYMENT_FAILED` | `payment-declined.e2e.spec.ts` |
| `PAID` 취소 시 환불 + 재고 복원 | `cancel-paid-order.e2e.spec.ts` |
| TTL 만료 시 재고 회복 + 주문 실패 | `reservation-expiry.e2e.spec.ts` |
| 주문에 주소가 스냅샷으로 남는다 | `place-order.e2e.spec.ts`의 5단계 |

**아키텍처**

```bash
pnpm arch:check
grep -rn "from '@nestjs\|from '@prisma/client'\|from '@commerce/contracts'" apps/api/src/modules/*/domain/ | grep -v '\.spec\.ts'
grep -rn "from '\.\./\.\./\(catalog\|customer\|identity\|inventory\|payment\|ordering\)" apps/api/src/modules/*/domain/
```

세 번째는 **0건이어야 한다** — `domain-imports-no-other-module`이 강제하지만 눈으로도 확인한다.

`InProcessInventoryAdapter` 한 파일만 고쳐 호출 경로를 바꿀 수 있는지: **그 파일의 생성자 인자를 `ReserveStockUseCase`에서 HTTP 클라이언트로 바꾸는 상상 실험을 하고, 다른 파일이 바뀌어야 하는지 세어 보고서에 적는다.** 0이면 성공 기준을 만족한다.

**테스트**

```bash
pnpm test:coverage
```

`modules/*/domain/**` 95/90, `modules/*/application/**` 90/85가 통과하는지 확인한다. **ordering의 도메인 커버리지를 따로 적는다** — Core 컨텍스트이므로 이 숫자가 이 프로젝트의 품질 주장이다.

Outbox 원자성(스펙 §9.8의 "트랜잭션 롤백 시 이벤트 row도 사라짐")은 계획 1이 이미 검증했다. **그 테스트가 여전히 있는지 확인하고 파일 경로를 적는다.**

**산출물**

- README에 사가 흐름 설명이 있는가
- 계획 3이 남긴 벤치마크 표가 그대로 있는가

- [ ] **Step 2: README에 사가 절을 더한다**

락 전략 벤치마크 절 **앞에** 넣는다 — 사가가 이 프로젝트의 주제이고 벤치마크는 그 안의 한 조각이다.

```markdown
## 주문 사가

주문·재고·결제는 서로 다른 애그리거트이고 다른 컨텍스트에 있다. 결제는 외부 PG
호출이라 원칙 이전에 물리적으로 한 트랜잭션에 넣을 수 없다 — 외부 응답을 기다리며
DB 트랜잭션을 열어두면 커넥션 풀이 말라죽는다.

예약 기반 사가 + 보상 트랜잭션으로 푼다.

​```
1. Order 생성                 PENDING_PAYMENT      [트랜잭션 1]
2. 줄마다 재고 예약            Reservation, TTL 15분 [Inventory의 트랜잭션]
3. 결제 승인                   외부 PG               [트랜잭션 없음]
4a. 승인 → markPaid()          → OrderPaid          [트랜잭션 3]
        → Inventory 구독 → 예약 확정 (재고 차감)
4b. 거절 → failPayment()       → OrderPaymentFailed [트랜잭션 3]
        → Inventory 구독 → 예약 해제
5. 어느 단계가 유실돼도 → TTL 만료 스캔이 예약을 회수하고
                          StockReservationExpired가 주문을 실패로 끝낸다
​```

**5번이 설계의 요체다.** 보상 트랜잭션 자체가 실패해도(서버가 죽어도) TTL이 결국
재고를 회복시킨다. 보상 로직을 신뢰할 수 없다는 전제로 설계했다.

`Order`의 상태 머신이 사가 상태를 겸한다 — 별도 사가 엔티티가 없다.

​```
PENDING_PAYMENT ─결제 승인─→ PAID ─취소─→ REFUND_PENDING ─환불 완료─→ REFUNDED
       │                                          
       ├─결제 거절 / TTL 만료─→ PAYMENT_FAILED
       └─취소─→ CANCELLED
​```

`REFUND_PENDING`은 취소 요청과 환불 완료 사이의 상태다. 없으면 그 구간에 주문이
`PAID`로 남아 고객에게 거짓말을 하고, 취소가 멱등하지 않아 이벤트가 두 번 배달될 때
환불이 두 번 요청된다.

### 이벤트가 유실되지 않는 이유

상태 변경과 이벤트 발행이 **같은 트랜잭션**에서 일어난다(outbox 패턴). 별도 릴레이가
`published_at IS NULL`인 행을 폴링해 발행한다. 전달 보장은 at-least-once이므로
**구독자가 멱등해야 한다** — `Reservation`·`Order`·`Payment`의 전이 메서드가 전부
"이미 그 상태면 `false`"를 돌려주는 것이 그 요구를 갚는다.

재현: `pnpm test:int apps/api/test/saga`
```

README의 백틱 세 개는 실제 파일에서는 이스케이프 없이 쓴다 — 위 블록의 `​```는 문서 안에 코드 펜스를 중첩해 보이기 위한 표기다.

**구조 절의 "구현된 바운디드 컨텍스트" 문장을 갱신한다** — 여섯 컨텍스트가 전부 구현됐고, 남은 것은 프론트엔드 상점과 Playwright E2E(계획 5)다.

- [ ] **Step 3: 이월을 부록에 적는다**

이 계획을 실행하며 새로 생긴 것을 계획 문서 끝에 부록으로 남긴다. 최소한 다음은 반드시 포함한다.

- **`ProductQuery.findSkus`의 N+1을 잡는 장치가 없다** (태스크 16 프루브 b)
- **예약 전이의 동시성 스위트가 없다** (태스크 17 프루브 b) — 계획 3이 재고에 대해 만든 것과 같은 것이 예약 상태 전이에는 없다
- **`OutboxRelay`에 `SKIP LOCKED`가 없다** (편차 5) — 소비자 멱등성으로 갚았고 태스크 20·21이 그것을 검증했다
- **PG 웹훅이 주문을 움직이지 않는다** (편차 3) — 비동기 승인 경로는 백로그
- **PG 웹훅에 서명 검증이 없다** (태스크 6) — 이 엔드포인트는 공개돼 있다
- **역할 기반 인가가 없다** (편차 6)
- **부분 환불이 없다** (편차 4)
- 실행 중 발견한 것들

- [ ] **Step 4: 커밋**

```bash
git add README.md docs
git commit -m "docs: 주문 사가 설명과 계획 4 완료 기준 점검 결과를 남긴다"
```

---

## 완료 기준

이 계획이 끝났을 때 **스펙 §13의 성공 기준 중 다음이 참이어야 한다.**

**기능**
- 장바구니 → 주문 → 결제 성공 → 예약 확정이 API 레벨 E2E로 통과
- 결제 거절 시 재고 예약이 해제되고 주문이 `PAYMENT_FAILED`로 끝남
- `PAID` 상태 주문 취소 시 환불되고 재고가 복원됨
- 예약 TTL이 만료되면 재고가 회복되고 주문이 실패로 끝남
- 주문에 가격과 주소가 스냅샷으로 남고, 원본이 바뀌어도 따라 바뀌지 않음

**아키텍처**
- `pnpm arch:check` 통과, 순환 없음
- `modules/*/domain/**`에 `@nestjs`·`@prisma/client`·contracts import 0건
- 도메인이 다른 컨텍스트를 공개 API로도 부르지 않음
- `InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음

**테스트**
- 같은 계약 테스트가 in-memory와 Prisma 리포지토리 양쪽에서 통과 (`Cart`, `Order`, `Payment`)
- 같은 이벤트가 두 번 배달돼도 부수 효과가 한 번만 남음 (재고·환불 양쪽에서 확인)
- `modules/*/domain/**` 95%/90%, `modules/*/application/**` 90%/85%

**산출물**
- README에 사가 흐름과 상태 머신 설명

**계획 5로 넘어가는 것**: 프론트엔드 상점 UI(FSD `entities`/`features`/`widgets`/`views`), MSW 핸들러의 계약 검증(스펙 §9.9), Playwright 브라우저 E2E 6~8 시나리오(스펙 §9.10), `docs/architecture.svg` 생성(graphviz가 있는 환경).
