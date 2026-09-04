# Commerce — 헥사고날 아키텍처 학습 프로젝트

Next.js + Nest.js + TypeScript로 커머스 주문 파이프라인을 구현한다.
백엔드는 헥사고날 아키텍처(포트 & 어댑터) + DDD, 프론트는 Feature-Sliced Design을 쓰며,
양쪽의 의존성 규칙을 `pnpm verify`(로컬)로 강제한다. CI 연결은 이후 계획에서 다룬다.

## 시작하기

```bash
pnpm install
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local   # SESSION_PASSWORD는 32자 이상이어야 한다
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
| `pnpm verify` | 로컬에서 도는 전체 검증 (lint + 아키텍처 검증 + 타입 체크 + 테스트). CI 연결은 아직 없다 |
| `pnpm test:unit` | DB 없이 도는 단위 테스트 |
| `pnpm test:int` | 실제 Postgres를 쓰는 통합 테스트 |
| `pnpm arch:check` | 아키텍처 경계 규칙 검증 |
| `pnpm arch:graph` | 의존성 그래프 SVG 생성. graphviz(`dot`)가 설치된 환경에서만 동작하며, 생성물은 커밋하지 않는다 |
| `pnpm test:e2e` | Playwright 브라우저 E2E. `pnpm db:up`이 먼저 필요하고 `pnpm verify`에는 들어 있지 않다 |

## 주문 사가

주문·재고·결제는 서로 다른 애그리거트이고 다른 컨텍스트에 있다. 결제는 외부 PG
호출이라 원칙 이전에 물리적으로 한 트랜잭션에 넣을 수 없다 — 외부 응답을 기다리며
DB 트랜잭션을 열어두면 커넥션 풀이 말라죽는다.

예약 기반 사가 + 보상 트랜잭션으로 푼다.

```
1. Order 생성                 PENDING_PAYMENT       [트랜잭션 1]
2. 줄마다 재고 예약            Reservation, TTL 15분  [Inventory의 트랜잭션]
3. 결제 승인                   외부 PG                [트랜잭션 없음]
4a. 승인 → markPaid()          → OrderPaid           [트랜잭션 3]
        → Inventory 구독 → 예약 확정 (재고 차감)
4b. 거절 → failPayment()       → OrderPaymentFailed  [트랜잭션 3]
        → Inventory 구독 → 예약 해제
5. 어느 단계가 유실돼도 → TTL 만료 스캔이 예약을 회수하고
                          StockReservationExpired가 주문을 실패로 끝낸다
```

**5번이 설계의 요체다.** 보상 트랜잭션 자체가 실패해도(서버가 죽어도) TTL이 결국
재고를 회복시킨다. 보상 로직을 신뢰할 수 없다는 전제로 설계했다.

`Order`의 상태 머신이 사가 상태를 겸한다 — 별도 사가 엔티티가 없다.

```
PENDING_PAYMENT ─결제 승인─→ PAID ─취소─→ REFUND_PENDING ─환불 완료─→ REFUNDED
       │
       ├─결제 거절 / 재고 부족 / TTL 만료─→ PAYMENT_FAILED
       └─취소─→ CANCELLED
```

`REFUND_PENDING`은 취소 요청과 환불 완료 사이의 상태다. 없으면 그 구간에 주문이
`PAID`로 남아 고객에게 거짓말을 하고, 취소가 멱등하지 않아 이벤트가 두 번 배달될 때
환불이 두 번 요청된다.

### 이벤트가 유실되지 않는 이유

상태 변경과 이벤트 발행이 **같은 트랜잭션**에서 일어난다(outbox 패턴). 별도 릴레이가
`published_at IS NULL`인 행을 폴링해 발행한다. 전달 보장은 at-least-once이므로
**구독자가 멱등해야 한다** — `Reservation`·`Order`·`Payment`의 전이 메서드가 전부
"이미 그 상태면 `false`"를 돌려주는 것이 그 요구를 갚는다.

구독자는 `@OnEvent(..., { suppressErrors: false })`로 등록한다. 기본값(`true`)이면
Nest가 리스너 예외를 삼켜 릴레이가 전송 성공으로 판단하고, 실패한 이벤트가 영영
사라진다 — 재시도·백오프·데드레터가 전부 죽은 코드가 된다.

재현: `pnpm test:int apps/api/test/saga`

## 프론트엔드

프론트에는 헥사고날을 적용하지 않고 Feature-Sliced Design을 쓴다. 프론트의 "도메인"은
서버 도메인의 그림자이고 보안상 신뢰할 수 없는 사본이라, 진짜 불변식은 서버에 있다.

레이어는 **아래로만** 의존한다.

```
views ← widgets ← features ← entities ← shared
```

`app/`(Next 라우팅)과 `src/server/`(BFF)는 레이어 밖이다. 백엔드와 **같은
dependency-cruiser 설정 파일**이 이 방향을 강제한다.

### `app/`이 페치하고 `views`는 그리기만 한다

`no-server-code-in-fsd` 규칙이 FSD 레이어에서 `src/server/`를 import하는 것을 막는다.
그래서 데이터 페치는 `app/`의 RSC가 하고 `views`는 props를 받는 순수 컴포넌트가 된다.

```
app/products/[id]/page.tsx   RSC. api-client로 페치하고 props로 넘긴다
  └─ views/product-detail    순수 컴포넌트 — Testing Library로 테스트된다
```

결과적으로 E2E가 덮어야 하는 것은 `app/`의 페치 3줄뿐이다.

### 조회와 변경의 경로가 다르다

| 작업 | 경로 |
|---|---|
| 조회 | RSC → `src/server/api-client` 직접 (이미 서버다) |
| 변경 | 클라이언트 → Route Handler(`app/api/*`) → Nest |
| 인증 | Route Handler (`Set-Cookie`가 필요하다) |

브라우저는 액세스 토큰을 보지 않는다. 토큰 주입과 401 시 refresh 재시도가 BFF
한 곳(`src/server/api-client.ts`)에 모인다.

### 테스트

프론트의 seam은 포트가 아니라 **네트워크**다. MSW가 그 자리이고 핸들러는
`@commerce/contracts`의 Zod 스키마로 요청과 응답을 검증한다 — 백엔드 계약이 바뀌면
프론트 목이 즉시 깨진다.

| 레이어 | 테스트 | TDD |
|---|---|---|
| `shared/lib`, `entities/*/model` | Vitest 단위 | 적용 |
| `features/*/model` (훅) | Vitest + `renderHook` + MSW | 적용 |
| `features/*/ui`, `widgets`, `views` | Testing Library + MSW | test-after |
| `app/` (RSC) | Playwright | 미적용 |

프론트에는 커버리지 임계값을 걸지 않는다. 스펙 §9.11이 "경로별로 건다"고 했고,
프론트에는 지킬 불변식이 없다 — UI 커버리지 목표는 렌더링을 확인하는 무의미한
테스트를 양산한다.

## E2E

```bash
pnpm db:up
pnpm test:e2e
```

Playwright가 두 서버를 별도 포트(3100/3101)로 띄우므로 개발 서버를 켜둔 채 돌릴 수
있다. **`pnpm verify`에는 들어 있지 않다** — 두 서버와 브라우저를 띄우는 비용을
커밋마다 치르지 않기 위해서다. CI가 붙으면 별도 잡으로 넣는다.

스펙이 정한 일곱 영역을 덮는다: 회원가입/로그인, 상품 조회, 장바구니, 주문 성공,
결제 거절 보상, 주문 취소 환불, 재고 부족. 테스트는 10개이고 셋은 같은 화면의
부정 경로다(잘못된 비밀번호, 미인증 리다이렉트, 장바구니에서 빼기).

## 재고 락 전략 벤치마크

같은 도메인 코드와 **같은 테스트**를 두 어댑터에 돌린 결과다. 포트 하나(`StockRepository`)
뒤에 어댑터가 둘 있고, 도메인도 유스케이스도 계약 테스트도 어느 쪽인지 모른다.

재현: `pnpm test:int apps/api/src/modules/inventory/adapters/out/persistence/stock-concurrency.integration.spec.ts`

| 전략 | 시나리오 | 성공 | 초과 판매 | 재시도 | 소요 |
|---|---|---|---|---|---|
| 비관적 (`SELECT … FOR UPDATE`) | 재고 1 / 동시 50 | 1 | 0 | — | 195ms |
| 낙관적 (`version` + 재시도) | 재고 1 / 동시 50 | 1 | 0 | 19 | 49–53ms |
| 비관적 | 재고 10 / 동시 30 | 10 | 0 | — | 58–61ms |
| 낙관적 | 재고 10 / 동시 30 | 10 | 0 | 28 | 74–77ms |

3회 연속 실행에서 성공 건수와 재시도 횟수는 **완전히 동일**했고 소요 시간만 위 범위로
움직였다. `StockContentionError`(재시도 한도 초과)는 한 번도 나오지 않았다 — 기본
한도 20회 안에서 모든 경합이 해소됐다.

**기본값은 비관적 락이다** (`inventory.module.ts`의 한 줄). 두 시나리오가 서로 반대
방향을 가리키는 것이 이 표의 핵심이다.

- 재고 1개에 50건이 몰리면 비관적 쪽이 4배 느리다. 50개 트랜잭션이 한 행의 잠금을
  차례로 기다리는 반면, 낙관적 쪽은 첫 커밋 이후 도착한 요청들이 갱신된 값을 읽고
  재시도 없이 즉시 거절되기 때문이다.
- 재고 10개에 30건이면 뒤집힌다. 성공할 수 있는 요청이 많아지는 만큼 낙관적 쪽의
  재시도(28회)가 늘고, 그 재시도 비용이 잠금 대기 비용을 넘어선다.

실제 트래픽은 후자에 가깝다 — 재고가 정확히 1개 남은 순간보다 여유가 있는 순간이
압도적으로 많다. 그리고 비관적 쪽에는 `StockContentionError`라는 실패 모드가 아예
없다. 두 이유로 기본값을 비관적으로 두었다.

### 초과 판매를 실제로 막고 있다는 증거

"초과 판매 0"은 락이 없어도 요청이 직렬화되기만 하면 성립한다. 그래서 락을 일부러
망가뜨렸을 때 실제로 초과 판매가 나는지 확인했다.

| 훼손한 것 | 재고 1 / 동시 50 | 재고 10 / 동시 30 |
|---|---|---|
| 비관적에서 `FOR UPDATE` 제거 | 초과 판매 0 (판별 못 함) | **20건 초과 판매** |
| 낙관적에서 `WHERE version = …` 제거 | **19건 초과 판매** | **20건 초과 판매** |
| 낙관적 재시도가 다시 읽지 않게 변경 | **19건 초과 판매** | **20건 초과 판매** |

낙관적 어댑터의 재시도 횟수(19·28)가 0이 아니라는 것도 같은 역할을 한다 — 0이면
경합이 없었다는 뜻이고, 그러면 이 스위트는 아무것도 검증하지 않은 것이 된다.

## 구조

```
apps/api/       Nest — 헥사고날 (domain / application / adapters)
apps/web/       Next — FSD (shared → entities → features → widgets → views) + BFF
packages/contracts/   Zod 계약. DTO만 담으며 도메인 타입은 넣지 않는다
```

여섯 바운디드 컨텍스트가 전부 구현돼 있다 — `identity`, `customer`, `catalog`,
`inventory`, `payment`, `ordering`. 프론트엔드 상점 화면과 Playwright 브라우저 E2E도
끝났다. 남은 것은 스펙 §1.3이 처음부터 범위 밖으로 둔 것들(반품, 부분 환불, 역할 기반
인가, 소셜 로그인)과 각 계획 문서 끝의 이월 목록이다.

의존성 규칙은 `.dependency-cruiser.js`에 있고 `pnpm arch:check`가 강제한다.

## 문서

- 설계 스펙: `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`
- 구현 계획: `docs/superpowers/plans/`
