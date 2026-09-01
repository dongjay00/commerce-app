# 커머스 주문 파이프라인 — 설계 스펙

- 작성일: 2026-09-01
- 상태: 설계 확정, 구현 계획 대기
- 범위: 첫 번째 구현 사이클

---

## 1. 개요

### 1.1 목적

헥사고날 아키텍처(포트 & 어댑터)와 DDD 전술 패턴을 실제로 값을 하는 수준까지 적용한
커머스 백엔드와, Feature-Sliced Design으로 구성한 프론트엔드를 만든다.
학습과 포트폴리오가 1차 목표이며, 실서비스 운영은 목표가 아니다.

"폴더만 헥사고날이고 내부는 트랜잭션 하나로 처리하는" 프로젝트가 되지 않는 것이
이 스펙의 가장 중요한 성공 기준이다.

### 1.2 범위

주문 파이프라인을 세로로 관통한다.

```
회원가입/로그인 → 상품 조회 → 장바구니 → 주문 생성
  → 재고 예약 → 결제(가짜 PG) → 재고 확정 → 주문 완료
  → 취소 → 환불 → 재고 복원
```

넓게 얕게가 아니라 좁게 깊게 간다. 동시성, 트랜잭션 경계, 분산 실패 처리가
실제로 드러나는 구간만 고른 결과다.

### 1.3 범위 밖 (백로그)

| 항목 | 비고 |
|---|---|
| 소셜 로그인(OAuth) | `IdentityProvider` 포트만 만들고 어댑터는 나중에. 헥사고날 가치 증명용으로 의도적으로 남김 |
| 이메일 발송 | `EmailSender` 포트 + `ConsoleEmailSender`만 |
| 2FA, 계정 잠금 정책 | |
| 익명 장바구니 및 로그인 시 병합 | 로그인 필수로 시작 |
| 배송, 반품, 리뷰, 쿠폰/프로모션 | |
| 실제 PG 연동 | `PgClient` 포트 뒤에 `FakePgAdapter`만 |
| 브라우저 PGlite 데모 | 채용 리뷰어용 무설치 데모. 후반 과제 |
| 관리자 화면 | 최소 API만 |

### 1.4 방법론

| | 담당 | 산출물 |
|---|---|---|
| DDD | 무엇을 만들 것인가 (경계·언어) | 바운디드 컨텍스트, 애그리거트 |
| SDD | 어떤 순서로 만들 것인가 | 이 스펙 → 구현 계획 → 태스크 |
| TDD | 어떻게 만들 것인가 | 실패 테스트 → 구현 → 리팩터 |

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 레포 | pnpm workspace 모노레포 |
| 백엔드 | Nest.js + TypeScript |
| 프론트 | Next.js (App Router), BFF 겸용 |
| DB | PostgreSQL 17 (Docker Compose) |
| ORM | Prisma — 도메인 ↔ 영속 모델 **명시적 매핑** |
| 계약 | ts-rest + Zod (`packages/contracts`) |
| 린트/포맷 | Biome |
| 아키텍처 검증 | dependency-cruiser |
| 테스트 | Vitest (백·프론트 통일) + Testing Library + MSW + Playwright |
| 인증 | Nest가 JWT 발급, Next BFF가 암호화 쿠키로 보관 |

### 2.1 로컬 DB를 PGlite가 아닌 Docker Postgres로 하는 이유

PGlite는 Postgres를 single-user 모드로 돌린다. 쿼리는 락으로 직렬화되어 데이터 손상은
없지만 **동시 트랜잭션이 서로 격리되지 않는다.** v0.4의 커넥션 멀티플렉싱도 뒤에서는
단일 엔진에 직렬 실행이다.

이 프로젝트의 핵심 학습 대상이 재고 경합(`SELECT FOR UPDATE`, 낙관적 락, 격리 수준)이라,
PGlite에서는 관련 테스트가 **락이 걸려서가 아니라 경합이 발생할 수 없어서** 전부 통과한다.
거짓 초록불이 학습 프로젝트에서 가장 나쁜 실패다.

부차적으로 Prisma의 PGlite 어댑터는 커뮤니티 유지보수이고 `prisma migrate`에 우회가 필요하다.
또 헥사고날 구조상 DB에 닿는 테스트 자체가 적어서 PGlite의 속도 이점이 작다.

---

## 3. 아키텍처 개요

### 3.1 백엔드 — 헥사고날 (포트 & 어댑터)

클린 아키텍처와 의존성 규칙은 동일하다. 어휘와 폴더 배치를 헥사고날로 통일한다.

- **대칭성**: HTTP 컨트롤러, 이벤트 핸들러, 스케줄러는 전부 같은 등급의 **인바운드 어댑터**다.
  Prisma 리포지토리, PG 클라이언트는 **아웃바운드 어댑터**다.
- **포트는 `application`이 소유한다.** 애플리케이션이 "이런 게 필요하다"를 선언하고
  어댑터가 그 모양에 맞춘다. 이 방향이 의존성 역전의 전부다.
- **클린에서 빌려오는 것은 유스케이스 개념 하나**다. 인바운드 포트 1개 = 유스케이스 1개.
- 폴더는 레이어 최상위 분리(`src/domain`, `src/application`, ...)가 아니라
  **모듈별 수직 슬라이스**로 간다. 기능 하나가 한 폴더 안에 다 있다.

### 3.2 프론트 — Feature-Sliced Design

프론트에는 헥사고날을 적용하지 않는다. 근거:

1. 프론트의 "도메인"은 서버 도메인의 그림자이고, 보안상 신뢰할 수 없는 사본이다.
   진짜 불변식은 서버에 있어야 한다.
2. App Router가 이미 서버/클라이언트 경계를 강하게 규정한다. 헥사고날을 얹으면 두 아키텍처가 싸운다.
3. "React를 다른 것으로 교체"는 실제로 일어나지 않고, 일어나면 컴포넌트를 전부 다시 쓴다.
   코어 20%를 지켜도 이득이 없다.

대신 프론트용으로 설계된 FSD를 쓴다. 레이어 단방향 의존이라는 원리는 백엔드와 같고,
같은 dependency-cruiser 설정 파일로 강제한다.

| | 백엔드 | 프론트 |
|---|---|---|
| 단위 | 바운디드 컨텍스트 | 슬라이스 |
| 방향 | 안쪽으로만 (domain ← application ← adapters) | 아래로만 (shared ← entities ← features ← widgets ← views) |
| 공개 API | `modules/*/index.ts` | `slices/*/index.ts` |
| 강제 | dependency-cruiser | dependency-cruiser (같은 파일) |

---

## 4. 바운디드 컨텍스트

```
   ┌───────────┐        ┌────────────┐
   │ IDENTITY  │──1:1──▶│  CUSTOMER  │
   │ 자격증명   │ userId │  주소록     │
   │ 세션·토큰  │        └─────┬──────┘
   └─────┬─────┘              │ 배송지 스냅샷 (ACL)
         │ 인증된 principal    │
         ▼                    ▼
   ┌──────────────────────────────────────┐
   │            ORDERING (Core)           │
   │      Cart / Order / 상태 머신         │
   └──┬──────────┬──────────┬─────────────┘
      │ 가격(ACL) │ 재고 예약 │ 결제
      ▼          ▼          ▼
  ┌────────┐ ┌─────────┐ ┌────────┐
  │CATALOG │ │INVENTORY│ │PAYMENT │
  └────────┘ └────┬────┘ └───┬────┘
                  └─ 도메인 이벤트 ─┴──▶ Ordering 구독
```

| 컨텍스트 | 분류 | 투자 수준 | 담는 것 |
|---|---|---|---|
| **Ordering** | **Core** | 도메인 모델 전부 | Cart, Order, 상태 머신, 취소/환불 정책 |
| Customer | Supporting | 애그리거트 1개 | Customer, AddressBook, 기본 배송지 |
| Identity | Generic | 포트 뒤에 가둠 | Account, Session, 토큰 발급/갱신 |
| Inventory | Supporting | 애그리거트 1개 + 동시성 | StockItem, Reservation |
| Catalog | Supporting | 의도적으로 얇게 | Product, Sku, Price |
| Payment | Supporting | 포트 뒤에 숨김 | Payment, PaymentAttempt |

모든 모듈을 똑같이 정성 들이지 않는다. Ordering만 엔티티·VO·불변식·도메인 이벤트를
제대로 갖추고 Catalog는 거의 CRUD로 둔다. Identity를 Generic으로 분류한 것은
나중에 외부 IdP로 통째로 교체되는 게 정상인 자리라는 뜻이다.

### 4.1 컨텍스트 간 통신 규칙

| 통신 | 방식 | 이유 |
|---|---|---|
| 가격 조회, 재고 예약, 결제 승인 | 동기 포트 호출 | 주문 성공 여부가 즉시 결정돼야 함 |
| 재고 확정, 예약 만료, 환불 완료 | 도메인 이벤트 | 후속 처리. 호출자가 기다릴 이유 없음 |

**역방향 의존(Inventory → Ordering)은 반드시 이벤트로만 간다.** 직접 호출을 허용하면
순환 참조가 생기고, dependency-cruiser가 CI에서 막는 첫 번째 규칙이 이것이다.

### 4.2 모듈 간 호출 경로

```
PlaceOrderUseCase
  → InventoryReserver (포트, ordering 소유)
    → InProcessInventoryAdapter (ordering의 어댑터, 5줄 위임)
      → modules/inventory/index.ts (공개 API)
        → ReserveStockUseCase
```

같은 프로세스 안에서 두 겹 감싸는 것은 약간 과하다. 유지하는 이유는 이 5줄이
"Inventory를 별도 서비스로 떼어낼 때 고칠 유일한 파일"이기 때문이다.
이 교체 가능성을 쓰지 않으면 구조 전체가 장식이 된다.

### 4.3 공유 커널

```
shared/kernel/  money.ts  quantity.ts  identifiers.ts
                aggregate-root.ts  domain-event.ts  domain-error.ts
                ports/{clock, id-generator, transaction-manager, domain-event.publisher}
```

들어갈 자격은 **모든 컨텍스트가 똑같은 의미로 쓰는 것**뿐이다. `Money`는 자격이 있고
`Product`는 없다. 공유 커널은 커질수록 컨텍스트 분리를 무의미하게 만들므로
`packages/`가 아니라 눈에 잘 띄는 `src/shared/`에 두고 의식적으로 억제한다.

---

## 5. 도메인 모델

### 5.1 애그리거트 목록

| 컨텍스트 | 애그리거트 루트 | 내부 구성 | 불변식 |
|---|---|---|---|
| ordering | **Cart** | CartLine[] | 같은 SKU 중복 없음, 수량 ≥ 1 |
| ordering | **Order** | OrderLine[](VO), ShippingAddress(VO), OrderStatus | 상태 전이 규칙, 합계 = Σ(단가×수량), 최소 1줄 |
| inventory | **StockItem** | Reservation[] | `reserved ≤ onHand`, `available ≥ 0` |
| payment | **Payment** | PaymentAttempt[] | 승인액 = 주문 금액, 환불 ≤ 승인액 |
| catalog | **Product** | Sku[], Price(VO) | — |
| customer | **Customer** | AddressBook (내부 엔티티) | 기본 배송지는 0 또는 1개 |
| identity | **Account**, **Session** | Credential(VO) | 세션 만료, refresh 회전 |

**애그리거트 간 참조는 무조건 ID로만 한다.** `Order.customer: Customer`는 금지,
`Order.customerId: CustomerId`만 허용한다. 이 규칙이 애그리거트를 작게 유지하고
로딩 범위를 예측 가능하게 만든다.

### 5.2 Cart는 Ordering 컨텍스트 안에 둔다

Cart와 Order는 **다른 애그리거트지만 같은 컨텍스트**다.

- 유비쿼터스 언어를 공유한다 (둘 다 "고객이 사려는 것"). 컨텍스트를 자르는 기준은
  언어가 갈리는 지점인데 여기서는 갈리지 않는다.
- 별도 컨텍스트로 자르면 `Cart → Order` 변환이 컨텍스트 간 통신이 되어 ACL이 하나 더 든다.
- 애그리거트는 확실히 분리한다. Cart는 자주 변하는 임시 상태, Order는 불변 이력.
  트랜잭션 경계가 다르다.

### 5.3 스냅샷 규칙 — 경계를 넘을 때는 값만 복사한다

같은 패턴이 세 곳에 반복된다.

**가격 스냅샷.** Ordering은 Catalog의 `Product`를 절대 참조로 들지 않는다.
들면 상품 가격이 바뀔 때 과거 주문 금액이 따라 바뀐다.

```ts
// ordering/domain/order/order-line.ts
export class OrderLine {           // VO
  constructor(
    readonly skuId: SkuId,
    readonly nameSnapshot: string, // 그때의 이름
    readonly unitPrice: Money,     // 그때의 가격
    readonly quantity: Quantity,
  ) {}
}
```

**주소 스냅샷.** Customer의 `SavedAddress`(id를 가진 엔티티)와
Ordering의 `ShippingAddress`(id 없는 VO)는 별개다. 고객이 이사해서 주소록을 고쳐도
과거 주문의 배송지는 그대로 남는다.

**DTO 경계.** `packages/contracts`에는 DTO만 넣는다. `Money` VO나 `Order` 엔티티를
넣으면 프론트가 도메인 타입에 묶여 도메인 리팩터링마다 깨진다.

### 5.4 Order 상태 머신

```
                    ┌──────────────────┐
   주문 생성 ──────▶ │ PENDING_PAYMENT  │
                    └────┬────────┬────┘
              결제 승인    │        │  결제 실패 / 사용자 취소 / TTL 만료
                         ▼        ▼
                    ┌────────┐  ┌──────────────────────────┐
                    │  PAID  │  │ PAYMENT_FAILED / CANCELLED│
                    └───┬────┘  └──────────────────────────┘
             취소 요청   │            (예약만 해제. 환불 없음)
                        ▼
                    ┌──────────┐
                    │ REFUNDED │  (환불 + 재고 복원)
                    └──────────┘
```

| 취소 시점 | 해야 할 일 |
|---|---|
| PENDING_PAYMENT | 예약 해제만. 돈이 안 오갔음 |
| PAID | 환불 + 재고 복원. 이것도 사가 |
| 배송 이후 | 취소 불가 → 반품 프로세스 (범위 밖) |

상태 전이는 `Order` 애그리거트 안에서만 일어난다. 유스케이스가 `order.status = 'PAID'`를
직접 대입하는 것은 금지하고 `order.markPaid()`만 허용한다.

### 5.5 인가는 두 곳으로 나뉜다

| 규칙 | 위치 | 이유 |
|---|---|---|
| "관리자만 상품 등록 가능" | 어댑터 가드 | 역할 기반. 도메인 개념이 아님 |
| **"본인 주문만 취소 가능"** | **도메인 (`Order.cancelBy()`)** | 주문의 불변식 |

두 번째를 가드로 처리하면 HTTP가 아닌 경로(배치, 이벤트 핸들러, 관리자 CLI)로 들어올 때
규칙이 통째로 사라진다.

### 5.6 도메인 이벤트

| 발행 | 이벤트 | 구독 |
|---|---|---|
| Ordering | `OrderPlaced` | (알림) |
| Ordering | `OrderPaid` | Inventory → 예약 확정 |
| Ordering | `OrderPaymentFailed` | Inventory → 예약 해제 |
| Ordering | `OrderCancelled` | Inventory → 해제, Payment → 환불 |
| Inventory | `StockReservationExpired` | Ordering → 주문 실패 처리 |
| Payment | `PaymentRefunded` | Ordering → REFUNDED 전이 |

---

## 6. 주문 사가 — 이 설계의 핵심

### 6.1 문제

Order, StockItem, Payment는 서로 다른 애그리거트이고 다른 컨텍스트에 있다.
게다가 **결제는 외부 PG 호출**이라 원칙 이전에 물리적으로 한 트랜잭션에 넣을 수 없다.
외부 HTTP 응답을 기다리며 DB 트랜잭션을 열어두면 커넥션 풀이 말라죽는다.

감당해야 할 실패 조합:

```
재고 예약 ✅ → 결제 ❌            → 예약을 풀어야 함
재고 예약 ✅ → 결제 ✅ → 저장 ❌  → 돈은 받았는데 주문이 없음 (최악)
결제 ✅     → 재고 확정 ❌        → 환불해야 함
```

### 6.2 선택: 예약 기반 사가 + 보상 트랜잭션

```
1. Order 생성                    status: PENDING_PAYMENT     [트랜잭션 1]
2. Inventory.reserve(orderId)    Reservation 생성, TTL 15분   [트랜잭션 2]
3. Payment.authorize(amount)     외부 PG 호출                 [트랜잭션 없음]
4a. 성공 → order.markPaid()      → 이벤트 OrderPaid           [트랜잭션 3]
         → Inventory 구독 → 예약을 실제 차감으로 확정
4b. 실패 → order.failPayment()   → 이벤트 OrderPaymentFailed  [트랜잭션 3]
         → Inventory 구독 → 예약 해제
5. 어느 단계든 유실되면 → TTL 만료 스케줄러가 예약을 자동 해제
```

**5번이 설계의 요체다.** 보상 트랜잭션 자체가 실패해도(서버가 죽어도)
TTL이 결국 재고를 회복시킨다. 보상 로직을 신뢰할 수 없다는 전제로 설계한다.

대안으로 검토했다가 버린 것:

- **단일 트랜잭션** — 주문 저장 + 재고 차감을 한 트랜잭션에 묶기. 단순하고 실무 단일 DB
  모놀리스에서는 자주 정답이지만, Ordering이 Inventory 테이블을 직접 건드리게 되어
  컨텍스트 경계가 무의미해진다.
- **독립 프로세스 매니저(오케스트레이션 사가)** — `PlaceOrderSaga`를 별도 애그리거트로
  영속화. Order 자체가 이미 상태 머신인데 상태 머신을 하나 더 얹는 꼴이라 이 규모엔 과하다.

**Order의 상태 머신이 사가 상태를 겸한다.** 별도 사가 엔티티를 만들지 않는다.

### 6.3 이벤트 유실 방지 — Outbox 패턴

`order.markPaid()` 후 주문 저장은 성공했는데 이벤트 발행이 실패하면
재고가 영원히 예약 상태로 남는다. 이벤트를 같은 트랜잭션 안에서 DB에 쓴다.

```ts
await txManager.run(async (tx) => {
  await orderRepository.save(order, tx);        // 주문 상태 변경
  await eventPublisher.publish(order.pullEvents(), tx);  // outbox 테이블에 INSERT
});                                             // 둘이 원자적으로 커밋
// 별도 릴레이가 outbox를 폴링해 발행하고 published_at 마킹
```

```ts
// application/ports/out — 애플리케이션은 outbox의 존재를 모른다
export interface DomainEventPublisher {
  publish(events: DomainEvent[], tx?: Transaction): Promise<void>;
}
// adapters/out/messaging/outbox-event.publisher.ts   ← 지금
// adapters/out/messaging/kafka-event.publisher.ts    ← 나중에, 유스케이스 수정 없이
```

### 6.4 재고 동시성

```ts
// inventory/domain/stock-item.ts — 락 코드가 없다. 순수 불변식만.
export class StockItem {
  get available(): Quantity { return this.onHand.minus(this.reserved); }

  reserve(orderId: OrderId, qty: Quantity, ttl: Duration): Reservation {
    if (qty.isGreaterThan(this.available)) {
      throw new InsufficientStockError(this.skuId, qty, this.available);
    }
    this.reserved = this.reserved.plus(qty);
    return Reservation.create(orderId, this.skuId, qty, ttl);
  }
}
```

락은 리포지토리 어댑터의 관심사다. 따라서 포트 하나에 어댑터 둘을 둔다.

```
StockRepository (포트)
  ├─ PessimisticStockRepository   SELECT ... FOR UPDATE     ← 기본값
  └─ OptimisticStockRepository    version 컬럼 + 재시도      ← 비교군
```

**같은 도메인 코드와 같은 동시성 테스트를 두 어댑터에 돌려 비교한다.**
초과 판매 여부, 처리량, 재시도 횟수를 측정해 README에 벤치마크로 싣는다.
기본값을 비관적 락으로 두는 이유는 인기 상품 경합에서 낙관적 락은 재시도가 폭주하는데
재고 차감은 짧고 명확한 임계 구역이라 비관적 락이 더 맞기 때문이다.

### 6.5 Money

```ts
export class Money {
  private constructor(readonly amount: bigint, readonly currency: Currency) {}
  // 최소 단위 정수(원). float 금지.
  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }
  multiply(qty: Quantity): Money { /* 반올림 정책을 여기 한 곳에 */ }
}
```

금액 버그는 커머스에서 가장 비싼 버그이고, VO 하나로 통째로 막을 수 있는 몇 안 되는 종류다.

---

## 7. 포트와 어댑터

### 7.1 명명 규칙

```
modules/<context>/
  application/ports/
    in/   <verb>-<noun>.usecase.ts     PlaceOrderUseCase
    out/  <noun>.<role>.ts             OrderRepository, PaymentGateway
  adapters/
    in/   http/  events/  scheduler/
    out/  persistence/  payment/  inventory/  messaging/
```

### 7.2 조회는 애그리거트를 거치지 않는다 (CQRS-lite)

```ts
// ❌ 상품 목록 20개를 Product 애그리거트로 재구성 → 옵션·가격 이력까지 로딩
// ✅ 읽기 전용 포트로 DTO 직결
export interface ProductQuery {
  search(criteria: SearchCriteria): Promise<ProductListItemDto[]>;
}
```

불변식을 지켜야 하는 것은 상태를 바꿀 때뿐이다. 조회에까지 애그리거트를 강요하면
성능도 잃고 코드도 는다.

| 포트 종류 | 반환 타입 | 용도 |
|---|---|---|
| `XxxRepository` | 도메인 애그리거트 | 쓰기 — 불변식 검증 필요 |
| `XxxQuery` | 읽기 전용 DTO | 조회 — Prisma가 직접 projection |

### 7.3 횡단 포트 (shared/kernel/ports)

| 포트 | 시그니처 | 왜 포트여야 하나 |
|---|---|---|
| `Clock` | `now(): Instant` | TTL·만료 테스트. `Date.now()`를 직접 부르면 15분을 기다려야 함 |
| `IdGenerator` | `nextId(): string` | UUID v7 (시간순 정렬 = 인덱스 친화적). 테스트에선 순번 fake |
| `TransactionManager` | `run<T>(fn): Promise<T>` | 유스케이스가 트랜잭션 경계의 주인. Prisma `$transaction`을 애플리케이션이 알면 안 됨 |
| `DomainEventPublisher` | `publish(events, tx?)` | Outbox 어댑터 → 나중에 Kafka 어댑터 |

`Clock`이 가장 중요하다. 6.2의 TTL 자가치유 로직 전체가 이 포트 없이는 테스트 불가능하다.

### 7.4 ordering

| 인바운드 포트 | 인바운드 어댑터 |
|---|---|
| `AddItemToCartUseCase` / `RemoveItemFromCart` / `ChangeCartItemQuantity` | HTTP `CartController` |
| **`PlaceOrderUseCase`** | HTTP `OrderController` |
| `CancelOrderUseCase` | HTTP `OrderController` |
| `GetCartQuery` / `GetOrderQuery` / `ListMyOrdersQuery` | HTTP (읽기 경로) |
| `HandlePaymentRefunded` / `HandleStockReservationExpired` | 이벤트 핸들러 |

| 아웃바운드 포트 | 어댑터 | 비고 |
|---|---|---|
| `CartRepository` | `PrismaCartRepository` | + `CartMapper` |
| `OrderRepository` | `PrismaOrderRepository` | + `OrderMapper` |
| `OrderQuery` | `PrismaOrderQuery` | DTO 직결 |
| `CatalogPriceProvider` | `InProcessCatalogAdapter` | **ACL** — Product → PricedItem |
| `CustomerAddressProvider` | `InProcessCustomerAdapter` | **ACL** — SavedAddress → ShippingAddress |
| `InventoryReserver` | `InProcessInventoryAdapter` | |
| `PaymentGateway` | `InProcessPaymentAdapter` | payment 모듈 호출 (PG 직접 아님) |

### 7.5 inventory

| 인바운드 포트 | 인바운드 어댑터 |
|---|---|
| `ReserveStockUseCase` | ordering이 포트 통해 호출 |
| `ConfirmReservationUseCase` | 이벤트 핸들러 (`OrderPaid`) |
| `ReleaseReservationUseCase` | 이벤트 핸들러 (`OrderPaymentFailed`, `OrderCancelled`) |
| **`ExpireReservationsUseCase`** | **스케줄러 어댑터** — TTL 자가치유 |
| `GetStockQuery` | HTTP (관리자) |

| 아웃바운드 포트 | 어댑터 |
|---|---|
| **`StockRepository`** | `PessimisticStockRepository` (기본) / `OptimisticStockRepository` (비교군) |
| `ReservationRepository` | `PrismaReservationRepository` |

### 7.6 payment / identity / customer / catalog

| 컨텍스트 | 인바운드 | 아웃바운드 포트 → 어댑터 |
|---|---|---|
| payment | `AuthorizePayment`, `RefundPayment`, `HandlePgCallback`(webhook, 멱등) | `PaymentRepository` → Prisma / **`PgClient` → `FakePgAdapter`** |
| identity | `SignUp`, `SignIn`, `RefreshSession`, `SignOut`, `ChangePassword` | `AccountRepository`, `SessionRepository`, `PasswordHasher` → Argon2, `TokenIssuer` → JWT, `EmailSender` → Console, **`IdentityProvider` → 어댑터 없음** |
| customer | `AddAddress`, `UpdateAddress`, `DeleteAddress`, `SetDefaultAddress`, `GetAddressBookQuery` | `CustomerRepository` → Prisma |
| catalog | `RegisterProduct`, `UpdatePrice`, `SearchProductsQuery`, `GetProductQuery` | `ProductRepository`, `ProductQuery` → Prisma |

`FakePgAdapter`는 단순 스텁이 아니라 **실패를 주문형으로 만들어내는 도구**여야 한다
(`APPROVE` / `DECLINE` / `TIMEOUT` 시나리오). 사가 보상 경로를 테스트하려면
결제 실패를 마음대로 일으킬 수 있어야 한다.

`IdentityProvider`는 의도적으로 구현체 없이 인터페이스만 둔다. 나중에 어댑터 하나 추가로
소셜 로그인이 붙는다는 것을 보여주는 자리다.

### 7.7 포트를 만들지 말아야 할 것

| 대상 | 포트 필요? |
|---|---|
| DB, 외부 PG, 메일, 시각, ID 생성 | 필요 |
| 로거 | 불필요. Nest Logger 직접 사용. 도메인에는 로그를 넣지 않음 |
| 설정/환경변수 | 불필요. 모듈 조립 시점에 주입되는 값 |
| 문자열 포맷 등 유틸 | 불필요. 그냥 함수 |

기준은 하나다 — **테스트에서 바꿔치기해야 하는가, 혹은 나중에 교체될 수 있는가.**
둘 다 아니면 포트가 아니다.

---

## 8. Next BFF ↔ Nest 계약

### 8.1 BFF에는 헥사고날을 적용하지 않는다

BFF에는 보호할 도메인이 없다. 상태를 소유하지 않고, 불변식이 없고, 하는 일이 전부
어댑터적이다(토큰 주입, 호출 집계, 응답 형태 변환). 포트를 두면 순수한 간접 비용이다.

대신 다른 규율이 필요하다.

| 위험 | 방어 |
|---|---|
| **도메인 로직이 BFF로 새어나감** | "BFF는 계산하지 않는다. 전달·병합·형태 변환만" |
| 서버 전용 코드가 클라이언트 번들에 포함 | `server-only` 패키지 |
| 토큰이 클라이언트 컴포넌트로 전달 | 세션 접근은 `src/server/` 안에서만 |

첫 번째가 최대 위험이다. 주문 총액 계산이나 취소 가능 여부 판단을 BFF가 하는 순간
같은 규칙이 두 곳에 생긴다. **화면에 필요하면 API가 계산된 값을 내려준다.**

### 8.2 계약 패키지

**넣을 것** — 요청/응답 Zod 스키마, 추론된 타입, 에러 코드 enum, 경로 정의.
**넣지 말 것** — `Order` 엔티티, `Money` VO, 비즈니스 규칙.

5.3의 스냅샷 규칙과 같은 정신이다. 경계를 넘을 때는 값만 복사하고 모델은 넘기지 않는다.

### 8.3 도구: ts-rest

| 후보 | 판단 |
|---|---|
| **ts-rest** | 채택. Zod 계약 하나로 Nest 라우팅 + 타입 안전 클라이언트. REST 유지 |
| Zod만 + 수동 fetch 래퍼 | 마법 없음. 대신 엔드포인트 30개 × 보일러플레이트 |
| tRPC | 기각. Nest 컨트롤러 구조와 충돌하고 REST를 포기하면 API 문서를 보여줄 수 없음 |
| Nest Swagger → OpenAPI codegen | 기각. 데코레이터 중복 + 생성 단계. 스키마가 두 벌 |

```ts
export const placeOrderContract = c.router({
  placeOrder: {
    method: 'POST',
    path: '/orders',
    body: z.object({ cartId: z.string().uuid(), shippingAddressId: z.string().uuid() }),
    responses: {
      201: OrderSummaryDto,
      409: ErrorDto,   // INSUFFICIENT_STOCK
      422: ErrorDto,   // PAYMENT_DECLINED
    },
  },
});
```

### 8.4 검증은 두 종류이고 서로 다른 곳에 산다

| 종류 | 위치 | 예 |
|---|---|---|
| **형식 검증** | 인바운드 어댑터 (Zod) | uuid 형식인가, 필수 필드가 있는가, 정수인가 |
| **도메인 검증** | 도메인 모델 | 수량 ≥ 1, 재고 충분, 취소 가능한 상태인가 |

Zod 스키마에 `.min(1)`을 붙이는 순간 "수량은 1 이상"이라는 규칙이 도메인 밖으로 샌다.
형식은 Zod가, 의미는 `Quantity` VO가 지킨다.

### 8.5 인증 흐름

```
① 로그인
브라우저 ──POST /api/auth/sign-in──▶ Next Route Handler
                                        ├─▶ Nest POST /auth/sign-in
                                        │   ◀── { accessToken 15m, refreshToken 14d }
                     ◀──Set-Cookie: sid=<암호화된 세션>─┘
                        HttpOnly; Secure; SameSite=Lax

② 이후 요청
브라우저 ──쿠키──▶ BFF ──Authorization: Bearer <access>──▶ Nest
                    └─ 401이면 refresh로 갱신 후 1회 재시도 (BFF 안에서 조용히)
```

브라우저에 액세스 토큰을 내려주지 않아 XSS 노출면이 줄고, refresh 로직이 BFF 한 곳에 모인다.

세션 저장은 암호화 쿠키(`iron-session` 또는 `jose`)로 한다. Redis를 띄우지 않는 이유는
즉시 무효화가 이미 Nest의 `SessionRepository`(DB 세션)에서 해결되기 때문이다.
BFF는 토큰 운반자일 뿐이라 별도 저장소가 필요 없다.

### 8.6 에러 규약 — 도메인은 HTTP를 모른다

```ts
// ordering/domain/order/order.errors.ts — 상태 코드가 없다
export class InsufficientStockError extends DomainError {
  constructor(readonly skuId: SkuId, readonly requested: Quantity, readonly available: Quantity) { super(); }
}

// shared/infrastructure/http/domain-exception.filter.ts — 매핑은 어댑터에
const MAP = {
  InsufficientStockError:   { status: 409, code: ErrorCode.INSUFFICIENT_STOCK },
  OrderNotCancellableError: { status: 422, code: ErrorCode.ORDER_NOT_CANCELLABLE },
  PaymentDeclinedError:     { status: 422, code: ErrorCode.PAYMENT_DECLINED },
};
```

`ErrorCode`는 contracts에 있어 프론트가 상태 코드가 아니라 코드로 분기한다.
도메인 예외에 HTTP 상태 코드를 달면 그 예외는 HTTP 밖에서 의미를 잃는다.

### 8.7 호출 경로

| 작업 | 경로 | 이유 |
|---|---|---|
| 조회 | RSC → `src/server/api-client` 직접 | 이미 서버. Route Handler 경유는 불필요한 한 홉 |
| 변경 | 클라이언트 → Route Handler → Nest | 에러 코드 분기·재시도가 BFF 한 곳에 모임 |
| 인증 | Route Handler | `Set-Cookie`가 필요 |

Server Action은 사용하지 않는다. 단순 폼에는 편하지만 에러 코드 분기와 재시도 로직이
BFF 한 곳에 모여 있는 편이 이 구조에 맞는다.

---

## 9. 테스트 전략

### 9.1 목 라이브러리를 쓰지 않는다

아웃바운드 포트마다 **손으로 쓴 fake**를 하나씩 만든다. `vi.mock`이나 목 라이브러리는
쓰지 않는다.

| | Mock | Fake |
|---|---|---|
| 검증 대상 | 상호작용 (`toHaveBeenCalledWith`) | **상태** (`await repo.findById(id)`) |
| 리팩터링 | 내부 호출을 바꾸면 깨짐 | 결과가 같으면 통과 |
| 재사용 | 테스트마다 다시 씀 | 포트당 한 번, 수십 개 테스트가 공유 |
| 실물과의 정합 | 검증 불가 | **계약 테스트로 검증 가능** |

```
shared/testing/fakes/     mutable-clock.ts  sequential-id-generator.ts
                          recording-event-publisher.ts
                          passthrough-transaction-manager.ts
modules/*/testing/        in-memory-*.repository.ts  fake-*.ts
```

### 9.2 리포지토리 계약 테스트

같은 테스트 스위트를 fake와 실물 양쪽에 돌린다.

```ts
export function orderRepositoryContract(name: string, createRepo: () => Promise<OrderRepository>) {
  describe(`OrderRepository 계약 — ${name}`, () => {
    it('저장한 주문을 ID로 다시 찾을 수 있다', async () => { /* ... */ });
    it('OrderLine의 금액과 통화가 왕복해도 보존된다', async () => { /* ... */ });
    it('존재하지 않는 ID는 null을 반환한다', async () => { /* ... */ });
    it('같은 주문을 두 번 저장하면 갱신된다', async () => { /* ... */ });
  });
}

orderRepositoryContract('in-memory', async () => new InMemoryOrderRepository());
orderRepositoryContract('prisma',    async () => new PrismaOrderRepository(testDb()));
```

fake가 실물과 드리프트할 수 없게 된다. 유스케이스 테스트 수십 개가 fake 위에서 빠르게
돌면서도 그 fake가 Prisma 어댑터와 같은 규약을 지킨다는 것이 보장된다.
프론트에서 MSW + contracts가 하는 역할과 같은 패턴이다.

### 9.3 테스트 종류와 비중

| 종류 | 대상 | DB | 비중 |
|---|---|---|---|
| 도메인 단위 | 엔티티·VO·상태 머신 | 불필요 | 가장 많음 |
| 유스케이스 | application + fake 포트 | 불필요 | 많음 |
| 리포지토리 계약 | 포트 구현 양쪽 | 필요 | 중간 |
| 어댑터 단위 | 매퍼, FakePg | 부분 | 적음 |
| **동시성** | 실 DB, 병렬 커넥션 | 필요 | 소수 |
| 모듈 통합 | Nest 모듈 + 실 DB | 필요 | 소수 |
| E2E | 전체 스택 | 필요 | 6~8개 |

### 9.4 TDD 사이클

방향은 inside-out, 범위는 유스케이스가 결정한다.

```
1. 스펙에서 시나리오 추출 (정상 + 실패 경로) → 테스트 이름 목록을 먼저 쓴다
2. 도메인 테스트           RED → GREEN → REFACTOR
3. 유스케이스 테스트        fake 포트로. 사가 분기와 보상 경로 전부
4. 리포지토리 계약 테스트 → Prisma 어댑터 구현
5. HTTP 어댑터 통합 테스트 — 딱 1개 (배선 확인용)
```

5번이 1개인 것은 의도적이다. 컨트롤러 테스트는 라우팅·검증·가드·예외 필터가 연결됐는지만
확인한다. 비즈니스 케이스는 이미 2~3단계에서 검증됐으므로 반복은 낭비다.

순수 inside-out은 안 쓰일 메서드를 만드는 YAGNI 위반을 낳으므로, 무엇을 만들지는
1번(유스케이스 시나리오)이 결정한다. SDD로 스펙을 먼저 쓰기로 한 것이 여기서 맞물린다.

### 9.5 DB 격리

```
① 전역 setup (1회)   마이그레이션 적용 → commerce_test_template 생성 → 커넥션 전부 닫기
② 워커별            CREATE DATABASE test_w{n} TEMPLATE commerce_test_template   (~100ms)
③ 테스트 파일 간      TRUNCATE <모든 테이블> RESTART IDENTITY CASCADE
```

두 가지 함정을 미리 막는다.

- `TEMPLATE` 복제는 원본에 활성 커넥션이 하나라도 있으면 실패한다. ①에서 반드시 `$disconnect()`.
- **테스트를 트랜잭션으로 감싸고 롤백하는 방식은 쓰지 않는다.** Prisma의 `$transaction`과
  중첩되면 문제가 되고, 무엇보다 **같은 트랜잭션 안에서는 동시성 경합을 재현할 수 없다.**

### 9.6 동시성 테스트

```ts
describe.each([
  ['pessimistic', (p: PrismaClient) => new PessimisticStockRepository(p)],
  ['optimistic',  (p: PrismaClient) => new OptimisticStockRepository(p)],
])('재고 동시성 — %s', (strategy, makeRepo) => {

  it('재고 1개에 동시 예약 50건이면 정확히 1건만 성공한다', async () => {
    await seedStock(SKU, 1);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        reserveStock.execute({ skuId: SKU, orderId: newOrderId(), qty: 1 })),
    );
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await availableOf(SKU)).toBe(0);          // 초과 판매 없음
  });

  it('재고 10개에 동시 예약 30건이면 정확히 10건만 성공한다', async () => { /* ... */ });
});
```

**필수 주의사항**: Prisma 커넥션 풀이 작으면 요청이 풀에서 직렬화되어 경합이 발생하지 않고
테스트가 거짓으로 통과한다. 테스트용 `DATABASE_URL`에 `?connection_limit=20`을 반드시 붙인다.

처리량과 재시도 횟수를 함께 기록해 README 벤치마크 표로 만든다.

### 9.7 시간 제어

```ts
it('TTL이 만료되면 예약이 자동 해제된다', async () => {
  await seedStock(SKU, 1);
  await reserveStock.execute({ skuId: SKU, orderId, qty: 1 });
  expect(await availableOf(SKU)).toBe(0);

  clock.advanceBy(Duration.minutes(16));     // 15분 TTL 초과
  await expireReservations.execute();

  expect(await availableOf(SKU)).toBe(1);    // 자가 치유 검증
});
```

Vitest의 fake timer 대신 `Clock` 포트를 쓴다. Fake timer는 전역을 오염시켜 Prisma의
내부 타이머·커넥션 keepalive와 충돌한다.

### 9.8 Outbox와 사가 테스트

| 층위 | 검증 |
|---|---|
| 유스케이스 | `RecordingEventPublisher`로 `OrderPaid`가 발행됐는지 |
| 통합 | **트랜잭션이 롤백되면 outbox row도 사라지는지** (원자성) |
| 릴레이 | 미발행 row를 발행 후 마킹, **같은 이벤트를 두 번 발행하지 않는지** (멱등) |
| 사가 전체 | 결제 실패 → 예약 해제까지 이벤트 체인이 실제로 도는지 |

### 9.9 프론트엔드

프론트의 테스트 seam은 포트가 아니라 **네트워크**다. MSW가 그 자리이며,
핸들러는 `@commerce/contracts`의 Zod 스키마로 요청과 응답을 검증한다.
백엔드 계약이 바뀌면 프론트 목이 즉시 깨진다 — 손으로 만든 fake는 조용히 드리프트하지만
이 방식은 구조적으로 불가능하다.

| FSD 레이어 | 테스트 | 도구 | TDD |
|---|---|---|---|
| `shared/lib`, `entities/*/model` | 단위 | Vitest | 적용 |
| `features/*/model` (훅) | 훅 테스트 | Vitest + `renderHook` + MSW | 적용 |
| `features/*/ui`, `widgets` | 컴포넌트 | Testing Library + MSW | test-after |
| `views` (RSC) | E2E로 커버 | Playwright | 미적용 |

**RSC는 단위 테스트가 어렵다.** async 서버 컴포넌트를 Testing Library로 렌더하는 것은
아직 매끄럽지 않다. 이것은 FSD 때문이 아니라 React/Next의 현재 상태이므로 구조로 대응한다 —
**RSC는 페치와 전달만, 로직은 전부 아래 레이어로.**

**UI 컴포넌트에는 TDD를 적용하지 않는다.** 레이아웃과 픽셀은 테스트를 먼저 쓸 수 없고
억지로 하면 구현을 베낀 무의미한 테스트가 나온다. TDD는 `model` 세그먼트에만 적용한다.
백엔드에서 도메인·유스케이스에 TDD를 걸고 컨트롤러를 얇게 가져가는 것과 같은 원리다.

### 9.10 E2E

```ts
test('결제 거절 시 재고 예약이 해제된다', async ({ page, api }) => {
  await api.fakePg.setScenario('DECLINE_NEXT');
  await placeOrder(page);
  await expect(page.getByText('결제가 거절되었습니다')).toBeVisible();
  await expect.poll(() => api.availableStock(SKU)).toBe(INITIAL_STOCK);
});
```

시나리오는 6~8개로 제한한다: 회원가입/로그인, 상품 조회, 장바구니, 주문 성공,
결제 거절 보상, 주문 취소 환불, 재고 부족. 늘리면 유지비만 커지고 새로 잡는 버그가 없다.

### 9.11 커버리지 정책

전체 80% 같은 목표는 세우지 않는다. 경로별로 건다.

```ts
coverage: { thresholds: {
  'apps/api/src/modules/*/domain/**':      { lines: 95, branches: 90 },
  'apps/api/src/modules/*/application/**': { lines: 90, branches: 85 },
  // adapters — 목표 없음. 계약 테스트와 통합 테스트가 커버
}}
```

어댑터에 커버리지 목표를 걸면 매퍼 getter를 확인하는 무의미한 테스트가 양산된다.
**불변식이 있는 곳에만 높은 기준을 건다.**

---

## 10. 디렉터리 구조

### 10.1 루트

```
commerce-app/
├── apps/api/                       Nest — 헥사고날
├── apps/web/                       Next — FSD + BFF
├── packages/contracts/             Zod 계약 (DTO만)
├── docs/superpowers/specs/
├── docs/architecture.svg           dependency-cruiser 생성
├── docker-compose.yml
├── pnpm-workspace.yaml
├── biome.jsonc
├── .dependency-cruiser.js
├── vitest.config.ts
└── package.json
```

### 10.2 packages/contracts

```
packages/contracts/src/
├── index.ts
├── shared/{error-codes.ts, money.dto.ts, pagination.ts}
├── ordering/{cart.contract.ts, place-order.contract.ts, order.contract.ts}
├── identity/auth.contract.ts
├── customer/address.contract.ts
├── catalog/product.contract.ts
└── inventory/stock.contract.ts
```

`money.dto.ts`는 `{ amount: string; currency: 'KRW' }`인 **DTO**다.
`amount`가 string인 것은 JSON에 bigint가 없기 때문이고, 도메인의 `Money` 클래스는 여기 없다.

### 10.3 apps/api

```
apps/api/
├── prisma/{schema.prisma, migrations/, seed.ts}
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── shared/
│   │   ├── kernel/
│   │   │   ├── money.ts  quantity.ts  identifiers.ts
│   │   │   ├── aggregate-root.ts  domain-event.ts  domain-error.ts
│   │   │   └── ports/{clock, id-generator, transaction-manager, domain-event.publisher}.ts
│   │   └── infrastructure/
│   │       ├── prisma/{prisma.service.ts, prisma-transaction-manager.ts}
│   │       ├── clock/system-clock.ts
│   │       ├── id/uuid-v7.generator.ts
│   │       ├── outbox/{outbox-event.publisher.ts, outbox-relay.ts}
│   │       └── http/domain-exception.filter.ts
│   └── modules/{ordering, inventory, payment, catalog, customer, identity}/
└── test/
    ├── setup/{database.ts, global-setup.ts}
    └── e2e/
```

### 10.4 modules/ordering — 전문

```
modules/ordering/
├── index.ts                                 공개 API. 외부는 이것만 본다
├── ordering.module.ts                       Nest DI 조립
│
├── domain/
│   ├── cart/{cart.ts, cart.spec.ts, cart-line.ts, cart.errors.ts}
│   ├── order/
│   │   ├── order.ts                         애그리거트 루트 + 상태 머신
│   │   ├── order.spec.ts
│   │   ├── order-line.ts                    VO — 가격 스냅샷
│   │   ├── shipping-address.ts              VO — 주소 스냅샷
│   │   ├── order-status.ts                  전이 규칙
│   │   ├── order.events.ts
│   │   └── order.errors.ts
│   └── priced-item.ts                       ACL 결과 타입. Catalog의 Product가 아님
│
├── application/
│   ├── ports/
│   │   ├── in/
│   │   │   ├── add-item-to-cart.usecase.ts
│   │   │   ├── remove-item-from-cart.usecase.ts
│   │   │   ├── change-cart-item-quantity.usecase.ts
│   │   │   ├── place-order.usecase.ts
│   │   │   ├── cancel-order.usecase.ts
│   │   │   └── queries/{get-cart, get-order, list-my-orders}.query.ts
│   │   └── out/
│   │       ├── cart.repository.ts  order.repository.ts  order.query.ts
│   │       ├── catalog-price.provider.ts    ACL
│   │       ├── customer-address.provider.ts ACL
│   │       ├── inventory-reserver.ts
│   │       └── payment.gateway.ts
│   └── services/
│       ├── add-item-to-cart.service.ts
│       ├── place-order.service.ts           사가 오케스트레이션
│       ├── place-order.service.spec.ts      fake 포트로 전 분기 검증
│       ├── cancel-order.service.ts
│       └── handlers/{on-payment-refunded, on-stock-reservation-expired}.handler.ts
│
├── adapters/
│   ├── in/
│   │   ├── http/{cart.controller.ts, order.controller.ts}
│   │   └── events/ordering-event.subscriber.ts
│   └── out/
│       ├── persistence/
│       │   ├── prisma-cart.repository.ts  prisma-order.repository.ts
│       │   ├── prisma-order.query.ts       DTO 직결. 애그리거트를 만들지 않음
│       │   └── {cart, order}.mapper.ts
│       ├── catalog/in-process-catalog.adapter.ts
│       ├── customer/in-process-customer.adapter.ts
│       ├── inventory/in-process-inventory.adapter.ts
│       └── payment/in-process-payment.adapter.ts
│
└── testing/
    ├── in-memory-{cart,order}.repository.ts
    ├── fake-payment-gateway.ts              APPROVE / DECLINE / TIMEOUT
    ├── fake-inventory-reserver.ts
    ├── order-repository.contract.ts
    └── order.fixtures.ts
```

테스트 파일은 소스 옆에 `*.spec.ts`로 둔다. DB가 필요한 것은 `*.integration.spec.ts`.

### 10.5 modules/inventory

```
modules/inventory/
├── index.ts  inventory.module.ts
├── domain/{stock-item.ts, stock-item.spec.ts, reservation.ts, stock.events.ts, stock.errors.ts}
├── application/
│   ├── ports/in/{reserve-stock, confirm-reservation, release-reservation, expire-reservations}.usecase.ts
│   ├── ports/out/{stock.repository.ts, reservation.repository.ts}
│   └── services/
├── adapters/
│   ├── in/http/stock.controller.ts
│   ├── in/events/inventory-event.subscriber.ts
│   ├── in/scheduler/reservation-expiry.scheduler.ts
│   └── out/persistence/
│       ├── pessimistic-stock.repository.ts     SELECT ... FOR UPDATE  (기본)
│       ├── optimistic-stock.repository.ts      version + 재시도       (비교군)
│       ├── prisma-reservation.repository.ts
│       └── stock.mapper.ts
└── testing/
    ├── in-memory-stock.repository.ts
    ├── stock-repository.contract.ts            3개 구현에 같은 스위트
    └── stock-concurrency.integration.spec.ts
```

### 10.6 나머지 모듈 — 같은 골격, 얇게

```
modules/payment/   domain/{payment.ts, payment-attempt.ts}
                   ports/out/{payment.repository.ts, pg-client.ts}
                   adapters/in/http/pg-webhook.controller.ts    멱등 처리
                   adapters/out/pg/fake-pg.adapter.ts           시나리오 제어

modules/identity/  domain/{account.ts, session.ts, credential.ts}
                   ports/out/{account.repository, session.repository, password-hasher,
                              token-issuer, email-sender, identity-provider}.ts
                   adapters/out/{argon2-hasher, jwt-token-issuer, console-email-sender}.ts
                   ※ identity-provider.ts 는 어댑터 없이 인터페이스만

modules/customer/  domain/{customer.ts, address-book.ts, saved-address.ts}
modules/catalog/   domain/{product.ts, sku.ts, price.ts}
```

### 10.7 apps/web

```
apps/web/
├── app/                                     Next 라우팅. 얇은 껍데기
│   ├── layout.tsx
│   ├── (shop)/{page.tsx, products/[id]/page.tsx, cart/page.tsx, orders/[id]/page.tsx}
│   ├── (auth)/sign-in/page.tsx
│   └── api/                                 BFF Route Handlers
│       ├── auth/{sign-in,sign-out}/route.ts
│       ├── cart/route.ts
│       └── orders/route.ts
│
├── src/
│   ├── server/                              'server-only'. FSD 밖. BFF 전용
│   │   ├── session.ts                       암호화 쿠키 read/write
│   │   └── api-client.ts                    토큰 주입 + 401 시 refresh 재시도
│   │
│   ├── views/{product-detail, cart, order-detail}/     FSD pages 레이어
│   ├── widgets/{order-summary, product-grid, header}/
│   ├── features/
│   │   ├── add-to-cart/{ui/, model/, index.ts}
│   │   ├── place-order/  cancel-order/  sign-in/  manage-addresses/
│   ├── entities/{order, product, cart, address}/{model/, ui/, index.ts}
│   └── shared/
│       ├── api/{contract-client.ts, msw/{handlers/, browser.ts, server.ts}}
│       ├── ui/  lib/  config/
└── e2e/                                     Playwright 6~8 시나리오
```

FSD 레이어 규칙은 `src/{views,widgets,features,entities,shared}`에만 적용된다.
`app/`은 Next 라우팅, `src/server/`는 BFF라 레이어 밖이다 — 8.1의 구조적 표현이다.

`views` 이름은 FSD의 `pages` 레이어가 Next의 `app/`·`pages/`와 충돌하는 것을 피하기 위한
것이다. FSD 공식 문서가 `_pages` 접두사 또는 리네임을 허용한다.

### 10.8 영속 모델 개요

도메인 모델과 별개로, 어댑터가 매핑할 주요 테이블이다. 컬럼은 대표적인 것만 적는다.

| 테이블 | 주요 컬럼 | 비고 |
|---|---|---|
| `accounts` | id, email(unique), password_hash | identity |
| `sessions` | id, account_id, refresh_token_hash, expires_at, rotated_at | 즉시 무효화의 근거 |
| `customers` | id, account_id(unique), name | |
| `saved_addresses` | id, customer_id, label, recipient, phone, zip, line1, line2, is_default | 기본 배송지는 부분 유니크 인덱스로 0~1개 강제 |
| `products` / `skus` | id, name, status / id, product_id, price_amount, price_currency | catalog |
| `carts` / `cart_lines` | id, customer_id / cart_id, sku_id, quantity | (cart_id, sku_id) 유니크 |
| `orders` | id, customer_id, status, total_amount, total_currency, shipping_* (스냅샷), placed_at | |
| `order_lines` | order_id, sku_id, name_snapshot, unit_price_amount, unit_price_currency, quantity | VO라 자체 id 불필요 |
| `stock_items` | sku_id(PK), on_hand, reserved, **version** | `version`은 낙관적 락 어댑터 전용 |
| `reservations` | id, order_id, sku_id, quantity, status, expires_at | `expires_at` 인덱스 — 만료 스케줄러가 스캔 |
| `payments` / `payment_attempts` | id, order_id, status, authorized_amount / payment_id, pg_tx_id, result | `pg_tx_id` 유니크로 웹훅 멱등 보장 |
| `outbox` | id, aggregate_type, aggregate_id, event_type, payload, occurred_at, **published_at** | `published_at IS NULL` 부분 인덱스 — 릴레이가 스캔 |

세 가지가 설계와 직결된다.

- **`stock_items.version`** — 낙관적 락 어댑터만 사용한다. 비관적 락 어댑터는 이 컬럼을
  읽지 않으므로, 두 어댑터를 같은 스키마로 비교할 수 있다.
- **`reservations.expires_at`** — TTL 자가치유(6.2의 5단계)가 이 인덱스를 스캔한다.
- **`outbox.published_at`** — 부분 인덱스를 걸어 릴레이가 미발행 이벤트만 훑는다.
  릴레이는 발행 후 이 컬럼을 채우며, 중복 발행 방지는 소비자 쪽 멱등성과 함께 이중으로 건다.

금액은 `*_amount`(bigint 최소단위) + `*_currency` 두 컬럼으로 저장하고, 매퍼가 `Money`로 복원한다.

---

## 11. 경계 강제

규율은 사람의 의지가 아니라 도구가 지킨다. 두 겹으로 건다.

| 도구 | 역할 | 시점 |
|---|---|---|
| **Biome** | 포맷 + 일반 lint + 계층별 import 금지 | 에디터 저장 시 |
| **dependency-cruiser** | 그래프 검증 — 순환 참조, 공개 API 우회, 레이어 방향 | CI |

Biome을 쓰면 ESLint의 타입 인지(type-aware) 규칙을 일부 잃는다. 주로 `noFloatingPromises`
계열인데 Biome에 제한적으로 있고 나머지는 `tsc --strict`가 상당 부분 커버한다.
Rust 단일 바이너리로 ESLint + Prettier + import 정렬을 대체하는 이득이 더 크다고 판단했다.

패키지를 물리적으로 쪼개는 방식(`packages/ordering-domain` 등)은 채택하지 않았다.
명시적 매핑 + 포트 인터페이스 + lint 규칙을 이미 갖추면 패키지 분리가 추가로 잡는 버그가
거의 없고, 나중에 필요하면 폴더를 옮기는 수준의 작업이다.

### 11.1 biome.jsonc — 계층별 import 금지

```jsonc
{
  "overrides": [
    {
      "includes": ["apps/api/src/modules/*/domain/**"],
      "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error",
        "options": { "patterns": [{
          "group": ["@nestjs/*", "@prisma/client", "**/adapters/**", "**/application/**"],
          "message": "domain 계층은 프레임워크와 바깥 계층을 알 수 없습니다."
        }]}}}}}
    },
    {
      "includes": ["apps/api/src/modules/*/application/**"],
      "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error",
        "options": { "patterns": [{
          "group": ["@prisma/client", "**/adapters/**"],
          "message": "application은 포트 인터페이스만 압니다. 구현은 모릅니다."
        }]}}}}}
    }
  ]
}
```

`noRestrictedImports`의 gitignore 스타일 `patterns` 옵션은 Biome v2.2.0 이상이 필요하다.
`overrides`는 블록마다 규칙 옵션을 통째로 다시 써야 하지만, `domain/`·`application/`·
`adapters/`가 서로 겹치지 않아 문제되지 않는다.

### 11.2 .dependency-cruiser.js — 백엔드와 프론트가 한 파일에

```js
module.exports = { forbidden: [
  // ── 백엔드: 헥사고날 ────────────────────────────
  { name: 'domain-is-pure', severity: 'error',
    from: { path: 'apps/api/src/modules/[^/]+/domain' },
    to:   { path: '(node_modules/@nestjs|node_modules/@prisma|/application/|/adapters/)' } },

  { name: 'application-knows-no-adapters', severity: 'error',
    from: { path: 'apps/api/src/modules/[^/]+/application' },
    to:   { path: '(/adapters/|node_modules/@prisma)' } },

  { name: 'domain-must-not-know-dto', severity: 'error',
    from: { path: 'apps/api/src/modules/[^/]+/domain' },
    to:   { path: '^packages/contracts' } },

  { name: 'no-cross-module-internals', severity: 'error',
    from: { path: 'apps/api/src/modules/([^/]+)/' },
    to:   { path: 'apps/api/src/modules/(?!$1)[^/]+/(domain|application|adapters)' } },

  // ── 프론트: FSD ─────────────────────────────────
  { name: 'fsd-layer-direction', severity: 'error',
    from: { path: 'apps/web/src/entities' },
    to:   { path: 'apps/web/src/(features|widgets|views)' } },

  { name: 'fsd-shared-is-a-leaf', severity: 'error',
    from: { path: 'apps/web/src/shared' },
    to:   { path: 'apps/web/src/(entities|features|widgets|views)' } },

  { name: 'fsd-no-cross-slice-internals', severity: 'error',
    from: { path: 'apps/web/src/features/([^/]+)/' },
    to:   { path: 'apps/web/src/features/(?!$1)[^/]+/(ui|model|api)' } },

  { name: 'no-server-code-in-fsd', severity: 'error',
    from: { path: 'apps/web/src/(entities|features|widgets|shared)' },
    to:   { path: 'apps/web/src/server' } },

  // ── 경계 전반 ──────────────────────────────────
  { name: 'web-must-not-import-api', severity: 'error',
    from: { path: '^apps/web' }, to: { path: '^apps/api' } },
  { name: 'contracts-is-a-leaf', severity: 'error',
    from: { path: '^packages/contracts' }, to: { path: '^apps/' } },
  { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
]};
```

`domain-must-not-know-dto`가 특히 중요하다. 도메인 → DTO 변환은 어댑터의 매퍼가 담당하므로
API 응답 형태를 바꿔도 도메인은 미동도 하지 않는다.

`arch:graph` 스크립트로 의존성 그래프 SVG를 생성해 README에 싣는다.
dependency-cruiser를 `eslint-plugin-boundaries` 대신 고른 이유 중 하나가 이 시각화다.

### 11.3 vitest.config.ts

```ts
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'api-unit', include: ['apps/api/src/**/*.spec.ts'],
                exclude: ['**/*.integration.spec.ts'], environment: 'node' },
        plugins: [swc.vite()] },                       // 데코레이터 메타데이터

      { test: { name: 'api-integration', include: ['apps/api/**/*.integration.spec.ts'],
                globalSetup: './apps/api/test/setup/global-setup.ts',
                fileParallelism: true, environment: 'node' },
        plugins: [swc.vite()] },

      { test: { name: 'web', include: ['apps/web/src/**/*.spec.{ts,tsx}'],
                environment: 'jsdom', setupFiles: ['./apps/web/test/setup.ts'] } },
    ],
    coverage: { thresholds: {
      'apps/api/src/modules/*/domain/**':      { lines: 95, branches: 90 },
      'apps/api/src/modules/*/application/**': { lines: 90, branches: 85 },
    }},
  },
});
```

Nest는 기본이 Jest이므로 Vitest로 통일하려면 데코레이터와 `reflect-metadata`를 위해
`unplugin-swc` 설정이 필요하다. 한 번 잡으면 백·프론트 설정이 하나로 통일되는 이득이 크다.

### 11.4 docker-compose.yml

```yaml
services:
  db:
    image: postgres:17-alpine
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: commerce }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: }
```

### 11.5 루트 package.json 스크립트

```jsonc
{
  "db:up":       "docker compose up -d",
  "db:migrate":  "pnpm --filter api exec prisma migrate dev",
  "dev":         "pnpm -r --parallel dev",
  "test":        "vitest run",
  "test:unit":   "vitest run --project api-unit --project web",
  "test:int":    "vitest run --project api-integration",
  "test:e2e":    "playwright test",
  "lint":        "biome check .",
  "arch:check":  "depcruise --config .dependency-cruiser.js apps packages",
  "arch:graph":  "depcruise --config .dependency-cruiser.js --output-type dot apps packages | dot -Tsvg > docs/architecture.svg",
  "verify":      "pnpm lint && pnpm arch:check && tsc -b && pnpm test"
}
```

`pnpm verify` 하나가 CI가 도는 전부다.

---

## 12. 결정 기록

| # | 결정 | 근거 요약 |
|---|---|---|
| 1 | Cart는 Ordering 컨텍스트 안에, 별도 애그리거트로 | 유비쿼터스 언어를 공유. 자르면 ACL만 하나 늘어남 |
| 2 | Ordering은 Catalog의 Product를 참조하지 않고 가격을 스냅샷 | 상품 가격 변경이 과거 주문 금액을 바꾸는 사고 방지 |
| 3 | 즉시 결과가 필요한 것은 동기 포트, 후속 처리는 도메인 이벤트. 역방향은 이벤트로만 | 순환 참조 방지 |
| 4 | Identity(인증)와 Customer(회원)를 분리 | 언어와 생명주기가 갈림. 인증은 통째로 교체되는 부분 |
| 5 | 배송지는 주소록(엔티티) + 주문 스냅샷(VO) | 결정 2와 같은 패턴 |
| 6 | 인증은 인바운드 어댑터의 관심사. 유스케이스는 확인된 신원만 받음 | 단, "본인 주문만 취소"는 도메인 규칙 |
| 7 | BFF가 토큰을 보관하고 브라우저에는 httpOnly 쿠키만 | XSS 노출면 축소, refresh 로직 단일화 |
| 8 | 조회는 애그리거트를 거치지 않는 CQRS-lite | 불변식은 쓰기에만 필요 |
| 9 | BFF와 프론트에는 헥사고날을 적용하지 않고 FSD | 보호할 도메인이 없음. App Router와 충돌 |
| 10 | 계약은 ts-rest + Zod. tRPC 기각 | REST 유지 — API 문서를 보여줄 수 있어야 함 |
| 11 | 목 라이브러리 대신 손으로 쓴 fake | 상태 검증, 재사용, 계약 테스트 가능 |
| 12 | 리포지토리 계약 테스트로 fake와 실물의 동일성 보장 | fake 드리프트 방지 |
| 13 | 로컬 DB는 Docker Postgres 17 (PGlite 기각) | PGlite는 동시 트랜잭션이 격리되지 않아 경합 테스트가 거짓 통과 |
| 14 | 예약 기반 사가 + Outbox + TTL 자가치유 | 컨텍스트 경계 유지, 보상 실패에도 결국 정합 |

---

## 13. 성공 기준

이 사이클이 끝났을 때 다음이 참이어야 한다.

**기능**

- [ ] 회원가입 → 로그인 → 상품 조회 → 장바구니 → 주문 → 결제 성공 → 주문 완료가 E2E로 통과
- [ ] 결제 거절 시 재고 예약이 해제되고 주문이 PAYMENT_FAILED로 끝남 (E2E)
- [ ] PAID 상태 주문 취소 시 환불되고 재고가 복원됨 (E2E)
- [ ] 예약 TTL이 만료되면 스케줄러가 재고를 자동 회복함
- [ ] 주소록 CRUD와 기본 배송지 지정이 동작하고, 주문에는 주소가 스냅샷으로 남음

**아키텍처**

- [ ] `pnpm arch:check`가 통과하고, 규칙을 일부러 어기면 실패함을 확인
- [ ] `docs/architecture.svg`가 생성되고 순환 참조가 없음
- [ ] `apps/api/src/modules/*/domain/**`에 `@nestjs`, `@prisma/client`, contracts import가 0건
- [ ] `InProcessInventoryAdapter` 한 파일만 고쳐 Inventory 호출 경로를 바꿀 수 있음

**테스트**

- [ ] 재고 1개에 동시 예약 50건 → 정확히 1건 성공이 **두 락 전략 모두에서** 통과
- [ ] 같은 계약 테스트가 in-memory와 Prisma 리포지토리 양쪽에서 통과
- [ ] Outbox: 트랜잭션 롤백 시 이벤트 row도 사라짐 / 릴레이가 중복 발행하지 않음
- [ ] 도메인 커버리지 95%, 애플리케이션 90% 이상
- [ ] 프론트 MSW 핸들러가 contracts 스키마로 검증되어, 계약 변경 시 깨짐

**산출물**

- [ ] README에 아키텍처 그래프와 락 전략 벤치마크 표 (초과 판매·처리량·재시도 횟수)

---

## 14. 다음 단계

1. 이 스펙을 검토·승인
2. 구현 계획(implementation plan) 작성 — 태스크 단위로 분해
3. TDD로 태스크별 구현
