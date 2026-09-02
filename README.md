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
