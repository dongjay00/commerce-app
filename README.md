# Commerce — 헥사고날 아키텍처 학습 프로젝트

Next.js + Nest.js + TypeScript로 커머스 주문 파이프라인을 구현한다.
백엔드는 헥사고날 아키텍처(포트 & 어댑터) + DDD, 프론트는 Feature-Sliced Design을 쓰며,
양쪽의 의존성 규칙을 `pnpm verify`(로컬)로 강제한다. CI 연결은 이후 계획에서 다룬다.

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
| `pnpm verify` | 로컬에서 도는 전체 검증 (lint + 아키텍처 검증 + 타입 체크 + 테스트). CI 연결은 아직 없다 |
| `pnpm test:unit` | DB 없이 도는 단위 테스트 |
| `pnpm test:int` | 실제 Postgres를 쓰는 통합 테스트 |
| `pnpm arch:check` | 아키텍처 경계 규칙 검증 |
| `pnpm arch:graph` | 의존성 그래프 SVG 생성. graphviz(`dot`)가 설치된 환경에서만 동작하며, 생성물은 커밋하지 않는다 |

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

구현된 바운디드 컨텍스트는 `identity`, `customer`, `catalog`, `inventory` 넷이다.
`payment`와 `ordering`, 그리고 둘을 잇는 주문 사가는 다음 계획의 몫이다.

의존성 규칙은 `.dependency-cruiser.js`에 있고 `pnpm arch:check`가 강제한다.

## 문서

- 설계 스펙: `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`
- 구현 계획: `docs/superpowers/plans/`
