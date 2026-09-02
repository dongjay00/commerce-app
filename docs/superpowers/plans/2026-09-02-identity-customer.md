# Identity + Customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회원가입 → 로그인 → 세션 회전 → 비밀번호 변경 → 주소록 CRUD가 실제 Postgres 위에서 동작하고, 브라우저는 액세스 토큰을 한 번도 보지 않는 상태(BFF 암호화 쿠키 + 401 refresh 재시도)를 만든다.

**Architecture:** 계획 1이 만든 헥사고날 골격 위에 첫 두 개의 바운디드 컨텍스트를 얹는다. Identity(Generic)는 포트 6종 뒤에 가두고, Customer(Supporting)는 애그리거트 하나로 얇게 간다. 두 모듈은 서로의 내부를 모르며 `index.ts` 공개 API와 in-process 어댑터(ACL)로만 만난다. 인증은 스펙 결정 6대로 **인바운드 어댑터의 관심사**이고, 유스케이스는 확인된 `Principal`만 받는다.

**Tech Stack:** Nest.js 12, Prisma 7 + PostgreSQL 17, `@node-rs/argon2`(비밀번호 해싱), `jsonwebtoken`(액세스 토큰), Next.js 16 + `iron-session`(BFF 세션 쿠키), ts-rest + Zod 3, Vitest, Biome, dependency-cruiser

**Spec:** `docs/superpowers/specs/2026-09-01-commerce-ordering-design.md`

**선행 계획:** `docs/superpowers/plans/2026-09-02-foundation-skeleton.md` (완료, `main` `f97bd0d`)

---

## Global Constraints

스펙과 계획 1에서 그대로 가져온 값이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

### 아키텍처 경계

- **도메인 계층(`apps/api/src/modules/*/domain/**`, `apps/api/src/shared/kernel/**`)은 `@nestjs/*`, `@prisma/client`, `packages/contracts`를 import하지 않는다.** `vitest`를 제외한 **어떤 npm 패키지도** import하지 않는다 — `.dependency-cruiser.js`의 `kernel-and-domain-use-no-npm-packages`가 허용 목록으로 강제한다. 새 예외가 필요하면 `pathNot`을 넓히지 말고 목록에 한 줄 추가한다.
- **애플리케이션 계층(`modules/*/application/**`)은 `adapters/**`, `@prisma/client`, `shared/infrastructure/**`를 import하지 않는다.** 포트 인터페이스만 안다.
- **모듈 간 참조는 `modules/<name>/index.ts`로만 한다.** `domain/`, `application/`, `adapters/`, `testing/` 어느 것도 다른 모듈에서 직접 import할 수 없다.
- **도메인 예외에 HTTP 상태 코드를 넣지 않는다.** 매핑은 `DomainErrorRegistry`에서만 한다.
- **모든 새 `DomainError` 하위 클래스는 레지스트리에 등록해야 한다.** 등록하지 않으면 조용히 `{422, DOMAIN_RULE_VIOLATED}` 폴백으로 떨어진다 — 실패하지 않고 **틀린 응답을 낸다.** 등록은 각 모듈의 `*-domain-error-mappings.ts`에서 하고, `app.module.spec.ts`가 그 매핑을 직접 resolve해서 확인한다.
- **테스트 fake는 `shared/testing/` 또는 `modules/*/testing/`에만 둔다.** 운영 코드가 이들을 import하면 `no-test-doubles-in-production`이 잡는다.

### 테스트

- **목(mock) 라이브러리를 쓰지 않는다.** `vi.mock`, `vi.spyOn`으로 포트를 대체하는 것 금지. 아웃바운드 포트마다 손으로 쓴 fake를 만든다.
- **fake와 실물은 같은 계약 테스트를 통과해야 한다.** `modules/*/testing/*-repository.contract.ts`에 스위트를 한 번 쓰고 in-memory와 Prisma 양쪽에 돌린다.
- **시간은 `Clock` 포트로만 읽는다.** 도메인·유스케이스에서 `new Date()`/`Date.now()` 직접 호출 금지. Vitest fake timer도 쓰지 않는다 — 전역을 오염시켜 Prisma의 내부 타이머와 충돌한다.
- **테스트 DB는 `TEMPLATE` 복제로 워커별 격리**하고 파일 간에는 `TRUNCATE ... RESTART IDENTITY CASCADE`로 정리한다. 테스트를 트랜잭션으로 감싸 롤백하는 방식은 금지.
- **커버리지 임계값이 이 계획부터 실제로 발동한다.** `modules/*/domain/**` lines 95 / branches 90, `modules/*/application/**` lines 90 / branches 85. 어댑터에는 임계값을 걸지 않는다.
- **각 태스크는 "이 검사가 무엇을 잡는지 증명한다" 스텝을 하나 이상 갖는다.** 계획 1에서 통과하면서 아무것도 검증하지 않던 검사가 열 건 나왔다. 증명 절차는 항상 같은 모양이다: **(1) 운영 코드를 의도적으로 한 줄 바꾼다 → (2) 지목된 테스트가 지목된 메시지로 실패하는지 확인한다 → (3) 되돌리고 다시 통과하는지 확인한다.** 변경을 되돌리지 않은 채 다음 스텝으로 넘어가지 않는다.

### 도구·설치

- **설치 명령에는 반드시 버전을 고정한다.** 계획 1에서 버전 함정이 네 번 물었다(`prisma@latest`가 8.0.0-rc를 끌어와 84MB짜리 AWS SDK 트리를 설치, Prisma 7의 `datasource.url` 제거, `PrismaClient` 생성자의 `datasources` 제거, zod 4와 ts-rest peer 충돌). `pnpm add pkg`처럼 범위 없이 쓰지 말 것.
- **`zod`는 `^3.25.76`에 고정한다.** `@ts-rest/core@3.52.1`의 peer 범위가 `^3.22.3`이라 zod 4는 타입이 깨진다.
- **루트에서 `pnpm install`/`pnpm add -w`를 실행한 뒤에는 반드시 `pnpm db:generate`를 다시 돌린다.** 루트 설치가 생성된 Prisma 클라이언트를 무효화해서, 이 태스크와 무관해 보이는 "모듈을 찾을 수 없음" 오류로 테스트가 깨진다.
- **Nest가 주입하는 클래스는 값(value) import여야 한다.** Biome `useImportType` 자동 수정이 생성자 파라미터 전용 import를 `import type`으로 바꾸면 `design:paramtypes`가 `Object`가 되어 **DI가 조용히 깨진다.** 타입체크·린트·테스트가 전부 통과하고 서버를 띄웠을 때만 드러난다. 해당 import 위에 `// biome-ignore lint/style/useImportType: <이유>`를 남기고, DI 그래프 테스트(`app.module.spec.ts`)로 회귀를 잡는다.
- **`apps/api`는 `zod`를 직접 import하지 않는다.** apps/api의 `package.json`에 zod가 없어 `not-to-unresolvable`이 걸린다. 계약 스키마가 필요하면 구조적 타입(`interface SchemaParser<T> { parse(input: unknown): T }`)으로 받는다.
- **금액은 `bigint` 최소 단위 정수**로만 다룬다. 이 계획에는 금액이 없지만 제약은 유지된다.

### 검증

- 태스크를 끝낼 때마다 `pnpm verify`(= `lint` → `arch:check` → `typecheck` → `test:coverage`)가 통과해야 한다.
- `pnpm db:up`으로 Postgres 17 컨테이너가 떠 있어야 통합 테스트가 돈다.

---

## 스펙 대비 이 계획의 보완 사항과 편차

### 보완 1 — `AccessTokenVerifier`를 다섯 번째 횡단 포트로 추가한다

스펙 7.3은 횡단 포트를 `Clock`/`IdGenerator`/`TransactionManager`/`DomainEventPublisher` 넷으로 적었다. 여기에 `shared/kernel/ports/access-token-verifier.ts`를 더한다.

이유는 **순환 참조 회피**다. 인증 가드를 `identity` 모듈 안에 두고 `identity/index.ts`로 내보내면, 주소록 컨트롤러가 있는 `customer`가 `identity/index.ts`를 import하게 된다. 그런데 `identity`는 회원가입 시 Customer를 만들기 위해 `customer/index.ts`를 import해야 한다(스펙 4.2의 in-process 어댑터 패턴). 두 방향이 동시에 생기면 `no-circular`가 발화하고, 이건 규칙의 오탐이 아니라 실제 설계 결함이다.

해결: **가드를 `shared/infrastructure/http/`에 두고, 그것이 의존하는 것은 커널 포트 하나**로 만든다. `customer`는 `identity`를 전혀 모른다. 계획 1이 같은 이유로 `EventTransport` 포트를 추가한 것과 같은 종류의 보완이다.

### 보완 2 — `TokenIssuer` 포트가 리프레시 토큰까지 담당한다

스펙 7.6은 identity의 아웃바운드 포트로 `TokenIssuer → JWT` 하나만 적었다. 그런데 리프레시 토큰은 JWT가 아니라 **불투명 난수**여야 한다(즉시 무효화가 `sessions` 테이블의 근거여야 하므로 자기 완결적 토큰이면 안 된다). 포트를 하나 더 만드는 대신 `TokenIssuer`에 세 메서드를 둔다: `issueAccessToken` / `generateRefreshToken` / `hashRefreshToken`. 포트 목록은 스펙 그대로 6개를 유지한다.

### 편차 1 — `customers` 테이블에 `name` 컬럼을 두지 않는다

스펙 10.8은 `customers | id, account_id(unique), name`이라고 적었다. 그런데 스펙 7.6의 `SignUp`은 이메일과 비밀번호만 받고, 이 계획의 범위 안에 이름을 수집하는 화면이나 유스케이스가 없다. 컬럼을 만들면 **영구히 빈 문자열인 컬럼**이 하나 생긴다. 수취인 이름은 `saved_addresses.recipient`가 이미 갖고 있다.

이름 수집이 필요해지는 시점(프로필 화면)에 마이그레이션 한 줄로 추가한다.

### 편차 2 — 프론트엔드 화면은 이 계획에 없다

이 계획의 프론트 범위는 **BFF 배선까지**다: 암호화 쿠키 세션, 토큰 주입, 401 refresh 재시도, Route Handler 두 개. 로그인 폼·주소록 화면 같은 FSD 레이어 작업은 다음 계획으로 넘긴다.

이유는 스펙 9.9다. UI 컴포넌트에는 TDD를 적용하지 않기로 했고, `views`(RSC)는 E2E로 커버하기로 했는데 Playwright가 아직 없다. 화면을 지금 만들면 **테스트되지 않는 코드가 한 계획치만큼 쌓인다.** BFF 로직은 반대로 전부 테스트 가능하다(주입 가능한 `TokenStore` seam + MSW).

### 편차 3 — HTTP 통합 테스트가 "딱 1개"보다 많다

스펙 §9.4는 인바운드 어댑터 통합 테스트를 **배선 확인용 1개**로 제한한다. 비즈니스 케이스는 도메인·유스케이스 테스트가 이미 덮었으니 반복이 낭비라는 취지이고, 그 취지에는 동의한다.

그런데 이 계획에는 **단위 테스트가 구조적으로 볼 수 없는 것**이 네 가지 있다.

| 확인할 것 | 왜 단위로는 안 되나 |
|---|---|
| identity → customer ACL이 실제로 연결됐는가 | 두 모듈의 단위 테스트는 각자의 대역 위에서 돈다. 연결은 Nest 컨테이너가 만든다 |
| `DomainErrorRegistry` 매핑이 진짜 상태 코드를 내는가 | 등록 누락은 예외가 아니라 **폴백 422**로 조용히 나간다. 레지스트리를 직접 resolve하는 것과 응답을 보는 것은 다른 명제다 |
| 가드가 올바른 라우트에 걸렸는가 | `@UseGuards` 누락은 컨트롤러 단위 테스트로 잡히지 않는다 |
| 기본 배송지를 A→B로 옮길 때 부분 유니크 인덱스를 어기지 않는가 | 인덱스는 실제 DB에만 있다 |

각 통합 테스트는 이 넷 중 하나에 대응한다. 비즈니스 분기(예: "짧은 비밀번호는 거절")를 통합에서 다시 세는 것이 아니라, **각 케이스가 유스케이스 테스트가 볼 수 없는 층을 하나씩 고정한다.** 태스크 16의 목록에서 그 대응 관계를 확인할 수 있다.

### 계획 1이 남긴 이월 항목 중 이 계획이 처리하는 것

| 번호 | 내용 | 어디서 |
|---|---|---|
| **M6** | `Quantity.assertInteger`가 `< 1` 검사보다 먼저 돌아 `positive(-3.5)`가 500이 된다 | 태스크 1 |
| **M7** | `InvalidIdError`(400)가 읽기 경로에도 걸려, 깨진 행을 복원하는 리포지토리가 데이터 무결성 결함에 400을 답한다 | 태스크 1 |
| **M8** | `outbox_unpublished_idx`가 원시 마이그레이션 SQL에만 있고, 존재·사용 여부를 확인하는 자동 검사가 없다 | 태스크 9 |
| 이월 7 | 식별자 팩토리의 문자열-타입명 수동 동기화 (`makeIdFactory('OrderId')`와 `type OrderId`) | 태스크 1 |
| 이월 23 | `healthContract` 응답 스키마가 non-strict — 서버가 계약에 없는 필드를 추가해도 통과 | 태스크 2 |
| 이월 25 | 통합 spec이 `process.env['DATABASE_URL']`을 복원하지 않아 같은 워커의 이후 spec에 샌다 | 태스크 1 |
| 이월 1 | `biome.jsonc`의 `$schema`가 설치 버전과 불일치 | 태스크 1 |
| 이월 2 | `@types/uuid`가 불필요 (uuid v9+ 자체 타입 제공) | 태스크 1 |
| 이월 24 | `arch:graph`가 위반이 있을 때 단락되어, 그래프가 가장 필요한 순간에 생성되지 않는다 | 태스크 1 |

나머지 이월 항목(5, 6, 16~22 등)은 각각이 지목한 계획(3·4)에서 처리한다.

---

## File Structure

### 계획 1 산출물 중 수정하는 것

| 파일 | 무엇을 |
|---|---|
| `apps/api/src/shared/kernel/identifiers.ts` | `fromPersistence` 추가(M7), 타입을 팩토리에서 파생(이월 7), `SessionId` 추가 |
| `apps/api/src/shared/kernel/quantity.ts` | 비정수 입력을 `DomainError`로 승격(M6) |
| `apps/api/src/shared/infrastructure/http/kernel-domain-error-mappings.ts` | 새 커널 예외 코드 등록 |
| `packages/contracts/src/shared/error-codes.ts` | `ErrorCode` 3종 추가 |
| `packages/contracts/src/health/health.contract.ts` | `.strict()` (이월 23) |
| `packages/contracts/src/index.ts` | 새 계약 재수출 + 루트 라우터 |
| `apps/api/prisma/schema.prisma` | 모델 4종 |
| `apps/api/src/app.module.ts` / `app.module.spec.ts` | 두 모듈 등록 + DI·매핑 검증 |
| `apps/web/src/shared/api/contract-client.ts` | 루트 계약으로 교체 |
| `apps/web/src/server/api-client.ts` | 토큰 주입 + refresh 재시도 |
| `.env.example`, `docker-compose.yml`은 그대로, `apps/web/.env.example` 신규 |

### 공유 인프라 (신규)

| 파일 | 책임 |
|---|---|
| `shared/kernel/ports/access-token-verifier.ts` | `Principal` 타입 + 검증 포트. 프레임워크를 모른다 |
| `shared/infrastructure/auth/jwt-token.service.ts` | HS256 서명·검증. `AccessTokenVerifier` 구현. 발급과 검증이 한 클래스라 비밀키·클레임이 갈라질 수 없다 |
| `shared/infrastructure/auth/jwt.config.ts` | `JWT_SECRET`/`ACCESS_TOKEN_TTL_SECONDS` 읽기. 짧은 비밀키는 부팅 시 거부 |
| `shared/infrastructure/http/access-token.guard.ts` | `Authorization: Bearer` → `request.principal` |
| `shared/infrastructure/http/current-principal.decorator.ts` | `@CurrentPrincipal()` |
| `shared/infrastructure/http/unauthenticated.error.ts` | 401용 `DomainError` |
| `shared/infrastructure/http/zod-validation.pipe.ts` | 형식 검증(스펙 8.4). zod를 import하지 않고 구조적 타입으로 받는다 |

### modules/identity

| 파일 | 책임 |
|---|---|
| `domain/email.ts` | 이메일 VO. 정규화(trim+소문자)가 유일성의 근거 |
| `domain/plain-password.ts` | 평문 비밀번호 VO. 길이 정책 + 로그 유출 방지 |
| `domain/credential.ts` | 해시 VO (스펙 5.1의 `Credential`) |
| `domain/account.ts` | Account 애그리거트 루트 |
| `domain/account.errors.ts` / `account.events.ts` | |
| `domain/session.ts` / `session.errors.ts` | Session 애그리거트. 만료·회전·폐기 |
| `application/ports/in/{sign-up,sign-in,refresh-session,sign-out,change-password}.usecase.ts` | |
| `application/ports/out/{account.repository,session.repository,password-hasher,token-issuer,email-sender,customer-directory,identity-provider}.ts` | |
| `application/services/*.service.ts` | 유스케이스 5종 |
| `adapters/out/hashing/argon2-password.hasher.ts` | |
| `adapters/out/token/jwt-token.issuer.ts` | `JwtTokenService` 위임 + 리프레시 난수/해시 |
| `adapters/out/email/console-email.sender.ts` | |
| `adapters/out/persistence/{prisma-account.repository,prisma-session.repository,account.mapper,session.mapper}.ts` | |
| `adapters/out/customer/in-process-customer.adapter.ts` | ACL. `customer/index.ts`만 본다 |
| `adapters/in/http/{auth.controller,identity-domain-error-mappings}.ts` | |
| `testing/*` | fake 6종 + 계약 테스트 2종 + fixtures |
| `identity.module.ts` / `index.ts` | |

### modules/customer

| 파일 | 책임 |
|---|---|
| `domain/address-details.ts` | 주소 상세 VO (수취인·전화·우편번호·주소 2줄) |
| `domain/saved-address.ts` | 주소록 항목 엔티티 (id 보유) |
| `domain/address-book.ts` | 내부 엔티티. **기본 배송지 0 또는 1개** 불변식 |
| `domain/customer.ts` | Customer 애그리거트 루트 |
| `domain/customer.errors.ts` | |
| `application/ports/in/{provision-customer,add-address,update-address,delete-address,set-default-address}.usecase.ts` + `queries/get-address-book.query.ts` | |
| `application/ports/out/{customer.repository,address.query}.ts` | 쓰기는 애그리거트, 조회는 DTO 직결(스펙 7.2) |
| `application/services/*.service.ts` | |
| `adapters/out/persistence/{prisma-customer.repository,prisma-address.query,customer.mapper}.ts` | |
| `adapters/in/http/{address.controller,customer-domain-error-mappings}.ts` | |
| `testing/*` | in-memory 리포지토리 + 계약 테스트 + fixtures |
| `customer.module.ts` / `index.ts` | |

### packages/contracts

| 파일 | 책임 |
|---|---|
| `src/identity/auth.contract.ts` | 인증 엔드포인트 5종 |
| `src/customer/address.contract.ts` | 주소록 엔드포인트 5종 |
| `src/api.contract.ts` | 세 계약을 합친 루트 라우터 |

### apps/web (BFF)

| 파일 | 책임 |
|---|---|
| `src/server/token-store.ts` | `TokenStore` 인터페이스. 테스트 seam |
| `src/server/session.ts` | `iron-session` 암호화 쿠키 구현. `server-only` |
| `src/server/api-client.ts` | ts-rest `api` 훅으로 토큰 주입 + 401 재시도 1회 |
| `src/server/auth-actions.ts` | sign-in / sign-out 동작. 주입된 store만 본다 |
| `app/api/auth/sign-in/route.ts`, `app/api/auth/sign-out/route.ts` | 3줄짜리 접착제 |
| `src/shared/api/msw/handlers/auth.ts` | 계약 스키마로 검증하는 핸들러 |

---

## 태스크 목록

| # | 태스크 | 산출물 |
|---|---|---|
| 1 | 계획 1 잔여 정리 — 커널 + 도구 | `fromPersistence`(M7), 파생 식별자 타입, `SessionId`, `Principal` 포트, M6, 위생 4건 |
| 2 | 계약 패키지 — 인증·주소록 | `ErrorCode` 3종, 계약 2개, 루트 라우터, `.strict()` 규약 |
| 3 | Identity 도메인 — VO 3종 | `Email`, `PlainPassword`, `Credential` |
| 4 | Identity 도메인 — `Account` | 애그리거트 + `AccountRegistered` |
| 5 | Identity 도메인 — `Session` | 만료·회전·폐기 불변식 |
| 6 | Identity 애플리케이션 — 포트와 fake | 아웃바운드 포트 7종, fake 6종, 리포지토리 계약 2종 |
| 7 | Identity 애플리케이션 — SignUp / SignIn | |
| 8 | Identity 애플리케이션 — Refresh / SignOut / ChangePassword | |
| 9 | 영속 스키마 | 테이블 4종 + 부분 유니크 인덱스 + 인덱스 감시(M8) |
| 10 | Identity 아웃바운드 어댑터 | Argon2 / JWT / 콘솔 메일러 |
| 11 | Identity 영속 어댑터 | Prisma 리포지토리 2종 + 계약 테스트 + 동시 가입 경합 |
| 12 | Customer 도메인 | `AddressDetails`, `SavedAddress`, `AddressBook`, `Customer` |
| 13 | Customer 애플리케이션 | 포트 2종, 유스케이스 5종, fake, 계약 테스트 |
| 14 | Customer 영속 어댑터 | Prisma 리포지토리 + 조회 포트 |
| 15 | 공유 인바운드 인프라 | `ZodValidationPipe`, `AccessTokenGuard`, `@CurrentPrincipal` |
| 16 | 컨트롤러 + 모듈 배선 + ACL | 컨트롤러 2종, Nest 모듈 2종, identity→customer 연결, 경계 규칙 2종 |
| 17 | BFF | 암호화 쿠키 세션 + 401 refresh 재시도 + Route Handler |

의존 관계: 1 → 2 → (3 → 4 → 5 → 6 → 7 → 8) ∥ (12 → 13). 9는 10·11·14보다 먼저. 15는 16보다 먼저. 16은 11과 14가 끝난 뒤. 17은 16 뒤.

---

### Task 1: 계획 1 잔여 정리 — 커널과 도구

**Files:**
- Modify: `apps/api/src/shared/kernel/identifiers.ts`
- Modify: `apps/api/src/shared/kernel/identifiers.spec.ts`
- Modify: `apps/api/src/shared/kernel/quantity.ts`
- Modify: `apps/api/src/shared/kernel/quantity.spec.ts`
- Create: `apps/api/src/shared/kernel/ports/access-token-verifier.ts`
- Modify: `apps/api/src/shared/infrastructure/http/kernel-domain-error-mappings.ts`
- Modify: `apps/api/src/shared/infrastructure/http/domain-error.registry.spec.ts`
- Modify: `apps/api/src/app.module.spec.ts`
- Modify: `apps/api/src/shared/infrastructure/http/health.controller.integration.spec.ts`
- Modify: `biome.jsonc`, `package.json`, `apps/api/package.json`

**Interfaces:**
- Consumes: `DomainError`(`apps/api/src/shared/kernel/domain-error.ts`, `abstract readonly code: string`), `DomainErrorRegistry.register(errorCode: string, mapping: { status: number; code: ErrorCode })`
- Produces:
  - `<IdName>.of(value: string)` — 인바운드 경로용. 실패 시 `InvalidIdError`(400)
  - `<IdName>.fromPersistence(value: string)` — 영속 복원용. 실패 시 `CorruptedRecordError`(500, `DomainError`가 **아님**)
  - `SessionId` (값 + 타입)
  - `interface Principal { accountId: AccountId; customerId: CustomerId }`
  - `interface AccessTokenVerifier { verify(token: string): Promise<Principal> }`, `const ACCESS_TOKEN_VERIFIER: symbol`
  - `NonIntegerQuantityError`(코드 `QUANTITY_NOT_INTEGER`, 400)

- [ ] **Step 1: `identifiers.ts`의 실패 테스트를 쓴다**

`apps/api/src/shared/kernel/identifiers.spec.ts`의 끝에 추가한다.

```ts
import { AccountId, CorruptedRecordError, CustomerId, InvalidIdError, SessionId } from './identifiers';

const VALID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b';
const BROKEN = 'not-a-uuid';

describe('경로별 실패 분류', () => {
  it('인바운드 경로(of)의 실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => AccountId.of(BROKEN)).toThrow(InvalidIdError);
    // DomainError 하위 클래스여야 예외 필터가 400으로 옮긴다.
    expect(() => AccountId.of(BROKEN)).toThrow(DomainError);
  });

  it('영속 복원 경로(fromPersistence)의 실패는 DomainError가 아니다 — 저장된 데이터가 깨진 것이다', () => {
    expect(() => AccountId.fromPersistence(BROKEN)).toThrow(CorruptedRecordError);
    // 여기가 이 테스트의 핵심이다. DomainError였다면 예외 필터가 400을 내보내
    // "당신의 요청이 잘못됐다"고 거짓말한다. 실제로는 우리 DB가 깨진 것이므로 500이 맞다.
    expect(() => AccountId.fromPersistence(BROKEN)).not.toThrow(DomainError);
  });

  it('두 경로 모두 정상 UUID는 통과시키고 값을 보존한다', () => {
    expect(AccountId.of(VALID)).toBe(VALID);
    expect(AccountId.fromPersistence(VALID)).toBe(VALID);
  });

  it('SessionId가 존재하고 다른 식별자와 섞이지 않는다', () => {
    const session: SessionId = SessionId.of(VALID);
    const customer: CustomerId = CustomerId.of(VALID);
    // @ts-expect-error SessionId는 CustomerId에 대입할 수 없다 (branded type).
    const wrong: CustomerId = session;
    expect(wrong).toBe(customer);
  });
});
```

`DomainError`를 파일 상단 import에 추가한다: `import { DomainError } from './domain-error';`

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/shared/kernel/identifiers.spec.ts`
Expected: FAIL — `CorruptedRecordError`가 export되지 않았고 `fromPersistence`/`SessionId`가 없다.

- [ ] **Step 3: `identifiers.ts`를 다시 쓴다**

```ts
import { DomainError } from './domain-error';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * 바깥에서 들어온 값(HTTP 본문·경로 파라미터)이 UUID 형식이 아닐 때 던진다.
 * 스펙 §8.4상 형식 검증은 어댑터(Zod)의 책임이라 여기 도달하는 건 원칙적으로 방어선이
 * 하나 더 있는 것이다. DomainError로 등록해 400을 내는 이유는 `GET /orders/abc`처럼
 * 이미 검증을 우회해 값 객체까지 도달한 잘못된 입력에 500을 돌려주는 것이 클라이언트에게
 * 거짓을 말하는 것이기 때문이다.
 */
export class InvalidIdError extends DomainError {
  static readonly CODE = 'INVALID_ID';
  readonly code = InvalidIdError.CODE;

  constructor(kind: string, value: string) {
    super(`${kind}는 UUID 형식이어야 합니다: "${value}"`);
  }
}

/**
 * 데이터베이스에서 읽어온 값이 UUID 형식이 아닐 때 던진다.
 *
 * `InvalidIdError`와 갈라놓은 이유가 이 파일에서 가장 중요한 판단이다. 두 경로가 같은
 * 예외를 던지면 **저장된 행이 깨진 상황에 400을 응답한다** — 클라이언트에게 "당신의
 * 요청이 잘못됐다"고 말하는 것인데, 요청은 멀쩡했고 우리 데이터가 깨진 것이다.
 * 사용자가 고칠 수 있는 게 없으므로 DomainError로 만들지 않고 500으로 떨어뜨린다.
 *
 * 영속 어댑터의 매퍼는 **반드시 `fromPersistence`를 쓴다.** `of`를 쓰면 위의 거짓말이
 * 그대로 돌아온다.
 */
export class CorruptedRecordError extends Error {
  constructor(kind: string, value: string) {
    super(`저장된 ${kind} 값이 UUID 형식이 아닙니다: "${value}"`);
    this.name = 'CorruptedRecordError';
    Error.captureStackTrace?.(this, CorruptedRecordError);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeIdFactory<T extends string>(kind: T) {
  return {
    /** 인바운드 경로 전용. 실패는 사용자 입력 오류(400). */
    of(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new InvalidIdError(kind, value);
      }
      return value as Brand<string, T>;
    },
    /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
    fromPersistence(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new CorruptedRecordError(kind, value);
      }
      return value as Brand<string, T>;
    },
  };
}

// 타입 별칭을 손으로 쓰지 않고 팩토리 반환값에서 파생시킨다.
// 예전에는 `makeIdFactory('OrderId')`의 문자열 리터럴과 `type OrderId = Brand<string,'OrderId'>`를
// 사람이 맞춰야 했고 둘을 묶는 컴파일 검사가 없었다 — 식별자가 늘어날수록 복사-붙여넣기
// 실수가 조용히 통과한다. 아래 형태에서는 리터럴이 타입의 유일한 출처다.
export const OrderId = makeIdFactory('OrderId');
export type OrderId = ReturnType<typeof OrderId.of>;

export const CartId = makeIdFactory('CartId');
export type CartId = ReturnType<typeof CartId.of>;

export const SkuId = makeIdFactory('SkuId');
export type SkuId = ReturnType<typeof SkuId.of>;

export const ProductId = makeIdFactory('ProductId');
export type ProductId = ReturnType<typeof ProductId.of>;

export const CustomerId = makeIdFactory('CustomerId');
export type CustomerId = ReturnType<typeof CustomerId.of>;

export const AccountId = makeIdFactory('AccountId');
export type AccountId = ReturnType<typeof AccountId.of>;

export const SessionId = makeIdFactory('SessionId');
export type SessionId = ReturnType<typeof SessionId.of>;

export const ReservationId = makeIdFactory('ReservationId');
export type ReservationId = ReturnType<typeof ReservationId.of>;

export const PaymentId = makeIdFactory('PaymentId');
export type PaymentId = ReturnType<typeof PaymentId.of>;

export const AddressId = makeIdFactory('AddressId');
export type AddressId = ReturnType<typeof AddressId.of>;
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/shared/kernel/identifiers.spec.ts`
Expected: PASS

- [ ] **Step 5: 이 검사가 무엇을 잡는지 증명한다 (M7 + 이월 7)**

두 가지를 각각 증명한다. 반드시 하나씩 하고 매번 되돌린다.

**(a) `fromPersistence`가 실제로 다른 예외를 던지는가**
`identifiers.ts`의 `fromPersistence` 본문을 `return this.of(value);`로 바꾼다(객체 리터럴이라 `this`가 팩토리를 가리킨다). 테스트를 돌린다.
Expected: `expect(...).not.toThrow(DomainError)`가 실패한다.
되돌리고 다시 통과하는지 확인한다.

**(b) 파생 타입이 실제로 드리프트를 막는가**
`export type SessionId = ReturnType<typeof SessionId.of>;`를 `export type SessionId = ReturnType<typeof CustomerId.of>;`로 바꾼다.
Run: `pnpm typecheck`
Expected: FAIL — `identifiers.spec.ts`의 `@ts-expect-error` 줄에서 `Unused '@ts-expect-error' directive` 오류가 난다. 두 타입이 같아져 대입이 성공해버리기 때문이다.
되돌리고 `pnpm typecheck`가 통과하는지 확인한다.

이 (b)가 이월 7의 핵심이다. 예전 형태였다면 타입 별칭이 틀려도 컴파일러가 아무 말도 하지 않았다.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/shared/kernel/identifiers.ts apps/api/src/shared/kernel/identifiers.spec.ts
git commit -m "fix(kernel): 영속 복원 경로를 인바운드 경로와 분리하고 식별자 타입을 팩토리에서 파생한다 (M7, 이월 7)"
```

- [ ] **Step 7: M6 — 비정수 수량의 실패 테스트를 쓴다**

`apps/api/src/shared/kernel/quantity.spec.ts`에 추가한다.

```ts
import { DomainError } from './domain-error';
import { NonIntegerQuantityError, Quantity, QuantityBelowMinimumError } from './quantity';

describe('비정수 입력의 분류 (M6)', () => {
  it('positive(-3.5)는 DomainError다 — 500이 아니다', () => {
    // 예전에는 assertInteger가 InvalidQuantityError(일반 Error)를 던져 500이 났다.
    // 사용자가 보낸 값 하나 때문에 서버 오류를 내는 것은 정직하지 않다.
    expect(() => Quantity.positive(-3.5)).toThrow(NonIntegerQuantityError);
    expect(() => Quantity.positive(-3.5)).toThrow(DomainError);
  });

  it('positive(2.5)도 같은 분류다', () => {
    expect(() => Quantity.positive(2.5)).toThrow(NonIntegerQuantityError);
  });

  it('of(2.5)도 같은 분류다', () => {
    expect(() => Quantity.of(2.5)).toThrow(NonIntegerQuantityError);
  });

  it('정수이면서 1 미만인 값은 여전히 QuantityBelowMinimumError다', () => {
    // 두 실패가 서로 다른 코드를 갖는지가 중요하다. 하나로 뭉치면 프론트가
    // "정수를 넣으세요"와 "1개 이상 담으세요"를 구분해 안내할 수 없다.
    expect(() => Quantity.positive(0)).toThrow(QuantityBelowMinimumError);
    expect(() => Quantity.positive(-3)).toThrow(QuantityBelowMinimumError);
  });

  it('NonIntegerQuantityError와 QuantityBelowMinimumError의 코드가 서로 다르다', () => {
    expect(NonIntegerQuantityError.CODE).not.toBe(QuantityBelowMinimumError.CODE);
  });
});
```

- [ ] **Step 8: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/shared/kernel/quantity.spec.ts`
Expected: FAIL — `NonIntegerQuantityError`가 없다.

- [ ] **Step 9: `quantity.ts`를 고친다**

`InvalidQuantityError`의 doc 주석을 아래로 교체하고, 새 클래스를 추가하고, `assertInteger`가 던지는 예외를 바꾼다.

```ts
/**
 * `of`에 음수가 들어온 경우처럼, 도달했다면 코드 버그인 상황에만 남긴다.
 * 재고 잔량이 음수가 되는 것은 사용자가 만들 수 있는 상태가 아니라 호출자의 버그다.
 * DomainError로 만들지 않으므로 500으로 떨어진다.
 */
export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

/**
 * 정수가 아닌 수량. 사용자가 보낸 값이 그대로 도달할 수 있는 자리이므로 DomainError로
 * 승격해 400을 낸다.
 *
 * 이전 구현은 `assertInteger`가 `InvalidQuantityError`(일반 Error)를 던졌고, 그 호출이
 * `< 1` 검사보다 **먼저** 있었다. 결과적으로 `positive(-3.5)`는 422가 아니라 500이 됐다.
 * 검사 순서를 바꾸는 대신 예외를 분류한 이유는, 순서만 바꾸면 `positive(2.5)`가 여전히
 * 500이라 반쪽짜리 수정이 되기 때문이다.
 *
 * 어댑터의 Zod 스키마는 이 예외에 의존하지 말고 `.int()`를 함께 걸어야 한다 —
 * 형식은 Zod가, 의미는 VO가 지킨다(스펙 §8.4). 이 예외는 그 방어선이 뚫렸을 때의 두 번째 그물이다.
 */
export class NonIntegerQuantityError extends DomainError {
  static readonly CODE = 'QUANTITY_NOT_INTEGER';
  readonly code = NonIntegerQuantityError.CODE;

  constructor(value: number) {
    super(`수량은 정수여야 합니다: ${value}`);
  }
}
```

`assertInteger`를 바꾼다.

```ts
  private static assertInteger(value: number): void {
    if (!Number.isInteger(value)) {
      throw new NonIntegerQuantityError(value);
    }
  }
```

- [ ] **Step 10: 새 코드를 레지스트리에 등록한다**

`apps/api/src/shared/infrastructure/http/kernel-domain-error-mappings.ts`의 import와 본문에 추가한다.

```ts
import {
  NegativeQuantityError,
  NonIntegerQuantityError,
  QuantityBelowMinimumError,
} from '../../kernel/quantity';
```

```ts
  registry.register(NonIntegerQuantityError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
```

- [ ] **Step 11: 조립된 레지스트리를 검증한다**

`apps/api/src/app.module.spec.ts`의 `'DomainErrorRegistry가 커널 예외 매핑을 갖춘 채 조립된다'` 테스트에 추가한다.

```ts
    expect(registry.resolve(NonIntegerQuantityError.CODE)).toEqual({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
    });
```

import도 함께 고친다: `import { NegativeQuantityError, NonIntegerQuantityError } from './shared/kernel/quantity';`

- [ ] **Step 12: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit`
Expected: PASS

- [ ] **Step 13: 이 검사가 무엇을 잡는지 증명한다 (M6)**

`kernel-domain-error-mappings.ts`에서 `NonIntegerQuantityError` 등록 블록을 주석 처리한다.
Run: `pnpm vitest run --project api-unit apps/api/src/app.module.spec.ts`
Expected: FAIL — `resolve`가 폴백 `{ status: 422, code: 'DOMAIN_RULE_VIOLATED' }`를 반환한다.

**이 실패 모양을 반드시 눈으로 확인할 것.** 등록을 빼먹으면 예외가 나지 않고 **틀린 상태 코드가 조용히 나간다.** 이 계획에서 앞으로 만들 모든 `DomainError`가 같은 함정을 갖는다.

되돌리고 다시 통과하는지 확인한다.

- [ ] **Step 14: 커밋**

```bash
git add apps/api/src/shared/kernel/quantity.ts apps/api/src/shared/kernel/quantity.spec.ts \
        apps/api/src/shared/infrastructure/http/kernel-domain-error-mappings.ts \
        apps/api/src/app.module.spec.ts
git commit -m "fix(kernel): 비정수 수량을 DomainError로 승격해 400을 내게 한다 (M6)"
```

- [ ] **Step 15: `AccessTokenVerifier` 커널 포트를 만든다**

Create `apps/api/src/shared/kernel/ports/access-token-verifier.ts`:

```ts
import type { AccountId, CustomerId } from '../identifiers';

/**
 * 인증이 끝난 호출자의 신원. 유스케이스는 **오직 이것만** 받는다 (스펙 결정 6).
 * 토큰 문자열, 헤더, 쿠키는 인바운드 어댑터 밖으로 나가지 않는다.
 *
 * `customerId`를 함께 담는 이유: 계정과 고객은 가입 시점에 1:1로 만들어지고, 주소록
 * 엔드포인트는 매 요청마다 그 매핑을 필요로 한다. 토큰이 들고 다니면 요청당 조회가 없다.
 */
export interface Principal {
  readonly accountId: AccountId;
  readonly customerId: CustomerId;
}

/**
 * 액세스 토큰을 검증해 Principal로 바꾸는 포트.
 *
 * 스펙 §7.3의 횡단 포트 목록(Clock/IdGenerator/TransactionManager/DomainEventPublisher)에
 * 없던 다섯 번째다. 여기 두는 이유는 순환 참조 회피다 — identity 모듈 안에 두면
 * customer의 컨트롤러가 identity를 import하게 되는데, identity는 가입 시 customer를
 * 만들려고 이미 customer를 import한다. 두 방향이 동시에 생기면 `no-circular`가 발화한다.
 * 인증 자체는 도메인 개념이 아니라 어느 모듈의 컨트롤러에나 필요한 횡단 관심사다.
 *
 * 실패 시 던지는 예외는 어댑터가 정한다 (`UnauthenticatedError`, 401).
 */
export interface AccessTokenVerifier {
  verify(token: string): Promise<Principal>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('AccessTokenVerifier');
```

이 파일에는 spec을 붙이지 않는다 — 타입 선언뿐이라 실행할 동작이 없다. 태스크 14가 구현체와 함께 테스트한다.

- [ ] **Step 16: 이월 25 — 통합 spec의 환경변수 누수를 막는다**

`apps/api/src/shared/infrastructure/http/health.controller.integration.spec.ts`가 `process.env['DATABASE_URL']`을 덮어쓰고 복원하지 않는다. `process.env`는 워커 프로세스 단위라 같은 워커의 이후 spec이 그 값을 상속한다. 이 계획이 통합 spec을 여섯 개 이상 늘리므로 지금 막는다.

파일 상단의 `beforeAll` 부근을 아래 형태로 고친다.

```ts
const originalDatabaseUrl = process.env['DATABASE_URL'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  // ... 기존 내용 유지
});

afterAll(async () => {
  // ... 기존 내용 유지
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});
```

기존 파일의 실제 구조를 먼저 읽고, `beforeAll`이 덮어쓰는 값을 그대로 두면서 `afterAll` 복원만 추가한다. `afterAll`이 없으면 새로 만든다.

- [ ] **Step 17: 도구 위생 3건을 고친다 (이월 1, 2, 24)**

**(a) `biome.jsonc`** — 첫 줄의 `$schema`를 설치된 버전으로 맞춘다.
`"$schema": "https://biomejs.dev/schemas/2.5.11/schema.json"`
(먼저 `node -p "require('./node_modules/@biomejs/biome/package.json').version"`로 실제 설치 버전을 확인하고 그 값을 쓴다.)

**(b) `apps/api/package.json`** — devDependencies에서 `"@types/uuid"` 줄을 삭제한다. uuid는 v9부터 자체 타입을 제공한다.

**(c) 루트 `package.json`** — `arch:graph`를 고친다.

```json
    "arch:graph": "depcruise --config .dependency-cruiser.js --output-type dot apps packages > docs/architecture.dot || true; dot -Tsvg docs/architecture.dot > docs/architecture.svg && rm docs/architecture.dot",
```

depcruise의 종료 코드는 **위반 개수**다. `&&`로 이으면 위반이 있을 때 단락되어, 그래프가 가장 필요한 순간(위반을 진단하는 중)에 생성되지 않는다.

- [ ] **Step 18: 설치와 재생성**

```bash
pnpm install
pnpm db:generate
```

두 번째 줄을 빼먹지 말 것 — 루트 설치가 생성된 Prisma 클라이언트를 무효화한다.

- [ ] **Step 19: 전체 검증**

Run: `pnpm verify`
Expected: exit 0. 테스트 수가 계획 1의 168개보다 늘어야 한다(새로 추가한 케이스만큼).

- [ ] **Step 20: 커밋**

```bash
git add apps/api/src/shared/kernel/ports/access-token-verifier.ts \
        apps/api/src/shared/infrastructure/http/health.controller.integration.spec.ts \
        biome.jsonc package.json apps/api/package.json pnpm-lock.yaml
git commit -m "chore: AccessTokenVerifier 포트 추가와 계획 1 이월 위생 항목 4건 정리"
```

---

### Task 2: 계약 패키지 — 인증과 주소록

**Files:**
- Modify: `packages/contracts/src/shared/error-codes.ts`
- Modify: `packages/contracts/src/shared/error-codes.spec.ts`
- Modify: `packages/contracts/src/health/health.contract.ts`
- Modify: `packages/contracts/src/health/health.contract.spec.ts`
- Create: `packages/contracts/src/identity/auth.contract.ts`
- Create: `packages/contracts/src/identity/auth.contract.spec.ts`
- Create: `packages/contracts/src/customer/address.contract.ts`
- Create: `packages/contracts/src/customer/address.contract.spec.ts`
- Create: `packages/contracts/src/api.contract.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `errorDtoSchema`, `ErrorCode` (`packages/contracts/src/shared/error-codes.ts`), `initContract` (`@ts-rest/core@3.52.1`), `zod@^3.25.76`
- Produces:
  - `ErrorCode.EMAIL_ALREADY_REGISTERED`, `ErrorCode.INVALID_CREDENTIALS`, `ErrorCode.PASSWORD_POLICY_VIOLATED`
  - `authContract` — `signUp` / `signIn` / `refresh` / `signOut` / `changePassword`
  - `addressContract` — `list` / `add` / `update` / `remove` / `setDefault`
  - `apiContract` — 세 계약을 합친 루트 라우터
  - `sessionTokensSchema` → `{ accessToken: string; refreshToken: string; expiresInSeconds: number }`
  - `addressDtoSchema` → `{ id, label, recipient, phone, zip, line1, line2, isDefault }`

**이 태스크가 지키는 스펙 규칙 (§8.4):** 형식 검증은 Zod, 의미 검증은 도메인. 비밀번호 **길이 정책은 Zod에 넣지 않는다** — `.min(10)`을 붙이는 순간 "10자 이상"이라는 규칙이 도메인 밖으로 샌다. Zod는 전송 상한(1024자)만 막고, 10~128자 정책은 `PlainPassword` VO가 지킨다(태스크 3).

- [ ] **Step 1: `ErrorCode` 3종의 실패 테스트를 쓴다**

`packages/contracts/src/shared/error-codes.spec.ts`에 추가한다.

```ts
describe('인증·회원 도메인 에러 코드', () => {
  it('세 코드가 존재하고 값이 이름과 같다', () => {
    expect(ErrorCode.EMAIL_ALREADY_REGISTERED).toBe('EMAIL_ALREADY_REGISTERED');
    expect(ErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(ErrorCode.PASSWORD_POLICY_VIOLATED).toBe('PASSWORD_POLICY_VIOLATED');
  });

  it('errorDtoSchema가 새 코드를 받아들인다', () => {
    const parsed = errorDtoSchema.parse({
      code: 'INVALID_CREDENTIALS',
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
    });
    expect(parsed.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project contracts packages/contracts/src/shared/error-codes.spec.ts`
Expected: FAIL — 세 멤버가 없다.

- [ ] **Step 3: `ErrorCode`에 세 멤버를 추가한다**

`packages/contracts/src/shared/error-codes.ts`의 enum에 추가한다.

```ts
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  PASSWORD_POLICY_VIOLATED = 'PASSWORD_POLICY_VIOLATED',
```

세션 만료/폐기에는 새 코드를 만들지 않고 기존 `UNAUTHENTICATED`를 쓴다. 프론트가 두 경우에 하는 일이 "재로그인"으로 똑같기 때문이다. 도메인 예외 클래스는 둘로 갈라져 있고(`SessionExpiredError` / `SessionRevokedError`) 서버 로그에서는 구분된다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run --project contracts packages/contracts/src/shared/error-codes.spec.ts`
Expected: PASS

- [ ] **Step 5: `.strict()` 규약의 실패 테스트를 쓴다 (이월 23)**

Create `packages/contracts/src/identity/auth.contract.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  changePasswordBodySchema,
  refreshBodySchema,
  sessionTokensSchema,
  signInBodySchema,
  signUpBodySchema,
} from './auth.contract';

describe('sessionTokensSchema', () => {
  const valid = { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 };

  it('정상 응답을 파싱한다', () => {
    expect(sessionTokensSchema.parse(valid)).toEqual(valid);
  });

  it('계약에 없는 필드를 거부한다', () => {
    // 이것이 이 테스트의 이유다. non-strict 스키마는 서버가 계약에 없는 필드를
    // 흘려보내도 조용히 통과시킨다 — 드리프트가 한 방향으로만 잡힌다.
    // 특히 accessToken 옆에 refreshToken 같은 비밀이 실수로 추가되는 경우를 막는다.
    expect(() => sessionTokensSchema.parse({ ...valid, accountId: 'leaked' })).toThrow();
  });

  it('expiresInSeconds는 양의 정수여야 한다', () => {
    expect(() => sessionTokensSchema.parse({ ...valid, expiresInSeconds: 900.5 })).toThrow();
    expect(() => sessionTokensSchema.parse({ ...valid, expiresInSeconds: 0 })).toThrow();
  });
});

describe('signUpBodySchema', () => {
  it('이메일 형식을 강제한다', () => {
    expect(() => signUpBodySchema.parse({ email: 'not-an-email', password: 'x'.repeat(12) })).toThrow();
  });

  it('비밀번호 길이 정책은 강제하지 않는다 — 도메인의 몫이다', () => {
    // 스펙 §8.4: Zod에 .min(10)을 붙이는 순간 "10자 이상"이라는 규칙이 도메인 밖으로 샌다.
    // Zod는 형식(문자열인가, 전송 상한을 넘지 않는가)만 본다.
    expect(() => signUpBodySchema.parse({ email: 'a@b.com', password: 'short' })).not.toThrow();
  });

  it('전송 상한(1024자)은 막는다 — 이건 형식이지 정책이 아니다', () => {
    expect(() => signUpBodySchema.parse({ email: 'a@b.com', password: 'x'.repeat(1025) })).toThrow();
  });

  it('추가 필드를 거부한다', () => {
    expect(() =>
      signUpBodySchema.parse({ email: 'a@b.com', password: 'x'.repeat(12), role: 'admin' }),
    ).toThrow();
  });
});

describe('signInBodySchema / refreshBodySchema / changePasswordBodySchema', () => {
  it('signIn은 이메일과 비밀번호를 요구한다', () => {
    expect(signInBodySchema.parse({ email: 'a@b.com', password: 'p' })).toEqual({
      email: 'a@b.com',
      password: 'p',
    });
  });

  it('refresh는 빈 리프레시 토큰을 거부한다', () => {
    expect(() => refreshBodySchema.parse({ refreshToken: '' })).toThrow();
  });

  it('changePassword는 현재/새 비밀번호를 모두 요구한다', () => {
    expect(() => changePasswordBodySchema.parse({ newPassword: 'x'.repeat(12) })).toThrow();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `pnpm vitest run --project contracts packages/contracts/src/identity/auth.contract.spec.ts`
Expected: FAIL — `auth.contract.ts`가 없다.

- [ ] **Step 7: `auth.contract.ts`를 만든다**

Create `packages/contracts/src/identity/auth.contract.ts`:

```ts
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

// 비밀번호의 상한 1024는 **형식** 제약이다 — 임의 길이 입력을 Argon2에 그대로 넘기면
// 해싱 비용이 입력 길이에 비례해 커진다. 실제 정책(10~128자)은 PlainPassword VO가 지킨다.
const passwordField = z.string().min(1).max(1024);
const emailField = z.string().email().max(254);

export const signUpBodySchema = z
  .object({ email: emailField, password: passwordField })
  .strict();

export const signInBodySchema = z
  .object({ email: emailField, password: passwordField })
  .strict();

export const refreshBodySchema = z.object({ refreshToken: z.string().min(1) }).strict();

export const changePasswordBodySchema = z
  .object({ currentPassword: passwordField, newPassword: passwordField })
  .strict();

export const sessionTokensSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresInSeconds: z.number().int().positive(),
  })
  .strict();

export type SignUpBody = z.infer<typeof signUpBodySchema>;
export type SignInBody = z.infer<typeof signInBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type SessionTokensDto = z.infer<typeof sessionTokensSchema>;

export const authContract = c.router({
  signUp: {
    method: 'POST',
    path: '/auth/sign-up',
    body: signUpBodySchema,
    responses: {
      201: sessionTokensSchema,
      400: errorDtoSchema, // VALIDATION_FAILED
      409: errorDtoSchema, // EMAIL_ALREADY_REGISTERED
      422: errorDtoSchema, // PASSWORD_POLICY_VIOLATED
    },
    summary: '이메일과 비밀번호로 가입하고 즉시 세션을 발급받는다',
  },
  signIn: {
    method: 'POST',
    path: '/auth/sign-in',
    body: signInBodySchema,
    responses: {
      200: sessionTokensSchema,
      401: errorDtoSchema, // INVALID_CREDENTIALS
    },
    summary: '로그인',
  },
  refresh: {
    method: 'POST',
    path: '/auth/refresh',
    body: refreshBodySchema,
    responses: {
      200: sessionTokensSchema,
      401: errorDtoSchema, // UNAUTHENTICATED — 만료·폐기·미존재를 모두 포함
    },
    summary: '리프레시 토큰을 회전시켜 새 세션을 받는다',
  },
  signOut: {
    method: 'POST',
    path: '/auth/sign-out',
    body: refreshBodySchema,
    responses: {
      204: c.noBody(),
    },
    summary: '세션을 폐기한다. 이미 없는 토큰이어도 204 (멱등)',
  },
  changePassword: {
    method: 'POST',
    path: '/auth/change-password',
    body: changePasswordBodySchema,
    responses: {
      204: c.noBody(),
      401: errorDtoSchema, // UNAUTHENTICATED 또는 INVALID_CREDENTIALS
      422: errorDtoSchema, // PASSWORD_POLICY_VIOLATED
    },
    summary: '비밀번호를 변경하고 다른 모든 세션을 폐기한다',
  },
});
```

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm vitest run --project contracts packages/contracts/src/identity/auth.contract.spec.ts`
Expected: PASS

- [ ] **Step 9: 이 검사가 무엇을 잡는지 증명한다**

`sessionTokensSchema`의 `.strict()`를 지운다.
Run: `pnpm vitest run --project contracts packages/contracts/src/identity/auth.contract.spec.ts`
Expected: FAIL — `'계약에 없는 필드를 거부한다'`만 실패하고 나머지는 통과한다. `.strict()`가 없으면 zod 객체 스키마는 알 수 없는 키를 **조용히 버린다**(오류가 아니다).
되돌리고 다시 통과하는지 확인한다.

- [ ] **Step 10: 주소록 계약의 실패 테스트를 쓴다**

Create `packages/contracts/src/customer/address.contract.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addressBodySchema, addressDtoSchema } from './address.contract';

const validBody = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울特別市 강남구 테헤란로 1',
  line2: '101동 1001호',
};

describe('addressBodySchema', () => {
  it('정상 입력을 파싱한다', () => {
    expect(addressBodySchema.parse(validBody)).toEqual(validBody);
  });

  it('line2는 생략할 수 있다', () => {
    const { line2: _omitted, ...withoutLine2 } = validBody;
    expect(addressBodySchema.parse(withoutLine2).line2).toBeUndefined();
  });

  it('빈 수취인을 거부한다', () => {
    expect(() => addressBodySchema.parse({ ...validBody, recipient: '' })).toThrow();
  });

  it('공백만 있는 수취인도 거부한다', () => {
    // .min(1)만으로는 ' '가 통과한다. 사용자가 스페이스 하나를 넣어 만든 주소는
    // 배송할 수 없는 주소다.
    expect(() => addressBodySchema.parse({ ...validBody, recipient: '   ' })).toThrow();
  });

  it('isDefault 같은 계약 밖 필드를 거부한다', () => {
    // 기본 배송지 지정은 전용 엔드포인트(setDefault)로만 한다. 생성/수정 본문으로
    // 받아들이면 "기본은 0 또는 1개" 불변식을 두 경로에서 지켜야 한다.
    expect(() => addressBodySchema.parse({ ...validBody, isDefault: true })).toThrow();
  });
});

describe('addressDtoSchema', () => {
  it('id와 isDefault를 포함한다', () => {
    const dto = {
      ...validBody,
      id: '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b',
      isDefault: true,
    };
    expect(addressDtoSchema.parse(dto)).toEqual(dto);
  });

  it('id가 uuid가 아니면 거부한다', () => {
    expect(() =>
      addressDtoSchema.parse({ ...validBody, id: 'nope', isDefault: false }),
    ).toThrow();
  });

  it('추가 필드를 거부한다', () => {
    expect(() =>
      addressDtoSchema.parse({
        ...validBody,
        id: '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b',
        isDefault: false,
        customerId: '누출',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 11: 실패를 확인한다**

Run: `pnpm vitest run --project contracts packages/contracts/src/customer/address.contract.spec.ts`
Expected: FAIL — 파일이 없다.

- [ ] **Step 12: `address.contract.ts`를 만든다**

Create `packages/contracts/src/customer/address.contract.ts`:

```ts
import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorDtoSchema } from '../shared/error-codes';

const c = initContract();

// 공백만 있는 값을 거부한다. .min(1)은 ' '를 통과시킨다.
const requiredText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: '공백만으로는 채울 수 없습니다' });

export const addressBodySchema = z
  .object({
    label: requiredText(30),
    recipient: requiredText(50),
    phone: requiredText(30),
    zip: requiredText(10),
    line1: requiredText(200),
    line2: z.string().max(200).optional(),
  })
  .strict();

export const addressDtoSchema = addressBodySchema
  .extend({
    id: z.string().uuid(),
    isDefault: z.boolean(),
  })
  .strict();

export const addressListSchema = z.object({ addresses: z.array(addressDtoSchema) }).strict();

export type AddressBody = z.infer<typeof addressBodySchema>;
export type AddressDto = z.infer<typeof addressDtoSchema>;
export type AddressListDto = z.infer<typeof addressListSchema>;

export const addressContract = c.router({
  list: {
    method: 'GET',
    path: '/addresses',
    responses: { 200: addressListSchema, 401: errorDtoSchema },
    summary: '내 주소록. 기본 배송지가 먼저 온다',
  },
  add: {
    method: 'POST',
    path: '/addresses',
    body: addressBodySchema,
    responses: { 201: addressDtoSchema, 400: errorDtoSchema, 401: errorDtoSchema },
    summary: '주소 추가. 첫 주소는 자동으로 기본 배송지가 된다',
  },
  update: {
    method: 'PUT',
    path: '/addresses/:addressId',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: addressBodySchema,
    responses: { 200: addressDtoSchema, 400: errorDtoSchema, 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '주소 수정',
  },
  remove: {
    method: 'DELETE',
    path: '/addresses/:addressId',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: c.noBody(),
    responses: { 204: c.noBody(), 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '주소 삭제',
  },
  setDefault: {
    method: 'POST',
    path: '/addresses/:addressId/default',
    pathParams: z.object({ addressId: z.string().uuid() }),
    body: c.noBody(),
    responses: { 204: c.noBody(), 401: errorDtoSchema, 404: errorDtoSchema },
    summary: '기본 배송지 지정. 이전 기본은 자동으로 해제된다',
  },
});
```

- [ ] **Step 13: 루트 계약과 재수출**

Create `packages/contracts/src/api.contract.ts`:

```ts
import { initContract } from '@ts-rest/core';
import { addressContract } from './customer/address.contract';
import { healthContract } from './health/health.contract';
import { authContract } from './identity/auth.contract';

const c = initContract();

/**
 * BFF가 쓰는 단일 진입점. 클라이언트를 계약마다 만들지 않기 위해 하나로 합친다.
 * Nest 쪽은 계약별로 컨트롤러를 나누므로 이 루트를 쓰지 않는다.
 */
export const apiContract = c.router({
  health: healthContract,
  auth: authContract,
  address: addressContract,
});
```

`packages/contracts/src/index.ts`를 교체한다.

```ts
export * from './api.contract';
export * from './customer/address.contract';
export * from './health/health.contract';
export * from './identity/auth.contract';
export * from './shared/error-codes';
export * from './shared/money.dto';
```

- [ ] **Step 14: `healthContract`에 `.strict()`를 소급 적용한다 (이월 23)**

`packages/contracts/src/health/health.contract.ts`의 200 응답 스키마 끝에 `.strict()`를 붙인다.

```ts
      200: z
        .object({
          status: z.literal('ok'),
          database: z.enum(['up', 'down']),
        })
        .strict(),
```

`packages/contracts/src/health/health.contract.spec.ts`에 고정 테스트를 추가한다.

```ts
  it('계약에 없는 필드를 거부한다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'up', uptime: 123 }),
    ).toThrow();
  });
```

- [ ] **Step 15: 전체 검증**

Run: `pnpm verify`
Expected: exit 0.

`health.controller.integration.spec.ts`가 계약 스키마로 실제 응답을 파싱하고 있으므로, 서버 응답에 여분 필드가 있으면 여기서 깨진다. 깨지지 않아야 정상이다.

- [ ] **Step 16: 커밋**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): 인증·주소록 계약과 에러 코드 3종을 추가하고 응답 스키마를 strict로 고정한다"
```

---

### Task 3: Identity 도메인 — `Email` / `PlainPassword` / `Credential`

**Files:**
- Create: `apps/api/src/modules/identity/domain/email.ts` + `email.spec.ts`
- Create: `apps/api/src/modules/identity/domain/plain-password.ts` + `plain-password.spec.ts`
- Create: `apps/api/src/modules/identity/domain/credential.ts` + `credential.spec.ts`

**Interfaces:**
- Consumes: `DomainError` (`apps/api/src/shared/kernel/domain-error.ts`)
- Produces:
  - `Email.of(raw: string): Email`, `email.value: string`, `email.equals(other): boolean`
  - `InvalidEmailError` (`CODE = 'INVALID_EMAIL'`)
  - `PlainPassword.of(raw: string): PlainPassword`, `password.reveal(): string`
  - `PasswordPolicyViolationError` (`CODE = 'PASSWORD_POLICY_VIOLATED'`)
  - `Credential.fromHash(hash: string): Credential`, `credential.hash: string`, `credential.equals(other): boolean`
  - `InvalidCredentialError` (일반 `Error` — 500)

**주의:** 이 디렉터리는 `vitest` 외의 어떤 npm 패키지도 import할 수 없다. `zod`도, `@nestjs/*`도, `@commerce/contracts`도 안 된다. 상대 경로로 `../../../shared/kernel/...`만 쓴다.

- [ ] **Step 1: `Email`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/domain/email.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Email, InvalidEmailError } from './email';

describe('Email', () => {
  it('정상 이메일을 만든다', () => {
    expect(Email.of('user@example.com').value).toBe('user@example.com');
  });

  it('대소문자를 소문자로 정규화한다', () => {
    // 정규화가 유일성의 근거다. 정규화하지 않으면 User@x.com과 user@x.com이
    // 서로 다른 계정이 되고, DB의 unique 인덱스도 둘을 막지 못한다.
    expect(Email.of('User@Example.COM').value).toBe('user@example.com');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(Email.of('  user@example.com  ').value).toBe('user@example.com');
  });

  it('정규화 결과가 같으면 equals가 참이다', () => {
    expect(Email.of('User@Example.com').equals(Email.of('user@example.com'))).toBe(true);
  });

  it.each([
    ['@ 없음', 'userexample.com'],
    ['로컬부 없음', '@example.com'],
    ['도메인 없음', 'user@'],
    ['점 없는 도메인', 'user@example'],
    ['공백 포함', 'us er@example.com'],
    ['@ 두 개', 'user@@example.com'],
    ['빈 문자열', ''],
    ['공백만', '   '],
  ])('%s이면 거부한다', (_label, raw) => {
    expect(() => Email.of(raw)).toThrow(InvalidEmailError);
  });

  it('254자를 넘으면 거부한다', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(() => Email.of(tooLong)).toThrow(InvalidEmailError);
  });

  it('실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => Email.of('nope')).toThrow(DomainError);
  });

  it('toString이 값을 그대로 준다', () => {
    expect(`${Email.of('user@example.com')}`).toBe('user@example.com');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/email.spec.ts`
Expected: FAIL — `email.ts`가 없다.

- [ ] **Step 3: `email.ts`를 구현한다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 이메일 형식이 아닐 때. 형식 검증은 원칙적으로 어댑터의 Zod가 하지만(스펙 §8.4),
 * 정규화(trim + 소문자)가 도메인의 책임이라 검증도 여기 한 벌 더 있다.
 * 정규화 없이는 `User@x.com`과 `user@x.com`이 서로 다른 계정이 되고, DB의 unique
 * 인덱스도 그 둘을 막지 못한다 — 즉 이건 형식이 아니라 **유일성 불변식**의 일부다.
 */
export class InvalidEmailError extends DomainError {
  static readonly CODE = 'INVALID_EMAIL';
  readonly code = InvalidEmailError.CODE;

  constructor(raw: string) {
    super(`이메일 형식이 아닙니다: "${raw}"`);
  }
}

// RFC 5322를 완전히 구현하지 않는다. 목적은 "명백히 이메일이 아닌 값"을 걸러 정규화의
// 전제를 지키는 것이고, 진짜 검증은 발송 가능 여부(확인 메일)로만 가능하다.
// 공백 없음 / @ 하나 / 도메인에 점 하나 이상 — 이 셋만 본다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 254; // RFC 5321의 경로 상한

export class Email {
  private constructor(readonly value: string) {}

  static of(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
      throw new InvalidEmailError(raw);
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/email.spec.ts`
Expected: PASS

- [ ] **Step 5: `PlainPassword`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/domain/plain-password.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { PasswordPolicyViolationError, PlainPassword } from './plain-password';

const SECRET = 'correct horse battery staple';

describe('PlainPassword', () => {
  it('정책을 만족하는 비밀번호를 만든다', () => {
    expect(PlainPassword.of(SECRET).reveal()).toBe(SECRET);
  });

  it('10자 미만을 거부한다', () => {
    expect(() => PlainPassword.of('123456789')).toThrow(PasswordPolicyViolationError);
  });

  it('정확히 10자는 통과한다', () => {
    expect(() => PlainPassword.of('1234567890')).not.toThrow();
  });

  it('128자를 넘으면 거부한다', () => {
    // 상한이 없으면 임의 길이 입력이 Argon2에 그대로 들어가 해싱 비용이 입력에 비례한다.
    expect(() => PlainPassword.of('x'.repeat(129))).toThrow(PasswordPolicyViolationError);
  });

  it('정확히 128자는 통과한다', () => {
    expect(() => PlainPassword.of('x'.repeat(128))).not.toThrow();
  });

  it('공백을 제거하지 않는다 — 공백도 비밀번호의 일부다', () => {
    const withSpaces = '  spaced out password  ';
    expect(PlainPassword.of(withSpaces).reveal()).toBe(withSpaces);
  });

  it('정책 위반은 DomainError다', () => {
    expect(() => PlainPassword.of('short')).toThrow(DomainError);
  });

  it('문자열로 변환해도 비밀번호가 드러나지 않는다', () => {
    // 실수로 로그에 찍히는 경로를 하나라도 줄인다.
    expect(`${PlainPassword.of(SECRET)}`).not.toContain('horse');
    expect(`${PlainPassword.of(SECRET)}`).toBe('[PlainPassword]');
  });

  it('JSON으로 직렬화해도 비밀번호가 드러나지 않는다', () => {
    const serialized = JSON.stringify({ password: PlainPassword.of(SECRET) });
    expect(serialized).not.toContain('horse');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/plain-password.spec.ts`
Expected: FAIL — 파일이 없다.

- [ ] **Step 7: `plain-password.ts`를 구현한다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 비밀번호 길이 정책 위반. **정책은 도메인의 것이지 Zod의 것이 아니다**(스펙 §8.4).
 * 계약의 Zod 스키마에 `.min(10)`을 붙이는 순간 같은 규칙이 두 곳에 생기고, 정책을
 * 바꿀 때 한쪽만 고쳐도 아무도 알려주지 않는다.
 */
export class PasswordPolicyViolationError extends DomainError {
  static readonly CODE = 'PASSWORD_POLICY_VIOLATED';
  readonly code = PasswordPolicyViolationError.CODE;

  constructor(reason: string) {
    super(`비밀번호 정책 위반: ${reason}`);
  }
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/**
 * 평문 비밀번호 값 객체. 절대 저장되지 않고 해셔 어댑터까지만 간다.
 *
 * `#raw`를 private 클래스 필드로 두고 `toString`/`toJSON`을 덮어쓴 것은 실수로 로그나
 * 응답에 실리는 경로를 줄이기 위한 것이다. 완전한 방어는 아니다 — `util.inspect`나
 * 디버거는 여전히 값을 볼 수 있다. 이 객체를 통째로 로깅하지 않는 규율이 여전히 필요하다.
 */
export class PlainPassword {
  readonly #raw: string;

  private constructor(raw: string) {
    this.#raw = raw;
  }

  static of(raw: string): PlainPassword {
    if (raw.length < MIN_LENGTH) {
      throw new PasswordPolicyViolationError(`${MIN_LENGTH}자 이상이어야 합니다`);
    }
    if (raw.length > MAX_LENGTH) {
      throw new PasswordPolicyViolationError(`${MAX_LENGTH}자 이하여야 합니다`);
    }
    return new PlainPassword(raw);
  }

  /** 해셔 어댑터만 호출한다. 다른 곳에서 부르면 평문이 그 코드에 남는다. */
  reveal(): string {
    return this.#raw;
  }

  toString(): string {
    return '[PlainPassword]';
  }

  toJSON(): string {
    return '[PlainPassword]';
  }
}
```

- [ ] **Step 8: `Credential`의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/domain/credential.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Credential, InvalidCredentialError } from './credential';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$hashvalue';

describe('Credential', () => {
  it('해시 문자열로 만든다', () => {
    expect(Credential.fromHash(HASH).hash).toBe(HASH);
  });

  it('빈 해시를 거부한다', () => {
    expect(() => Credential.fromHash('')).toThrow(InvalidCredentialError);
  });

  it('공백뿐인 해시를 거부한다', () => {
    expect(() => Credential.fromHash('   ')).toThrow(InvalidCredentialError);
  });

  it('실패는 DomainError가 아니다 — 사용자 입력이 아니라 해셔/매퍼의 버그다', () => {
    // 빈 해시가 여기 도달했다면 해셔가 빈 문자열을 돌려줬거나 매퍼가 NULL 컬럼을
    // 읽은 것이다. 둘 다 사용자가 고칠 수 없으므로 500이 정직하다.
    expect(() => Credential.fromHash('')).not.toThrow(DomainError);
  });

  it('같은 해시면 equals가 참이다', () => {
    expect(Credential.fromHash(HASH).equals(Credential.fromHash(HASH))).toBe(true);
  });

  it('다른 해시면 equals가 거짓이다', () => {
    expect(Credential.fromHash(HASH).equals(Credential.fromHash(`${HASH}x`))).toBe(false);
  });
});
```

- [ ] **Step 9: `credential.ts`를 구현한다**

```ts
/**
 * 해시가 비어 있을 때. `DomainError`가 아니다 — 여기 도달했다면 해셔가 빈 문자열을
 * 돌려줬거나 매퍼가 NULL 컬럼을 읽은 것이고, 둘 다 코드 버그다.
 */
export class InvalidCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCredentialError';
  }
}

/**
 * 저장된 비밀번호 해시 (스펙 §5.1의 `Credential` VO).
 *
 * 평문을 담는 `PlainPassword`와 타입이 갈라져 있어, 평문을 해시 자리에 넣는 실수가
 * 컴파일 단계에서 걸린다. 검증(평문 ↔ 해시 대조)은 이 VO가 하지 않는다 — 알고리즘을
 * 아는 것은 어댑터(`PasswordHasher`)이고, 도메인은 argon2를 몰라야 한다.
 */
export class Credential {
  private constructor(readonly hash: string) {}

  static fromHash(hash: string): Credential {
    if (hash.trim().length === 0) {
      throw new InvalidCredentialError('비어 있는 해시로 Credential을 만들 수 없습니다.');
    }
    return new Credential(hash);
  }

  equals(other: Credential): boolean {
    return this.hash === other.hash;
  }
}
```

- [ ] **Step 10: 세 파일이 모두 통과하는지 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/`
Expected: PASS

- [ ] **Step 11: 커버리지 임계값이 실제로 발동하는지 증명한다**

이 태스크가 `apps/api/src/modules/identity/domain/**`를 처음 만든다. 계획 1에서 `vitest.config.ts`에 걸어둔 임계값(lines 95 / branches 90)은 **글롭이 아무 파일도 매치하지 않아 지금까지 아무것도 검증하지 않았다** — Vitest는 매치 없는 글롭 임계값을 조용히 통과시킨다.

먼저 정상 상태를 확인한다.
Run: `pnpm test:coverage`
Expected: exit 0.

그 다음 `email.ts`에 테스트되지 않은 분기를 넣는다.

```ts
  static ofOrNull(raw: string): Email | null {
    if (raw.length === 0) {
      return null;
    }
    return Email.of(raw);
  }
```

Run: `pnpm test:coverage`
Expected: FAIL — `ERROR: Coverage for branches (...) does not meet threshold` 또는 lines 임계값 미달 메시지가 `apps/api/src/modules/identity/domain/**`에 대해 출력된다.

**이 실패 메시지를 눈으로 확인할 것.** 확인하지 못하면(예: 임계값이 여전히 조용히 통과) 그것 자체가 결함이고, 보고서에 적어야 한다.

추가한 메서드를 지우고 다시 exit 0인지 확인한다.

- [ ] **Step 12: 전체 검증**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 새 디렉터리를 크루징하면서 도메인 순수성 규칙을 적용한다.

- [ ] **Step 13: 도메인 순수성 규칙이 새 디렉터리에 실제로 적용되는지 증명한다**

`email.ts` 맨 위에 `import { Injectable } from '@nestjs/common';`을 추가한다(사용하지 않아도 된다).
Run: `pnpm arch:check`
Expected: FAIL — `domain-is-pure`와 `kernel-and-domain-use-no-npm-packages` 두 규칙이 `apps/api/src/modules/identity/domain/email.ts → node_modules/@nestjs/common/...` 엣지를 지목한다. **위반 줄에 이 파일 경로가 실제로 찍히는지** 확인한다 — 규칙이 발화했다는 사실만으로는 이 파일을 검사했다는 증명이 되지 않는다.

Run: `pnpm lint`
Expected: FAIL — Biome `noRestrictedImports`도 같은 줄을 잡는다.

import를 지우고 둘 다 통과하는지 확인한다.

- [ ] **Step 14: 커밋**

```bash
git add apps/api/src/modules/identity/domain
git commit -m "feat(identity): Email·PlainPassword·Credential 값 객체를 추가한다"
```

---

### Task 4: Identity 도메인 — `Account` 애그리거트

**Files:**
- Create: `apps/api/src/modules/identity/domain/account.errors.ts`
- Create: `apps/api/src/modules/identity/domain/account.events.ts`
- Create: `apps/api/src/modules/identity/domain/account.ts` + `account.spec.ts`

**Interfaces:**
- Consumes: `AggregateRoot` (`shared/kernel/aggregate-root.ts`, `protected raise(event)`, `pullEvents(): DomainEvent[]`, `get hasUncommittedEvents`), `DomainEvent` (`shared/kernel/domain-event.ts`, `{ eventType, aggregateType, aggregateId, occurredAt, payload }`), `AccountId` (`shared/kernel/identifiers.ts`), `Email`/`Credential` (태스크 3)
- Produces:
  - `Account.register({ id, email, credential, now }): Account` — `AccountRegistered` 이벤트를 raise
  - `Account.rehydrate({ id, email, credential, createdAt, updatedAt }): Account` — 이벤트 없음
  - `account.id`, `account.email`, `account.credential`, `account.createdAt`, `account.updatedAt`
  - `account.changeCredential(next: Credential, now: Date): void`
  - `EmailAlreadyRegisteredError` (`CODE = 'EMAIL_ALREADY_REGISTERED'`)
  - `InvalidCredentialsError` (`CODE = 'INVALID_CREDENTIALS'`)
  - `ACCOUNT_REGISTERED = 'identity.AccountRegistered'`

- [ ] **Step 1: 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/domain/account.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../shared/kernel/identifiers';
import { Account } from './account';
import { ACCOUNT_REGISTERED } from './account.events';
import { Credential } from './credential';
import { Email } from './email';

const ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b');
const EMAIL = Email.of('user@example.com');
const CREDENTIAL = Credential.fromHash('$argon2id$hash-one');
const NOW = new Date('2026-03-01T10:00:00.000Z');

describe('Account.register', () => {
  it('전달된 값으로 계정을 만든다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.id).toBe(ID);
    expect(account.email.equals(EMAIL)).toBe(true);
    expect(account.credential.equals(CREDENTIAL)).toBe(true);
  });

  it('생성 시각을 주입된 시각으로 쓴다 — new Date()를 부르지 않는다', () => {
    // Clock 포트를 우회해 `new Date()`를 쓰면 이 단언이 깨진다. 시간 의존 테스트가
    // 전부 불안정해지는 종류의 회귀라 여기서 못박는다.
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.createdAt).toEqual(NOW);
    expect(account.updatedAt).toEqual(NOW);
  });

  it('AccountRegistered 이벤트를 쌓는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    expect(account.hasUncommittedEvents).toBe(true);

    const [event, ...rest] = account.pullEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      eventType: ACCOUNT_REGISTERED,
      aggregateType: 'Account',
      aggregateId: ID,
      occurredAt: NOW,
    });
  });

  it('이벤트 payload는 JSON 직렬화 가능한 값만 담는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    const [event] = account.pullEvents();
    // outbox의 payload 컬럼이 JsonB다. VO를 그대로 넣으면 직렬화가 조용히 {}가 된다.
    expect(event?.payload).toEqual({ accountId: ID, email: 'user@example.com' });
    expect(JSON.parse(JSON.stringify(event?.payload))).toEqual(event?.payload);
  });

  it('이벤트 payload에 비밀번호 해시를 담지 않는다', () => {
    const account = Account.register({ id: ID, email: EMAIL, credential: CREDENTIAL, now: NOW });
    const [event] = account.pullEvents();
    // outbox 행은 사실상 영구 보존되는 로그다. 해시를 담으면 오프라인 크래킹 대상이
    // 하나 더 늘어난다.
    expect(JSON.stringify(event?.payload)).not.toContain('argon2');
  });
});

describe('Account.rehydrate', () => {
  it('저장된 상태를 복원한다', () => {
    const later = new Date('2026-04-01T00:00:00.000Z');
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: later,
    });
    expect(account.createdAt).toEqual(NOW);
    expect(account.updatedAt).toEqual(later);
  });

  it('이벤트를 쌓지 않는다', () => {
    // 복원이 이벤트를 쌓으면 리포지토리가 계정을 읽을 때마다 AccountRegistered가
    // outbox에 다시 들어간다 — 가입 메일이 조회할 때마다 나간다.
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(account.hasUncommittedEvents).toBe(false);
    expect(account.pullEvents()).toEqual([]);
  });
});

describe('Account.changeCredential', () => {
  it('자격증명과 갱신 시각을 바꾼다', () => {
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const next = Credential.fromHash('$argon2id$hash-two');
    const changedAt = new Date('2026-05-01T00:00:00.000Z');

    account.changeCredential(next, changedAt);

    expect(account.credential.equals(next)).toBe(true);
    expect(account.updatedAt).toEqual(changedAt);
    expect(account.createdAt).toEqual(NOW);
  });

  it('이벤트를 쌓지 않는다', () => {
    // 비밀번호 변경 이벤트를 구독하는 곳이 없다. 발행하면 outbox에 아무도 읽지 않는
    // 행이 쌓이고, payload에 무엇을 담을지 고민만 는다 (YAGNI).
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    account.changeCredential(Credential.fromHash('$argon2id$hash-two'), NOW);
    expect(account.hasUncommittedEvents).toBe(false);
  });

  it('이메일은 바꾸지 않는다', () => {
    const account = Account.rehydrate({
      id: ID,
      email: EMAIL,
      credential: CREDENTIAL,
      createdAt: NOW,
      updatedAt: NOW,
    });
    account.changeCredential(Credential.fromHash('$argon2id$hash-two'), NOW);
    expect(account.email.equals(EMAIL)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/account.spec.ts`
Expected: FAIL — `account.ts` / `account.events.ts`가 없다.

- [ ] **Step 3: `account.events.ts`를 만든다**

```ts
import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { AccountId } from '../../../shared/kernel/identifiers';
import type { Email } from './email';

export const ACCOUNT_REGISTERED = 'identity.AccountRegistered';

/**
 * 계정이 생성됐다. payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 —
 * outbox의 payload 컬럼이 JsonB이고, VO를 그대로 넣으면 직렬화가 `{}`가 되어
 * 조용히 빈 이벤트가 발행된다.
 *
 * 비밀번호 해시는 절대 담지 않는다. outbox 행은 사실상 영구 보존되는 로그다.
 */
export function accountRegistered(
  accountId: AccountId,
  email: Email,
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: ACCOUNT_REGISTERED,
    aggregateType: 'Account',
    aggregateId: accountId,
    occurredAt,
    payload: { accountId, email: email.value },
  };
}
```

- [ ] **Step 4: `account.errors.ts`를 만든다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 이미 가입된 이메일. 유스케이스의 사전 조회와 **DB의 unique 인덱스** 두 곳에서 던진다.
 * 사전 조회만으로는 막을 수 없다 — 두 요청이 동시에 조회를 통과한 뒤 둘 다 INSERT를
 * 시도하는 창이 존재한다. 어댑터가 unique 위반(P2002)을 이 예외로 번역해야 한다.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  static readonly CODE = 'EMAIL_ALREADY_REGISTERED';
  readonly code = EmailAlreadyRegisteredError.CODE;

  constructor(email: string) {
    super(`이미 가입된 이메일입니다: ${email}`);
  }
}

/**
 * 이메일이 없거나 비밀번호가 틀렸다. **두 경우를 구분하지 않는다** — 구분하면
 * "이 이메일은 가입돼 있다"는 사실이 새어 계정 열거 공격의 재료가 된다.
 * 메시지도 하나만 쓴다.
 */
export class InvalidCredentialsError extends DomainError {
  static readonly CODE = 'INVALID_CREDENTIALS';
  readonly code = InvalidCredentialsError.CODE;

  constructor() {
    super('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
}
```

- [ ] **Step 5: `account.ts`를 구현한다**

```ts
import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { AccountId } from '../../../shared/kernel/identifiers';
import { accountRegistered } from './account.events';
import type { Credential } from './credential';
import type { Email } from './email';

/**
 * 계정 애그리거트 루트.
 *
 * 이메일은 불변이다 — 이메일 변경 유스케이스가 범위 밖이라 setter를 만들지 않는다.
 * 만들어 두면 확인 메일 흐름 없이 이메일을 바꿀 수 있는 구멍이 된다.
 *
 * "현재 비밀번호가 맞는가"는 여기서 검사하지 않는다. 대조에는 해셔(포트)가 필요하고
 * 도메인은 포트를 부르지 않는다. 유스케이스가 대조한 뒤 `changeCredential`을 부른다.
 * 스펙 §5.5의 "본인 주문만 취소"와 갈리는 지점이다 — 그건 I/O 없이 판단할 수 있어
 * 도메인 규칙이고, 이건 I/O가 필요해 애플리케이션 규칙이다.
 */
export class Account extends AggregateRoot {
  private constructor(
    readonly id: AccountId,
    readonly email: Email,
    private credentialValue: Credential,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {
    super();
  }

  static register(params: {
    id: AccountId;
    email: Email;
    credential: Credential;
    now: Date;
  }): Account {
    const account = new Account(
      params.id,
      params.email,
      params.credential,
      params.now,
      params.now,
    );
    account.raise(accountRegistered(params.id, params.email, params.now));
    return account;
  }

  /** 저장된 행에서 복원한다. 이벤트를 쌓지 않는다. */
  static rehydrate(params: {
    id: AccountId;
    email: Email;
    credential: Credential;
    createdAt: Date;
    updatedAt: Date;
  }): Account {
    return new Account(
      params.id,
      params.email,
      params.credential,
      params.createdAt,
      params.updatedAt,
    );
  }

  get credential(): Credential {
    return this.credentialValue;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  changeCredential(next: Credential, now: Date): void {
    this.credentialValue = next;
    this.updatedAtValue = now;
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/account.spec.ts`
Expected: PASS

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

두 가지를 각각 증명한다.

**(a) Clock 포트 우회를 잡는가**
`Account.register`에서 `params.now`를 `new Date()`로 바꾼다.
Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/account.spec.ts`
Expected: FAIL — `'생성 시각을 주입된 시각으로 쓴다'`가 실패한다.
되돌린다.

**(b) 복원 시 이벤트 재발행을 잡는가**
`Account.rehydrate`에 `account.raise(...)`를 넣도록 고친다(먼저 `const account = new Account(...)`로 분리).
Expected: FAIL — `'이벤트를 쌓지 않는다'`가 실패한다. 이 회귀가 실제로 나면 계정을 **조회할 때마다** 가입 메일이 나간다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/identity/domain
git commit -m "feat(identity): Account 애그리거트와 AccountRegistered 이벤트를 추가한다"
```

---

### Task 5: Identity 도메인 — `Session` 애그리거트

**Files:**
- Create: `apps/api/src/modules/identity/domain/session.errors.ts`
- Create: `apps/api/src/modules/identity/domain/session.ts` + `session.spec.ts`

**Interfaces:**
- Consumes: `AggregateRoot`, `AccountId`/`SessionId` (`shared/kernel/identifiers.ts`), `Duration` (`shared/kernel/duration.ts`, `Duration.days`는 없다 — `Duration.hours(24 * n)`을 쓴다)
- Produces:
  - `Session.issue({ id, accountId, refreshTokenHash, now, ttl }): Session`
  - `Session.rehydrate({ id, accountId, refreshTokenHash, issuedAt, expiresAt, rotatedAt, revokedAt }): Session`
  - `session.rotate({ refreshTokenHash, now, ttl }): void`
  - `session.revoke(now: Date): void` (멱등)
  - `session.isActive(now: Date): boolean`
  - getters: `id`, `accountId`, `refreshTokenHash`, `issuedAt`, `expiresAt`, `rotatedAt`, `revokedAt`
  - `SessionExpiredError` (`CODE = 'SESSION_EXPIRED'`), `SessionRevokedError` (`CODE = 'SESSION_REVOKED'`)

**설계 결정 (회전은 제자리에서 한다):** 스펙 §10.8의 `sessions` 컬럼이 `id, account_id, refresh_token_hash, expires_at, rotated_at`이다. 회전할 때마다 새 행을 만드는 대신 **같은 행의 해시를 갈아 끼우고 `rotated_at`을 찍는다.** 옛 리프레시 토큰은 어느 행과도 매치되지 않으므로 자동으로 거부된다. 토큰 계보를 추적해 재사용을 탐지하는 것(reuse detection)은 이 스키마로 할 수 없고, 스펙이 요구하지도 않는다.

**설계 결정 (회전은 만료를 연장한다):** 회전 시 `expires_at`을 `now + ttl`로 다시 잡는다(sliding window). 활동 중인 사용자가 14일마다 강제 로그아웃되지 않는다. 대가는 절대 상한이 없다는 것 — 계속 활동하는 세션은 무기한 산다. 절대 상한이 필요해지면 `issued_at`을 이미 갖고 있으므로 컬럼 추가 없이 넣을 수 있다.

- [ ] **Step 1: 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/domain/session.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import { Session } from './session';
import { SessionExpiredError, SessionRevokedError } from './session.errors';

const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5c');
const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.hours(24 * 14); // 14일

function issue(): Session {
  return Session.issue({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    refreshTokenHash: 'hash-1',
    now: NOW,
    ttl: TTL,
  });
}

describe('Session.issue', () => {
  it('발급 시각과 TTL로 만료 시각을 계산한다', () => {
    const session = issue();
    expect(session.issuedAt).toEqual(NOW);
    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + TTL.millis));
  });

  it('새 세션은 회전도 폐기도 되지 않은 상태다', () => {
    const session = issue();
    expect(session.rotatedAt).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it('만료 직전에는 활성이고 만료 시각에는 비활성이다', () => {
    const session = issue();
    const justBefore = new Date(session.expiresAt.getTime() - 1);
    expect(session.isActive(justBefore)).toBe(true);
    // 경계는 닫힌 구간이 아니다 — expiresAt 자체는 이미 만료다.
    expect(session.isActive(session.expiresAt)).toBe(false);
  });
});

describe('Session.rotate', () => {
  it('해시를 갈아 끼운다', () => {
    const session = issue();
    session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL });
    expect(session.refreshTokenHash).toBe('hash-2');
  });

  it('만료 시각을 회전 시각 기준으로 다시 잡는다 (sliding window)', () => {
    const session = issue();
    const later = new Date(NOW.getTime() + Duration.hours(24 * 7).millis);
    session.rotate({ refreshTokenHash: 'hash-2', now: later, ttl: TTL });
    expect(session.expiresAt).toEqual(new Date(later.getTime() + TTL.millis));
  });

  it('회전 시각을 기록한다', () => {
    const session = issue();
    const later = new Date(NOW.getTime() + 1000);
    session.rotate({ refreshTokenHash: 'hash-2', now: later, ttl: TTL });
    expect(session.rotatedAt).toEqual(later);
  });

  it('발급 시각은 회전해도 바뀌지 않는다', () => {
    const session = issue();
    session.rotate({ refreshTokenHash: 'hash-2', now: new Date(NOW.getTime() + 1000), ttl: TTL });
    expect(session.issuedAt).toEqual(NOW);
  });

  it('만료된 세션은 회전할 수 없다', () => {
    const session = issue();
    const afterExpiry = new Date(session.expiresAt.getTime() + 1);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: afterExpiry, ttl: TTL })).toThrow(
      SessionExpiredError,
    );
  });

  it('만료 시각 정각에도 회전할 수 없다', () => {
    const session = issue();
    expect(() =>
      session.rotate({ refreshTokenHash: 'hash-2', now: session.expiresAt, ttl: TTL }),
    ).toThrow(SessionExpiredError);
  });

  it('폐기된 세션은 회전할 수 없다', () => {
    // 로그아웃 후 옛 리프레시 토큰으로 되살리는 경로를 막는다. 이 검사가 없으면
    // "로그아웃했다"는 사용자의 기대가 거짓이 된다.
    const session = issue();
    session.revoke(NOW);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL })).toThrow(
      SessionRevokedError,
    );
  });

  it('폐기가 만료보다 우선 보고된다', () => {
    // 둘 다 해당할 때 어느 쪽이 나오는지 고정해 둔다. 폐기가 더 구체적인 정보다.
    const session = issue();
    session.revoke(NOW);
    const afterExpiry = new Date(session.expiresAt.getTime() + 1);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: afterExpiry, ttl: TTL })).toThrow(
      SessionRevokedError,
    );
  });

  it('회전 실패는 세션 상태를 바꾸지 않는다', () => {
    const session = issue();
    session.revoke(NOW);
    expect(() => session.rotate({ refreshTokenHash: 'hash-2', now: NOW, ttl: TTL })).toThrow();
    expect(session.refreshTokenHash).toBe('hash-1');
  });
});

describe('Session.revoke', () => {
  it('폐기 시각을 기록하고 비활성이 된다', () => {
    const session = issue();
    session.revoke(NOW);
    expect(session.revokedAt).toEqual(NOW);
    expect(session.isActive(NOW)).toBe(false);
  });

  it('두 번 폐기해도 첫 시각을 유지한다 (멱등)', () => {
    // 로그아웃은 재시도될 수 있다. 두 번째 호출이 시각을 덮어쓰면 "언제 로그아웃했나"가
    // 사라진다.
    const session = issue();
    session.revoke(NOW);
    session.revoke(new Date(NOW.getTime() + 60_000));
    expect(session.revokedAt).toEqual(NOW);
  });
});

describe('Session.rehydrate', () => {
  it('저장된 상태를 그대로 복원한다', () => {
    const expiresAt = new Date(NOW.getTime() + TTL.millis);
    const rotatedAt = new Date(NOW.getTime() + 1000);
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt,
      rotatedAt,
      revokedAt: null,
    });
    expect(session.refreshTokenHash).toBe('hash-9');
    expect(session.rotatedAt).toEqual(rotatedAt);
    expect(session.revokedAt).toBeNull();
  });

  it('폐기된 세션을 복원하면 여전히 폐기 상태다', () => {
    // 매퍼가 revoked_at 컬럼을 흘리면 로그아웃한 세션이 되살아난다.
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL.millis),
      rotatedAt: null,
      revokedAt: NOW,
    });
    expect(session.isActive(NOW)).toBe(false);
    expect(() => session.rotate({ refreshTokenHash: 'x', now: NOW, ttl: TTL })).toThrow(
      SessionRevokedError,
    );
  });

  it('이벤트를 쌓지 않는다', () => {
    const session = Session.rehydrate({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'hash-9',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL.millis),
      rotatedAt: null,
      revokedAt: null,
    });
    expect(session.hasUncommittedEvents).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/session.spec.ts`
Expected: FAIL — 파일이 없다.

- [ ] **Step 3: `session.errors.ts`를 만든다**

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 만료된 세션을 쓰려 했다. 두 예외를 갈라놓은 이유는 서버 로그에서 "만료로 끊긴 것"과
 * "로그아웃 후 되살리려 한 것"을 구분하기 위해서다 — 후자는 토큰 유출 정황일 수 있다.
 * HTTP 응답은 둘 다 401 `UNAUTHENTICATED`로 같다. 클라이언트가 할 일이 재로그인으로
 * 똑같기 때문이다.
 */
export class SessionExpiredError extends DomainError {
  static readonly CODE = 'SESSION_EXPIRED';
  readonly code = SessionExpiredError.CODE;

  constructor(sessionId: string) {
    super(`세션이 만료되었습니다: ${sessionId}`);
  }
}

/** 폐기(로그아웃)된 세션을 쓰려 했다. */
export class SessionRevokedError extends DomainError {
  static readonly CODE = 'SESSION_REVOKED';
  readonly code = SessionRevokedError.CODE;

  constructor(sessionId: string) {
    super(`폐기된 세션입니다: ${sessionId}`);
  }
}
```

- [ ] **Step 4: `session.ts`를 구현한다**

```ts
import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { Duration } from '../../../shared/kernel/duration';
import type { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import { SessionExpiredError, SessionRevokedError } from './session.errors';

/**
 * 세션 애그리거트 루트.
 *
 * 리프레시 토큰의 **해시만** 들고 있다. 원본은 클라이언트에만 존재한다 — DB가 유출돼도
 * 그것만으로는 세션을 되살릴 수 없다. 해싱은 어댑터(`TokenIssuer.hashRefreshToken`)의
 * 몫이고 도메인은 알고리즘을 모른다.
 *
 * 회전은 제자리에서 한다: 같은 행의 해시를 갈아 끼우고 `rotatedAt`을 찍는다. 옛 토큰은
 * 어느 행과도 매치되지 않아 자동으로 거부된다.
 *
 * 이벤트를 발행하지 않는다. 세션 생명주기를 구독하는 곳이 없다 (YAGNI).
 */
export class Session extends AggregateRoot {
  private constructor(
    readonly id: SessionId,
    readonly accountId: AccountId,
    private refreshTokenHashValue: string,
    readonly issuedAt: Date,
    private expiresAtValue: Date,
    private rotatedAtValue: Date | null,
    private revokedAtValue: Date | null,
  ) {
    super();
  }

  static issue(params: {
    id: SessionId;
    accountId: AccountId;
    refreshTokenHash: string;
    now: Date;
    ttl: Duration;
  }): Session {
    return new Session(
      params.id,
      params.accountId,
      params.refreshTokenHash,
      params.now,
      new Date(params.now.getTime() + params.ttl.millis),
      null,
      null,
    );
  }

  static rehydrate(params: {
    id: SessionId;
    accountId: AccountId;
    refreshTokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
    rotatedAt: Date | null;
    revokedAt: Date | null;
  }): Session {
    return new Session(
      params.id,
      params.accountId,
      params.refreshTokenHash,
      params.issuedAt,
      params.expiresAt,
      params.rotatedAt,
      params.revokedAt,
    );
  }

  get refreshTokenHash(): string {
    return this.refreshTokenHashValue;
  }

  get expiresAt(): Date {
    return this.expiresAtValue;
  }

  get rotatedAt(): Date | null {
    return this.rotatedAtValue;
  }

  get revokedAt(): Date | null {
    return this.revokedAtValue;
  }

  /**
   * 상태 변경 전에 전부 검사한다 — 중간에 던지면 해시만 바뀌고 만료는 그대로인
   * 반쯤 회전된 세션이 남는다.
   */
  rotate(params: { refreshTokenHash: string; now: Date; ttl: Duration }): void {
    this.assertUsable(params.now);
    this.refreshTokenHashValue = params.refreshTokenHash;
    this.expiresAtValue = new Date(params.now.getTime() + params.ttl.millis);
    this.rotatedAtValue = params.now;
  }

  /** 멱등하다. 이미 폐기됐으면 첫 폐기 시각을 유지한다. */
  revoke(now: Date): void {
    if (this.revokedAtValue !== null) {
      return;
    }
    this.revokedAtValue = now;
  }

  isActive(now: Date): boolean {
    return this.revokedAtValue === null && now.getTime() < this.expiresAtValue.getTime();
  }

  private assertUsable(now: Date): void {
    // 폐기를 먼저 본다. 둘 다 해당하면 폐기가 더 구체적인 정보다.
    if (this.revokedAtValue !== null) {
      throw new SessionRevokedError(this.id);
    }
    if (now.getTime() >= this.expiresAtValue.getTime()) {
      throw new SessionExpiredError(this.id);
    }
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/domain/session.spec.ts`
Expected: PASS

- [ ] **Step 6: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 폐기 검사가 실제로 회전을 막는가**
`assertUsable`에서 `if (this.revokedAtValue !== null) { throw ... }` 블록을 지운다.
Expected: FAIL — `'폐기된 세션은 회전할 수 없다'`, `'폐기가 만료보다 우선 보고된다'`, `'회전 실패는 세션 상태를 바꾸지 않는다'`, `'폐기된 세션을 복원하면 여전히 폐기 상태다'` 네 개가 실패한다.
되돌린다.

**(b) sliding window가 실제로 동작하는가**
`rotate`에서 `this.expiresAtValue = ...` 줄을 지운다.
Expected: FAIL — `'만료 시각을 회전 시각 기준으로 다시 잡는다'`만 실패한다. **다른 테스트가 전부 통과하는지 확인할 것** — 이 한 줄이 지워져도 나머지가 다 녹색이면 그 테스트들은 만료 연장을 검증하지 않는다는 뜻이고, 그걸 아는 것이 이 스텝의 목적이다.
되돌린다.

**(c) 만료 경계가 열린 구간인가**
`isActive`의 `<`를 `<=`로, `assertUsable`의 `>=`를 `>`로 바꾼다.
Expected: FAIL — `'만료 직전에는 활성이고 만료 시각에는 비활성이다'`와 `'만료 시각 정각에도 회전할 수 없다'`가 실패한다.
되돌린다.

- [ ] **Step 7: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/identity/domain
git commit -m "feat(identity): Session 애그리거트에 만료·회전·폐기 불변식을 넣는다"
```

---

### Task 6: Identity 애플리케이션 — 아웃바운드 포트와 테스트 fake

**Files:**
- Create: `apps/api/src/modules/identity/application/ports/out/account.repository.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/session.repository.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/password-hasher.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/token-issuer.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/email-sender.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/customer-directory.ts`
- Create: `apps/api/src/modules/identity/application/ports/out/identity-provider.ts` + `identity-provider.spec.ts`
- Create: `apps/api/src/modules/identity/testing/identity.fixtures.ts`
- Create: `apps/api/src/modules/identity/testing/in-memory-account.repository.ts`
- Create: `apps/api/src/modules/identity/testing/in-memory-session.repository.ts`
- Create: `apps/api/src/modules/identity/testing/fake-password-hasher.ts`
- Create: `apps/api/src/modules/identity/testing/fake-token-issuer.ts`
- Create: `apps/api/src/modules/identity/testing/recording-email-sender.ts`
- Create: `apps/api/src/modules/identity/testing/stub-customer-directory.ts`
- Create: `apps/api/src/modules/identity/testing/account-repository.contract.ts`
- Create: `apps/api/src/modules/identity/testing/session-repository.contract.ts`
- Create: `apps/api/src/modules/identity/testing/in-memory-account.repository.spec.ts`
- Create: `apps/api/src/modules/identity/testing/in-memory-session.repository.spec.ts`
- Modify: `apps/api/src/shared/testing/recording-event-publisher.ts` + `recording-event-publisher.spec.ts`

**Interfaces:**
- Consumes: `Account`/`Session`/`Email`/`Credential`/`PlainPassword` (태스크 3~5), `TransactionContext` (`shared/kernel/ports/transaction-manager.ts`), `Principal` (`shared/kernel/ports/access-token-verifier.ts`), `AccountId`/`CustomerId`/`SessionId`
- Produces (태스크 7·8·10·11·15가 전부 이 시그니처에 의존한다):
  - `AccountRepository { findById(id, tx?); findByEmail(email, tx?); save(account, tx?) }`, `ACCOUNT_REPOSITORY`
  - `SessionRepository { findByRefreshTokenHash(hash, tx?); save(session, tx?); revokeAllForAccount(accountId, now, tx?): Promise<number> }`, `SESSION_REPOSITORY`
  - `PasswordHasher { hash(password): Promise<Credential>; verify(credential, password): Promise<boolean> }`, `PASSWORD_HASHER`
  - `TokenIssuer { issueAccessToken(principal): Promise<IssuedAccessToken>; generateRefreshToken(): string; hashRefreshToken(token): string }`, `TOKEN_ISSUER`
  - `IssuedAccessToken { token: string; expiresInSeconds: number }`
  - `EmailSender { send(message: EmailMessage): Promise<void> }`, `EMAIL_SENDER`, `EmailMessage { to; subject; body }`
  - `CustomerDirectory { provision(accountId, tx): Promise<CustomerId>; findByAccount(accountId): Promise<CustomerId | null> }`, `CUSTOMER_DIRECTORY`
  - `IdentityProvider { exchangeAuthorizationCode(code): Promise<ExternalIdentity> }`, `IDENTITY_PROVIDER`
  - fake 6종 + 계약 스위트 2종

**주의:** `application/**`은 `adapters/**`, `@prisma/client`, `shared/infrastructure/**`를 import할 수 없다. `shared/kernel/**`과 자기 모듈의 `domain/**`만 본다.

- [ ] **Step 1: 리포지토리 포트 두 개를 만든다**

`account.repository.ts`:

```ts
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { Account } from '../../../domain/account';
import type { Email } from '../../../domain/email';

/**
 * 쓰기 전용 포트 — 애그리거트를 반환한다 (스펙 §7.2).
 *
 * `tx`가 optional인 것은 의도적이다. 트랜잭션 밖에서 단순 조회를 하는 경로(가드,
 * 조회 유스케이스)가 있고, 그때마다 트랜잭션을 여는 것은 비용이다. 쓰기는 항상
 * 유스케이스가 연 트랜잭션 안에서 일어난다.
 *
 * `save`는 삽입과 갱신을 모두 처리한다(upsert). 애그리거트를 다루는 코드가
 * "이게 새 것인가"를 추적하지 않아도 되게 하기 위해서다.
 *
 * **구현체는 이메일 unique 위반을 `EmailAlreadyRegisteredError`로 번역해야 한다.**
 * 유스케이스의 사전 조회만으로는 동시 가입을 막을 수 없다.
 */
export interface AccountRepository {
  findById(id: AccountId, tx?: TransactionContext): Promise<Account | null>;
  findByEmail(email: Email, tx?: TransactionContext): Promise<Account | null>;
  save(account: Account, tx?: TransactionContext): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
```

`session.repository.ts`:

```ts
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Session } from '../../../domain/session';

export interface SessionRepository {
  /** 해시로 찾는다. 원본 리프레시 토큰은 저장되지 않으므로 이것이 유일한 조회 경로다. */
  findByRefreshTokenHash(hash: string, tx?: TransactionContext): Promise<Session | null>;
  save(session: Session, tx?: TransactionContext): Promise<void>;
  /**
   * 계정의 살아 있는 세션을 한꺼번에 폐기하고 폐기된 개수를 반환한다.
   * 비밀번호 변경이 이걸 부른다 — 스펙 §10.8이 sessions 테이블을 "즉시 무효화의 근거"라고
   * 적은 이유가 이 메서드다. 이미 폐기된 세션은 세지 않는다.
   */
  revokeAllForAccount(
    accountId: AccountId,
    now: Date,
    tx?: TransactionContext,
  ): Promise<number>;
}

export const SESSION_REPOSITORY = Symbol('SessionRepository');
```

- [ ] **Step 2: 암호·토큰·메일 포트를 만든다**

`password-hasher.ts`:

```ts
import type { Credential } from '../../../domain/credential';
import type { PlainPassword } from '../../../domain/plain-password';

/**
 * 비밀번호 해싱 포트. 알고리즘(Argon2)은 어댑터만 안다.
 *
 * 평문과 해시를 서로 다른 VO로 받는 이유는 인자 순서를 바꿔 넣는 실수를 컴파일 단계에서
 * 막기 위해서다. `verify(hash, plain)`와 `verify(plain, hash)`는 문자열 두 개짜리
 * 시그니처에서는 구분되지 않고, 뒤집히면 **모든 로그인이 실패하는 대신 모든 로그인이
 * 성공할 수도 있다.**
 */
export interface PasswordHasher {
  hash(password: PlainPassword): Promise<Credential>;
  verify(credential: Credential, password: PlainPassword): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PasswordHasher');
```

`token-issuer.ts`:

```ts
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';

export interface IssuedAccessToken {
  readonly token: string;
  /** 클라이언트가 만료를 미리 알 수 있게 함께 준다. */
  readonly expiresInSeconds: number;
}

/**
 * 토큰 발급 포트.
 *
 * 액세스 토큰과 리프레시 토큰은 **성질이 다르다.** 액세스 토큰은 자기 완결적 JWT라
 * 검증에 DB가 필요 없고(그래서 짧다), 리프레시 토큰은 불투명 난수라 `sessions` 행을
 * 찾아야만 의미가 생긴다(그래서 즉시 무효화가 된다). 자기 완결적 리프레시 토큰을 쓰면
 * 로그아웃해도 만료까지 유효한 토큰이 살아 있다.
 *
 * 스펙 §7.6의 포트 목록을 지키기 위해 둘을 한 포트에 담았다. 어댑터는 하나다.
 */
export interface TokenIssuer {
  issueAccessToken(principal: Principal): Promise<IssuedAccessToken>;
  /** 암호학적 난수. 이 값만 클라이언트에 나가고 서버에는 해시만 남는다. */
  generateRefreshToken(): string;
  /** 결정적 해시. 같은 토큰은 항상 같은 해시가 되어야 조회가 성립한다. */
  hashRefreshToken(token: string): string;
}

export const TOKEN_ISSUER = Symbol('TokenIssuer');
```

`email-sender.ts`:

```ts
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * 메일 발송 포트. 스펙 §1.3대로 실제 발송은 범위 밖이고 `ConsoleEmailSender`만 만든다.
 * 포트를 지금 두는 이유는 유스케이스가 "가입하면 메일을 보낸다"는 사실을 기록해야
 * 나중에 어댑터 하나로 붙기 때문이다.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSender');
```

- [ ] **Step 3: ACL 포트와 IdentityProvider 포트를 만든다**

`customer-directory.ts`:

```ts
import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';

/**
 * Customer 컨텍스트로 나가는 ACL 포트 (스펙 §4.2).
 *
 * identity는 `Customer` 애그리거트가 어떻게 생겼는지 모른다. 아는 것은 "계정 하나에
 * 고객 하나가 대응한다"는 사실과 그 고객의 ID뿐이다. 이 포트의 반환 타입에 도메인
 * 객체가 없는 것이 그 경계다.
 *
 * `provision`이 `tx`를 **필수로** 받는 이유: 계정과 고객은 같은 트랜잭션에서
 * 만들어져야 한다. 갈라지면 계정은 있는데 고객이 없는 사용자가 생기고, 그 사용자는
 * 주소를 하나도 추가할 수 없으면서 로그인은 되는 상태에 갇힌다.
 */
export interface CustomerDirectory {
  provision(accountId: AccountId, tx: TransactionContext): Promise<CustomerId>;
  findByAccount(accountId: AccountId): Promise<CustomerId | null>;
}

export const CUSTOMER_DIRECTORY = Symbol('CustomerDirectory');
```

`identity-provider.ts`:

```ts
export interface ExternalIdentity {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
}

/**
 * 외부 IdP(소셜 로그인) 포트. **구현체가 없다.**
 *
 * 스펙 §1.3과 §7.6이 의도적으로 인터페이스만 두기로 한 자리다. 헥사고날의 가치는
 * "어댑터 하나를 더해 기능을 붙일 수 있다"는 것이고, 이 파일은 그 주장을 코드로
 * 보여주는 자리다. Nest 모듈에 바인딩되지 않으므로 주입을 시도하면 부팅이 실패한다 —
 * 그게 맞는 동작이다.
 */
export interface IdentityProvider {
  exchangeAuthorizationCode(code: string): Promise<ExternalIdentity>;
}

export const IDENTITY_PROVIDER = Symbol('IdentityProvider');
```

`identity-provider.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IDENTITY_PROVIDER } from './identity-provider';
import { ACCOUNT_REPOSITORY } from './account.repository';

describe('IdentityProvider 포트', () => {
  it('토큰이 존재하고 다른 포트 토큰과 겹치지 않는다', () => {
    // 이 포트에는 어댑터가 없다(스펙 §7.6). 그래도 토큰을 고정해 두는 이유는
    // 소셜 로그인을 붙일 때 이 파일이 이미 자리를 잡고 있다는 것을 문서화하기 위해서다.
    expect(typeof IDENTITY_PROVIDER).toBe('symbol');
    expect(IDENTITY_PROVIDER).not.toBe(ACCOUNT_REPOSITORY);
    expect(IDENTITY_PROVIDER.description).toBe('IdentityProvider');
  });
});
```

- [ ] **Step 4: 리포지토리 계약 스위트의 실패 테스트를 쓴다**

이 파일이 이 계획에서 가장 값이 큰 테스트다. **같은 스위트가 in-memory fake와 Prisma 어댑터 양쪽에 돌아** fake가 실물과 드리프트하는 것을 구조적으로 막는다(스펙 §9.2).

Create `apps/api/src/modules/identity/testing/account-repository.contract.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../shared/kernel/identifiers';
import { Account } from '../domain/account';
import { EmailAlreadyRegisteredError } from '../domain/account.errors';
import { Credential } from '../domain/credential';
import { Email } from '../domain/email';
import type { AccountRepository } from '../application/ports/out/account.repository';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function anAccount(idSuffix: string, email: string): Account {
  return Account.register({
    id: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f${idSuffix}`),
    email: Email.of(email),
    credential: Credential.fromHash(`$argon2id$${idSuffix}`),
    now: NOW,
  });
}

/**
 * AccountRepository의 계약. in-memory fake와 Prisma 어댑터 양쪽이 통과해야 한다.
 * `createRepo`는 매 테스트마다 **비어 있는** 리포지토리를 돌려줘야 한다.
 */
export function accountRepositoryContract(
  name: string,
  createRepo: () => Promise<AccountRepository>,
): void {
  describe(`AccountRepository 계약 — ${name}`, () => {
    it('저장한 계정을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0001', 'a@example.com');
      await repo.save(account);

      const found = await repo.findById(account.id);
      expect(found?.id).toBe(account.id);
      expect(found?.email.value).toBe('a@example.com');
    });

    it('저장한 계정을 이메일로 찾는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0002', 'b@example.com');
      await repo.save(account);

      const found = await repo.findByEmail(Email.of('b@example.com'));
      expect(found?.id).toBe(account.id);
    });

    it('이메일 조회는 정규화된 값을 쓴다', async () => {
      // Email VO가 소문자로 정규화하므로 대문자로 조회해도 같은 계정이 나와야 한다.
      // 어댑터가 원본 문자열을 저장하면 여기서 깨진다.
      const repo = await createRepo();
      await repo.save(anAccount('0003', 'Mixed@Example.COM'));

      expect(await repo.findByEmail(Email.of('mixed@example.com'))).not.toBeNull();
      expect(await repo.findByEmail(Email.of('MIXED@EXAMPLE.COM'))).not.toBeNull();
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9999'))).toBeNull();
    });

    it('없는 이메일은 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findByEmail(Email.of('nobody@example.com'))).toBeNull();
    });

    it('자격증명과 갱신 시각이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const account = anAccount('0004', 'c@example.com');
      await repo.save(account);

      const changedAt = new Date('2026-06-01T00:00:00.000Z');
      const loaded = await repo.findById(account.id);
      loaded?.changeCredential(Credential.fromHash('$argon2id$rotated'), changedAt);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(account.id);
      expect(reloaded?.credential.hash).toBe('$argon2id$rotated');
      expect(reloaded?.updatedAt).toEqual(changedAt);
      expect(reloaded?.createdAt).toEqual(NOW);
    });

    it('복원된 계정은 미커밋 이벤트를 갖지 않는다', async () => {
      // 복원이 이벤트를 쌓으면 조회할 때마다 AccountRegistered가 outbox에 다시 들어간다.
      const repo = await createRepo();
      const account = anAccount('0005', 'd@example.com');
      await repo.save(account);

      const loaded = await repo.findById(account.id);
      expect(loaded?.hasUncommittedEvents).toBe(false);
    });

    it('같은 계정을 두 번 저장하면 갱신된다 — 행이 늘지 않는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0006', 'e@example.com');
      await repo.save(account);
      await repo.save(account);

      expect(await repo.findById(account.id)).not.toBeNull();
      expect(await repo.findByEmail(Email.of('e@example.com'))).not.toBeNull();
    });

    it('다른 계정이 같은 이메일을 쓰면 EmailAlreadyRegisteredError를 던진다', async () => {
      // fake가 이 규칙을 흉내내지 않으면, 유스케이스 테스트는 fake 위에서 통과하고
      // 운영에서만 P2002가 500으로 터진다. 계약 테스트가 그 드리프트를 막는다.
      const repo = await createRepo();
      await repo.save(anAccount('0007', 'dup@example.com'));

      await expect(repo.save(anAccount('0008', 'dup@example.com'))).rejects.toThrow(
        EmailAlreadyRegisteredError,
      );
    });

    it('저장 후 원본 애그리거트를 변경해도 저장본은 바뀌지 않는다', async () => {
      // 저장이 참조를 그대로 들고 있으면(fake에서 흔한 실수) 트랜잭션 롤백 뒤에도
      // 메모리의 값이 살아남아 테스트가 거짓으로 통과한다.
      const repo = await createRepo();
      const account = anAccount('0009', 'f@example.com');
      await repo.save(account);

      account.changeCredential(Credential.fromHash('$argon2id$mutated-after-save'), NOW);

      const loaded = await repo.findById(account.id);
      expect(loaded?.credential.hash).toBe('$argon2id$0009');
    });
  });
}
```

Create `apps/api/src/modules/identity/testing/session-repository.contract.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../shared/kernel/identifiers';
import { Session } from '../domain/session';
import type { SessionRepository } from '../application/ports/out/session.repository';

const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.hours(24 * 14);

function aSession(suffix: string, accountSuffix: string, hash: string): Session {
  return Session.issue({
    id: SessionId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e${accountSuffix}`),
    refreshTokenHash: hash,
    now: NOW,
    ttl: TTL,
  });
}

export function sessionRepositoryContract(
  name: string,
  createRepo: () => Promise<SessionRepository>,
): void {
  describe(`SessionRepository 계약 — ${name}`, () => {
    it('저장한 세션을 리프레시 토큰 해시로 찾는다', async () => {
      const repo = await createRepo();
      const session = aSession('1001', '1001', 'hash-a');
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-a');
      expect(found?.id).toBe(session.id);
      expect(found?.accountId).toBe(session.accountId);
    });

    it('없는 해시는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findByRefreshTokenHash('nope')).toBeNull();
    });

    it('회전한 세션은 새 해시로만 찾힌다', async () => {
      // 옛 토큰이 여전히 찾히면 회전이 아무 의미가 없다.
      const repo = await createRepo();
      const session = aSession('1002', '1002', 'hash-old');
      await repo.save(session);

      session.rotate({ refreshTokenHash: 'hash-new', now: NOW, ttl: TTL });
      await repo.save(session);

      expect(await repo.findByRefreshTokenHash('hash-old')).toBeNull();
      expect(await repo.findByRefreshTokenHash('hash-new')).not.toBeNull();
    });

    it('만료·회전·폐기 시각이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const session = aSession('1003', '1003', 'hash-b');
      const rotatedAt = new Date(NOW.getTime() + 1000);
      session.rotate({ refreshTokenHash: 'hash-b2', now: rotatedAt, ttl: TTL });
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-b2');
      expect(found?.issuedAt).toEqual(NOW);
      expect(found?.rotatedAt).toEqual(rotatedAt);
      expect(found?.expiresAt).toEqual(new Date(rotatedAt.getTime() + TTL.millis));
      expect(found?.revokedAt).toBeNull();
    });

    it('폐기된 세션은 복원해도 폐기 상태다', async () => {
      // 매퍼가 revoked_at을 흘리면 로그아웃한 세션이 되살아난다.
      const repo = await createRepo();
      const session = aSession('1004', '1004', 'hash-c');
      session.revoke(NOW);
      await repo.save(session);

      const found = await repo.findByRefreshTokenHash('hash-c');
      expect(found?.revokedAt).toEqual(NOW);
      expect(found?.isActive(NOW)).toBe(false);
    });

    it('revokeAllForAccount가 그 계정의 살아 있는 세션만 폐기한다', async () => {
      const repo = await createRepo();
      await repo.save(aSession('1005', '2001', 'hash-d1'));
      await repo.save(aSession('1006', '2001', 'hash-d2'));
      await repo.save(aSession('1007', '2002', 'hash-e1'));

      const revokedAt = new Date(NOW.getTime() + 5000);
      const count = await repo.revokeAllForAccount(
        AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e2001'),
        revokedAt,
      );

      expect(count).toBe(2);
      expect((await repo.findByRefreshTokenHash('hash-d1'))?.revokedAt).toEqual(revokedAt);
      expect((await repo.findByRefreshTokenHash('hash-d2'))?.revokedAt).toEqual(revokedAt);
      // 다른 계정은 건드리지 않는다. 이 단언이 없으면 "전체 폐기" 버그가 통과한다.
      expect((await repo.findByRefreshTokenHash('hash-e1'))?.revokedAt).toBeNull();
    });

    it('이미 폐기된 세션은 다시 세지 않고 시각도 덮어쓰지 않는다', async () => {
      const repo = await createRepo();
      const session = aSession('1008', '2003', 'hash-f');
      session.revoke(NOW);
      await repo.save(session);

      const later = new Date(NOW.getTime() + 10_000);
      const count = await repo.revokeAllForAccount(
        AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3e2003'),
        later,
      );

      expect(count).toBe(0);
      expect((await repo.findByRefreshTokenHash('hash-f'))?.revokedAt).toEqual(NOW);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const session = aSession('1009', '2004', 'hash-g');
      await repo.save(session);

      session.revoke(NOW);

      expect((await repo.findByRefreshTokenHash('hash-g'))?.revokedAt).toBeNull();
    });
  });
}
```

- [ ] **Step 5: 실패를 확인한다**

Create `apps/api/src/modules/identity/testing/in-memory-account.repository.spec.ts`:

```ts
import { accountRepositoryContract } from './account-repository.contract';
import { InMemoryAccountRepository } from './in-memory-account.repository';

accountRepositoryContract('in-memory', async () => new InMemoryAccountRepository());
```

Create `apps/api/src/modules/identity/testing/in-memory-session.repository.spec.ts`:

```ts
import { sessionRepositoryContract } from './session-repository.contract';
import { InMemorySessionRepository } from './in-memory-session.repository';

sessionRepositoryContract('in-memory', async () => new InMemorySessionRepository());
```

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/testing/`
Expected: FAIL — fake 클래스들이 없다.

- [ ] **Step 6: in-memory 리포지토리 두 개를 구현한다**

`in-memory-account.repository.ts`:

```ts
import type { AccountId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { AccountRepository } from '../application/ports/out/account.repository';
import { Account } from '../domain/account';
import { EmailAlreadyRegisteredError } from '../domain/account.errors';
import type { Email } from '../domain/email';

/**
 * 단위 테스트용 AccountRepository.
 *
 * 두 가지를 실물과 똑같이 흉내낸다. 둘 다 빠뜨리면 유스케이스 테스트가 fake 위에서
 * 통과하고 운영에서만 깨진다 — 계약 테스트가 이 둘을 강제한다.
 *
 * 1. **저장 시 복사한다.** 참조를 그대로 들고 있으면 저장 뒤 애그리거트를 바꾼 것이
 *    저장본에도 반영돼, 트랜잭션 롤백을 흉내낼 수 없다.
 * 2. **이메일 유일성을 강제한다.** 실물은 unique 인덱스가 P2002를 던진다.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, Account>();

  async findById(id: AccountId, _tx?: TransactionContext): Promise<Account | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryAccountRepository.copy(stored) : null;
  }

  async findByEmail(email: Email, _tx?: TransactionContext): Promise<Account | null> {
    for (const stored of this.byId.values()) {
      if (stored.email.equals(email)) {
        return InMemoryAccountRepository.copy(stored);
      }
    }
    return null;
  }

  async save(account: Account, _tx?: TransactionContext): Promise<void> {
    for (const stored of this.byId.values()) {
      if (stored.id !== account.id && stored.email.equals(account.email)) {
        throw new EmailAlreadyRegisteredError(account.email.value);
      }
    }
    this.byId.set(account.id, InMemoryAccountRepository.copy(account));
  }

  private static copy(account: Account): Account {
    return Account.rehydrate({
      id: account.id,
      email: account.email,
      credential: account.credential,
      createdAt: new Date(account.createdAt.getTime()),
      updatedAt: new Date(account.updatedAt.getTime()),
    });
  }
}
```

`in-memory-session.repository.ts`:

```ts
import type { AccountId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { SessionRepository } from '../application/ports/out/session.repository';
import { Session } from '../domain/session';

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();

  async findByRefreshTokenHash(
    hash: string,
    _tx?: TransactionContext,
  ): Promise<Session | null> {
    for (const stored of this.byId.values()) {
      if (stored.refreshTokenHash === hash) {
        return InMemorySessionRepository.copy(stored);
      }
    }
    return null;
  }

  async save(session: Session, _tx?: TransactionContext): Promise<void> {
    this.byId.set(session.id, InMemorySessionRepository.copy(session));
  }

  async revokeAllForAccount(
    accountId: AccountId,
    now: Date,
    _tx?: TransactionContext,
  ): Promise<number> {
    let revoked = 0;
    for (const [id, stored] of this.byId) {
      if (stored.accountId !== accountId || stored.revokedAt !== null) {
        continue;
      }
      const copy = InMemorySessionRepository.copy(stored);
      copy.revoke(now);
      this.byId.set(id, copy);
      revoked += 1;
    }
    return revoked;
  }

  private static copy(session: Session): Session {
    return Session.rehydrate({
      id: session.id,
      accountId: session.accountId,
      refreshTokenHash: session.refreshTokenHash,
      issuedAt: new Date(session.issuedAt.getTime()),
      expiresAt: new Date(session.expiresAt.getTime()),
      rotatedAt: session.rotatedAt === null ? null : new Date(session.rotatedAt.getTime()),
      revokedAt: session.revokedAt === null ? null : new Date(session.revokedAt.getTime()),
    });
  }
}
```

- [ ] **Step 7: 나머지 fake 네 개를 구현한다**

`fake-password-hasher.ts`:

```ts
import type { PasswordHasher } from '../application/ports/out/password-hasher';
import { Credential } from '../domain/credential';
import type { PlainPassword } from '../domain/plain-password';

const PREFIX = 'fake-hash:';

/**
 * 단위 테스트용 해셔. Argon2는 한 번에 100ms 안팎이 걸려 유스케이스 테스트 수십 개를
 * 돌리면 그것만으로 수 초가 된다.
 *
 * **되돌릴 수 있는 변환을 쓴다.** 테스트가 "이 계정의 비밀번호가 무엇인지"를 해시에서
 * 읽어야 할 때가 있고, 실물 해셔로는 불가능하다. 운영 코드는 이 클래스를 import할 수
 * 없다 (`no-test-doubles-in-production`).
 */
export class FakePasswordHasher implements PasswordHasher {
  async hash(password: PlainPassword): Promise<Credential> {
    return Credential.fromHash(`${PREFIX}${password.reveal()}`);
  }

  async verify(credential: Credential, password: PlainPassword): Promise<boolean> {
    return credential.hash === `${PREFIX}${password.reveal()}`;
  }
}
```

`fake-token-issuer.ts`:

```ts
import type { Principal } from '../../../shared/kernel/ports/access-token-verifier';
import type {
  IssuedAccessToken,
  TokenIssuer,
} from '../application/ports/out/token-issuer';

/**
 * 결정적 토큰 발급기. 테스트가 발급된 토큰의 정확한 문자열을 단언할 수 있게 한다.
 * 액세스 토큰에 principal을 그대로 인코딩해, 유스케이스가 올바른 principal을 넘겼는지
 * 토큰만 보고 확인할 수 있다.
 */
export class FakeTokenIssuer implements TokenIssuer {
  private refreshCounter = 0;

  constructor(readonly expiresInSeconds: number = 900) {}

  async issueAccessToken(principal: Principal): Promise<IssuedAccessToken> {
    return {
      token: `access:${principal.accountId}:${principal.customerId}`,
      expiresInSeconds: this.expiresInSeconds,
    };
  }

  generateRefreshToken(): string {
    this.refreshCounter += 1;
    return `refresh-${this.refreshCounter}`;
  }

  hashRefreshToken(token: string): string {
    return `h(${token})`;
  }
}
```

`recording-email-sender.ts`:

```ts
import type { EmailMessage, EmailSender } from '../application/ports/out/email-sender';

export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** 발송이 실패하는 상황을 만든다 — 메일 실패가 가입을 되돌리지 않는지 확인할 때 쓴다. */
export class FailingEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    throw new Error('메일 서버에 연결할 수 없습니다.');
  }
}
```

`stub-customer-directory.ts`:

```ts
// CustomerId는 타입이자 팩토리 값이다 — 한 번의 값 import로 둘 다 얻는다.
import { type AccountId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CustomerDirectory } from '../application/ports/out/customer-directory';

/**
 * Customer 컨텍스트 대역. identity의 유스케이스 테스트는 실제 Customer 모듈을 알 필요가
 * 없다 — 그게 ACL을 둔 이유다.
 */
export class StubCustomerDirectory implements CustomerDirectory {
  readonly provisioned: AccountId[] = [];
  private readonly byAccount = new Map<string, CustomerId>();
  private counter = 0;

  async provision(accountId: AccountId, _tx: TransactionContext): Promise<CustomerId> {
    this.provisioned.push(accountId);
    const existing = this.byAccount.get(accountId);
    if (existing) {
      return existing;
    }
    this.counter += 1;
    const customerId = CustomerId.of(
      `018f2b1c-4a5d-7e6f-8a9b-0c1daaaa${this.counter.toString(16).padStart(4, '0')}`,
    );
    this.byAccount.set(accountId, customerId);
    return customerId;
  }

  async findByAccount(accountId: AccountId): Promise<CustomerId | null> {
    return this.byAccount.get(accountId) ?? null;
  }
}
```

`identity.fixtures.ts`:

```ts
import { Duration } from '../../../shared/kernel/duration';

/** 테스트 전반에서 쓰는 고정값. 여러 파일이 같은 값을 다시 타이핑하지 않게 모아둔다. */
export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');
export const REFRESH_TTL = Duration.hours(24 * 14);
export const VALID_PASSWORD = 'correct horse battery staple';
export const OTHER_PASSWORD = 'another valid password 42';
```

- [ ] **Step 7b: `RecordingEventPublisher`가 트랜잭션 컨텍스트를 기록하게 한다**

계획 1의 fake는 이벤트만 평평하게 모으고 `tx`를 버린다. 그래서 "이벤트를 애그리거트
저장과 **같은 트랜잭션**에서 발행했는가"를 검증할 수 없다 — 스펙 §6.3이 이벤트 유실을
막는 유일한 방법이라고 못박은 바로 그 성질이다.

기존 `published` 배열은 그대로 두고(계획 1의 테스트들이 쓴다) 호출 단위 기록을 더한다.

`apps/api/src/shared/testing/recording-event-publisher.ts`:

```ts
import type { DomainEvent } from '../kernel/domain-event';
import type { DomainEventPublisher } from '../kernel/ports/domain-event.publisher';
import type { TransactionContext } from '../kernel/ports/transaction-manager';

export interface PublishCall {
  readonly events: DomainEvent[];
  readonly tx: TransactionContext | undefined;
}

/**
 * 유스케이스 테스트용 fake.
 * "이 유스케이스가 OrderPaid를 발행했는가"를 상태로 검증한다.
 *
 * `publishCalls`는 호출 단위로 `tx`까지 남긴다 — 이벤트를 애그리거트 저장과 같은
 * 트랜잭션에서 발행했는지 확인하려면 그 인자가 있었는지를 봐야 한다. `tx`를 빠뜨리면
 * 애그리거트는 커밋되고 이벤트만 유실되는 경로가 열리는데, `published`만 보는
 * 테스트로는 그 회귀를 잡을 수 없다.
 */
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];
  readonly publishCalls: PublishCall[] = [];

  async publish(events: DomainEvent[], tx?: TransactionContext): Promise<void> {
    this.published.push(...events);
    this.publishCalls.push({ events: [...events], tx });
  }

  eventsOfType(eventType: string): DomainEvent[] {
    return this.published.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.published.length = 0;
    this.publishCalls.length = 0;
  }
}
```

`recording-event-publisher.spec.ts`에 추가한다.

```ts
  it('tx 없이 부르면 publishCalls에 undefined로 남는다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([anEvent()]);
    expect(publisher.publishCalls).toHaveLength(1);
    expect(publisher.publishCalls[0]?.tx).toBeUndefined();
  });

  it('tx와 함께 부르면 그 값이 남는다', async () => {
    const publisher = new RecordingEventPublisher();
    const tx = {} as TransactionContext;
    await publisher.publish([anEvent()], tx);
    expect(publisher.publishCalls[0]?.tx).toBe(tx);
  });

  it('clear()가 publishCalls도 비운다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([anEvent()]);
    publisher.clear();
    expect(publisher.publishCalls).toEqual([]);
  });

  it('publishCalls는 인자로 받은 배열을 복사해 담는다', async () => {
    // 호출자가 배열을 재사용하면(pullEvents 뒤 재사용 등) 기록이 뒤바뀐다.
    const publisher = new RecordingEventPublisher();
    const events = [anEvent()];
    await publisher.publish(events);
    events.length = 0;
    expect(publisher.publishCalls[0]?.events).toHaveLength(1);
  });
```

기존 spec 파일에 `anEvent()` 헬퍼가 없으면 파일에 이미 있는 이벤트 생성 방식을 그대로 쓴다.
`import type { TransactionContext } from '../kernel/ports/transaction-manager';`를 추가한다.

- [ ] **Step 8: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/`
Expected: PASS — 계약 스위트 두 개가 in-memory 구현 위에서 전부 통과한다.

- [ ] **Step 9: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다. 계약 테스트가 실제로 fake의 결함을 잡는지 확인하는 것이 목적이다.

**(a) 복사 누락을 잡는가**
`InMemoryAccountRepository.save`의 `this.byId.set(account.id, InMemoryAccountRepository.copy(account));`를 `this.byId.set(account.id, account);`로 바꾼다.
Expected: FAIL — `'저장 후 원본 애그리거트를 변경해도 저장본은 바뀌지 않는다'`가 실패한다.
되돌린다.

**(b) 이메일 유일성 흉내를 잡는가**
`InMemoryAccountRepository.save`의 유일성 루프를 지운다.
Expected: FAIL — `'다른 계정이 같은 이메일을 쓰면 EmailAlreadyRegisteredError를 던진다'`가 실패한다.
되돌린다.

**(c) `revokeAllForAccount`의 계정 필터를 잡는가**
`stored.accountId !== accountId ||` 부분을 지워 모든 세션을 폐기하게 만든다.
Expected: FAIL — `'revokeAllForAccount가 그 계정의 살아 있는 세션만 폐기한다'`가 `hash-e1`의 `revokedAt`이 null이 아니라는 이유로 실패한다. **다른 계정을 확인하는 마지막 단언이 없었다면 이 버그는 통과했을 것**임을 확인한다.
되돌린다.

- [ ] **Step 10: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 `application-knows-no-adapters`와 `no-test-doubles-in-production`을 새 파일들에 적용한다.

```bash
git add apps/api/src/modules/identity
git commit -m "feat(identity): 아웃바운드 포트 7종과 계약 테스트를 통과하는 fake 6종을 추가한다"
```

---

### Task 7: Identity 애플리케이션 — SignUp / SignIn

**Files:**
- Create: `apps/api/src/modules/identity/application/ports/in/sign-up.usecase.ts`
- Create: `apps/api/src/modules/identity/application/ports/in/sign-in.usecase.ts`
- Create: `apps/api/src/modules/identity/application/services/mint-session-tokens.ts`
- Create: `apps/api/src/modules/identity/application/services/sign-up.service.ts` + `sign-up.service.spec.ts`
- Create: `apps/api/src/modules/identity/application/services/sign-in.service.ts` + `sign-in.service.spec.ts`
- Modify: `apps/api/src/modules/identity/application/ports/out/customer-directory.ts` (예외 하나 추가)

**Interfaces:**
- Consumes: 태스크 6의 포트 7종 + fake 6종, `TransactionManager`/`Clock`/`IdGenerator`/`DomainEventPublisher` (`shared/kernel/ports/`), `PassthroughTransactionManager`·`MutableClock`·`SequentialIdGenerator`·`RecordingEventPublisher` (`shared/testing/`)
- Produces:
  - `SessionTokens { accessToken: string; refreshToken: string; expiresInSeconds: number }`
  - `SignUpUseCase { execute(command: { email: string; password: string }): Promise<SessionTokens> }`, `SIGN_UP_USECASE`
  - `SignInUseCase { execute(command: { email: string; password: string }): Promise<SessionTokens> }`, `SIGN_IN_USECASE`
  - `SignUpService`, `SignInService` (생성자 인자 순서가 태스크 16의 Nest `useFactory`와 일치해야 한다)
  - `mintSessionTokens(tokens, principal)`
  - `CustomerNotProvisionedError` (일반 `Error` — 500)

- [ ] **Step 1: 인바운드 포트 두 개를 만든다**

`sign-up.usecase.ts`:

```ts
/**
 * 발급된 세션. 액세스 토큰과 리프레시 토큰이 함께 나가고, 이후 이 둘은 BFF의
 * 암호화 쿠키 안에서만 산다 (스펙 §8.5). 브라우저 자바스크립트는 둘 다 보지 못한다.
 */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface SignUpCommand {
  readonly email: string;
  readonly password: string;
}

/**
 * 가입은 성공 시 곧바로 세션을 발급한다. 가입 직후 로그인 화면으로 보내는 흐름을
 * 만들지 않기 위해서다 — 사용자가 방금 입력한 비밀번호를 한 번 더 입력할 이유가 없다.
 */
export interface SignUpUseCase {
  execute(command: SignUpCommand): Promise<SessionTokens>;
}

export const SIGN_UP_USECASE = Symbol('SignUpUseCase');
```

`sign-in.usecase.ts`:

```ts
import type { SessionTokens } from './sign-up.usecase';

export interface SignInCommand {
  readonly email: string;
  readonly password: string;
}

export interface SignInUseCase {
  execute(command: SignInCommand): Promise<SessionTokens>;
}

export const SIGN_IN_USECASE = Symbol('SignInUseCase');
```

- [ ] **Step 2: `customer-directory.ts`에 예외를 추가한다**

```ts
/**
 * 계정은 있는데 대응하는 고객이 없다. 가입이 한 트랜잭션에서 둘을 만들므로 정상
 * 경로에서는 발생할 수 없다 — 발생했다면 데이터가 깨진 것이다. `DomainError`로
 * 만들지 않아 500으로 떨어진다.
 */
export class CustomerNotProvisionedError extends Error {
  constructor(accountId: string) {
    super(`계정 ${accountId}에 대응하는 고객이 없습니다.`);
    this.name = 'CustomerNotProvisionedError';
  }
}
```

- [ ] **Step 3: SignUp의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/application/services/sign-up.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Duration } from '../../../../shared/kernel/duration';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { ACCOUNT_REGISTERED } from '../../domain/account.events';
import { EmailAlreadyRegisteredError } from '../../domain/account.errors';
import { PasswordPolicyViolationError } from '../../domain/plain-password';
import { InvalidEmailError } from '../../domain/email';
import { Email } from '../../domain/email';
import { FIXED_NOW, REFRESH_TTL, VALID_PASSWORD } from '../../testing/identity.fixtures';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { FailingEmailSender, RecordingEmailSender } from '../../testing/recording-email-sender';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { SignUpService } from './sign-up.service';

/**
 * 해싱 호출 횟수를 세는 fake. `vi.spyOn` 대신 상속으로 만든다 — 목 라이브러리 금지
 * 규칙을 지키면서 "언제 해싱했는가"를 상태로 검증하는 방법이다.
 */
class CountingPasswordHasher extends FakePasswordHasher {
  hashCalls = 0;

  override async hash(password: PlainPassword): Promise<Credential> {
    this.hashCalls += 1;
    return super.hash(password);
  }
}

function build(
  overrides: {
    emails?: RecordingEmailSender | FailingEmailSender;
    hasher?: FakePasswordHasher;
  } = {},
) {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const hasher = overrides.hasher ?? new FakePasswordHasher();
  const tokens = new FakeTokenIssuer(900);
  const emails = overrides.emails ?? new RecordingEmailSender();
  const tx = new PassthroughTransactionManager();
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();
  const events = new RecordingEventPublisher();

  const service = new SignUpService(
    accounts,
    sessions,
    customers,
    hasher,
    tokens,
    emails,
    tx,
    clock,
    ids,
    events,
    REFRESH_TTL,
  );

  return { service, accounts, sessions, customers, hasher, tokens, emails, clock, ids, events };
}

const COMMAND = { email: 'New.User@Example.com', password: VALID_PASSWORD };

describe('SignUpService', () => {
  it('계정을 만들고 정규화된 이메일로 저장한다', async () => {
    const { service, accounts } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(saved).not.toBeNull();
    expect(saved?.createdAt).toEqual(FIXED_NOW);
  });

  it('비밀번호를 해싱해 저장한다 — 평문이 남지 않는다', async () => {
    const { service, accounts } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(saved?.credential.hash).not.toBe(VALID_PASSWORD);
    expect(saved?.credential.hash).toBe(`fake-hash:${VALID_PASSWORD}`);
  });

  it('고객을 같은 트랜잭션에서 만든다', async () => {
    const { service, accounts, customers } = build();
    await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    expect(customers.provisioned).toEqual([saved?.id]);
  });

  it('발급한 액세스 토큰이 계정과 고객을 모두 담는다', async () => {
    const { service, accounts, customers } = build();
    const result = await service.execute(COMMAND);

    const saved = await accounts.findByEmail(Email.of('new.user@example.com'));
    const customerId = await customers.findByAccount(saved!.id);
    // FakeTokenIssuer가 principal을 토큰 문자열에 그대로 인코딩한다.
    // customerId를 빠뜨리면 주소록 엔드포인트가 매 요청마다 추가 조회를 하게 된다.
    expect(result.accessToken).toBe(`access:${saved?.id}:${customerId}`);
  });

  it('세션을 저장하되 저장하는 것은 해시다 — 원본 리프레시 토큰이 아니다', async () => {
    const { service, sessions } = build();
    const result = await service.execute(COMMAND);

    expect(await sessions.findByRefreshTokenHash(result.refreshToken)).toBeNull();
    const session = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(session).not.toBeNull();
    expect(session?.expiresAt).toEqual(new Date(FIXED_NOW.getTime() + REFRESH_TTL.millis));
  });

  it('AccountRegistered 이벤트를 트랜잭션 컨텍스트와 함께 발행한다', async () => {
    const { service, events } = build();
    await service.execute(COMMAND);

    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.eventType).toBe(ACCOUNT_REGISTERED);
    // tx가 없으면 계정 저장과 outbox 기록이 다른 트랜잭션이 되어 이벤트가 유실될 수 있다.
    expect(events.publishCalls).toHaveLength(1);
    expect(events.publishCalls[0]?.tx).toBeDefined();
  });

  it('환영 메일을 보낸다', async () => {
    const emails = new RecordingEmailSender();
    const { service } = build({ emails });
    await service.execute(COMMAND);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]?.to).toBe('new.user@example.com');
  });

  it('메일 발송이 실패해도 가입은 성공한다', async () => {
    // 메일은 부수 효과지 가입의 일부가 아니다. 여기서 던지면 계정은 이미 만들어졌는데
    // 사용자에게는 실패로 보이고, 다시 시도하면 409가 난다 — 계정이 잠긴다.
    const { service, accounts } = build({ emails: new FailingEmailSender() });

    await expect(service.execute(COMMAND)).resolves.toBeDefined();
    expect(await accounts.findByEmail(Email.of('new.user@example.com'))).not.toBeNull();
  });

  it('메일 발송은 트랜잭션 밖에서 일어난다', async () => {
    // 트랜잭션 안에서 SMTP를 기다리면 DB 커넥션이 네트워크 지연만큼 잡혀 있다.
    const emails = new RecordingEmailSender();
    const { service, events } = build({ emails });
    await service.execute(COMMAND);

    // RecordingEventPublisher는 트랜잭션 안에서(tx와 함께) 호출되고, 메일은 그 뒤다.
    expect(events.publishCalls[0]?.tx).toBeDefined();
    expect(emails.sent).toHaveLength(1);
  });

  it('이미 가입된 이메일이면 EmailAlreadyRegisteredError를 던진다', async () => {
    const { service } = build();
    await service.execute(COMMAND);

    await expect(service.execute(COMMAND)).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('대소문자만 다른 이메일도 중복으로 본다', async () => {
    const { service } = build();
    await service.execute(COMMAND);

    await expect(
      service.execute({ email: 'NEW.USER@EXAMPLE.COM', password: VALID_PASSWORD }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('중복 가입 시도는 세션을 만들지 않는다', async () => {
    const { service, sessions } = build();
    const first = await service.execute(COMMAND);
    await expect(service.execute(COMMAND)).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash(`h(${first.refreshToken})`)).not.toBeNull();
    expect(await sessions.findByRefreshTokenHash('h(refresh-2)')).toBeNull();
  });

  it('짧은 비밀번호는 PasswordPolicyViolationError를 던진다', async () => {
    const { service } = build();
    await expect(service.execute({ email: 'a@example.com', password: 'short' })).rejects.toThrow(
      PasswordPolicyViolationError,
    );
  });

  it('잘못된 이메일은 InvalidEmailError를 던진다', async () => {
    const { service } = build();
    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow(
      InvalidEmailError,
    );
  });

  it('검증 실패는 해싱을 시작하기 전에 일어난다', async () => {
    // Argon2 해싱은 요청당 100ms 안팎이다. 이메일이 형식부터 틀렸는데 해싱을 먼저 하면
    // 잘못된 요청을 값싸게 거절할 기회를 버린다 — 느린 경로를 통한 DoS 표면이 열린다.
    const hasher = new CountingPasswordHasher();
    const { service } = build({ hasher });

    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow();

    expect(hasher.hashCalls).toBe(0);
  });
});
```

spec 상단 import에 `import type { Credential } from '../../domain/credential';`과 `import type { PlainPassword } from '../../domain/plain-password';`를 함께 넣는다 (`CountingPasswordHasher`의 시그니처가 쓴다).

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/application/services/sign-up.service.spec.ts`
Expected: FAIL — `sign-up.service.ts`가 없다.

- [ ] **Step 5: `mint-session-tokens.ts`를 만든다**

```ts
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { IssuedAccessToken, TokenIssuer } from '../ports/out/token-issuer';

export interface MintedTokens {
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly access: IssuedAccessToken;
}

/**
 * 세 유스케이스(가입·로그인·갱신)가 공통으로 하는 일. 원본 리프레시 토큰과 그 해시를
 * 함께 돌려주는 것이 요점이다 — 원본은 클라이언트로, 해시는 DB로 간다. 이 짝을 각
 * 서비스가 따로 만들면 한 곳에서 원본을 저장하는 실수가 조용히 들어올 수 있다.
 */
export async function mintSessionTokens(
  tokens: TokenIssuer,
  principal: Principal,
): Promise<MintedTokens> {
  const refreshToken = tokens.generateRefreshToken();
  return {
    refreshToken,
    refreshTokenHash: tokens.hashRefreshToken(refreshToken),
    access: await tokens.issueAccessToken(principal),
  };
}
```

- [ ] **Step 6: `sign-up.service.ts`를 구현한다**

```ts
import type { Duration } from '../../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Account } from '../../domain/account';
import { EmailAlreadyRegisteredError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import type { AccountRepository } from '../ports/out/account.repository';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import type { EmailSender } from '../ports/out/email-sender';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import type { SessionTokens, SignUpCommand, SignUpUseCase } from '../ports/in/sign-up.usecase';
import { mintSessionTokens } from './mint-session-tokens';

export class SignUpService implements SignUpUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly emails: EmailSender,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: DomainEventPublisher,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: SignUpCommand): Promise<SessionTokens> {
    // 값 객체 생성이 먼저다. 형식·정책 위반을 해싱 전에 값싸게 거절한다 —
    // Argon2는 요청당 100ms 안팎이라 이 순서가 뒤집히면 느린 경로가 열린다.
    const email = Email.of(command.email);
    const password = PlainPassword.of(command.password);

    // 해싱은 트랜잭션 **밖**에서 한다. 안에서 하면 DB 커넥션을 100ms 동안 붙잡는다.
    const credential = await this.hasher.hash(password);
    const now = this.clock.now();

    const result = await this.transactions.run(async (tx) => {
      // 사전 조회는 좋은 에러 메시지를 위한 것이지 유일성의 근거가 아니다.
      // 두 요청이 동시에 여기를 통과할 수 있고, 그때는 아래 save()가 DB의 unique
      // 인덱스에 걸려 같은 예외를 던진다 (어댑터가 P2002를 번역한다).
      const existing = await this.accounts.findByEmail(email, tx);
      if (existing !== null) {
        throw new EmailAlreadyRegisteredError(email.value);
      }

      const account = Account.register({
        id: AccountId.of(this.ids.nextId()),
        email,
        credential,
        now,
      });
      await this.accounts.save(account, tx);
      // 애그리거트 저장과 같은 트랜잭션에서 outbox에 넣는다 — 이벤트 유실을 막는
      // 유일한 방법이다 (스펙 §6.3).
      await this.events.publish(account.pullEvents(), tx);

      const customerId = await this.customers.provision(account.id, tx);
      const principal: Principal = { accountId: account.id, customerId };

      const minted = await mintSessionTokens(this.tokens, principal);
      await this.sessions.save(
        Session.issue({
          id: SessionId.of(this.ids.nextId()),
          accountId: account.id,
          refreshTokenHash: minted.refreshTokenHash,
          now,
          ttl: this.refreshTtl,
        }),
        tx,
      );

      return {
        accessToken: minted.access.token,
        refreshToken: minted.refreshToken,
        expiresInSeconds: minted.access.expiresInSeconds,
      };
    });

    // 커밋 뒤에 보낸다. 트랜잭션이 롤백됐는데 환영 메일만 나가는 일이 없다.
    // 발송 실패가 가입을 되돌리지도 않는다 — 계정은 이미 있는데 사용자에게는 실패로
    // 보이면, 다시 시도할 때 409가 나면서 계정이 잠긴다.
    await this.sendWelcomeEmail(email.value);

    return result;
  }

  private async sendWelcomeEmail(to: string): Promise<void> {
    try {
      await this.emails.send({
        to,
        subject: '가입을 환영합니다',
        body: `${to} 계정이 생성되었습니다.`,
      });
    } catch {
      // 의도적으로 삼킨다. 실제 발송이 붙는 시점에 재시도 큐로 바꾼다.
    }
  }
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/application/services/sign-up.service.spec.ts`
Expected: PASS

- [ ] **Step 8: SignIn의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/application/services/sign-in.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { AccountId } from '../../../../shared/kernel/identifiers';
import { Account } from '../../domain/account';
import { InvalidCredentialsError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import { FIXED_NOW, OTHER_PASSWORD, REFRESH_TTL, VALID_PASSWORD } from '../../testing/identity.fixtures';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { SignInService } from './sign-in.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f7001');

async function build() {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const hasher = new FakePasswordHasher();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();

  const service = new SignInService(
    accounts,
    sessions,
    customers,
    hasher,
    tokens,
    clock,
    ids,
    REFRESH_TTL,
  );

  return { service, accounts, sessions, customers, hasher, tokens, clock, ids };
}

async function seedAccount(
  accounts: InMemoryAccountRepository,
  hasher: FakePasswordHasher,
  customers: StubCustomerDirectory,
): Promise<void> {
  const account = Account.register({
    id: ACCOUNT_ID,
    email: Email.of('user@example.com'),
    credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
    now: FIXED_NOW,
  });
  account.pullEvents();
  await accounts.save(account);
  await customers.provision(ACCOUNT_ID, {} as never);
}

describe('SignInService', () => {
  it('올바른 자격증명으로 세션을 발급한다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    const result = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    const customerId = await customers.findByAccount(ACCOUNT_ID);
    expect(result.accessToken).toBe(`access:${ACCOUNT_ID}:${customerId}`);
    expect(result.expiresInSeconds).toBe(900);
  });

  it('대소문자가 달라도 로그인된다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'USER@Example.com', password: VALID_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('세션에는 리프레시 토큰의 해시만 저장한다', async () => {
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    const result = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    expect(await sessions.findByRefreshTokenHash(result.refreshToken)).toBeNull();
    const session = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(session?.accountId).toBe(ACCOUNT_ID);
    expect(session?.issuedAt).toEqual(FIXED_NOW);
  });

  it('로그인할 때마다 새 세션이 생긴다 — 기존 세션을 끊지 않는다', async () => {
    // 여러 기기에서 동시에 로그인할 수 있어야 한다.
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    const first = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });
    const second = await service.execute({ email: 'user@example.com', password: VALID_PASSWORD });

    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(await sessions.findByRefreshTokenHash(`h(${first.refreshToken})`)).not.toBeNull();
    expect(await sessions.findByRefreshTokenHash(`h(${second.refreshToken})`)).not.toBeNull();
  });

  it('비밀번호가 틀리면 InvalidCredentialsError를 던진다', async () => {
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'user@example.com', password: OTHER_PASSWORD }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('없는 이메일도 같은 예외와 같은 메시지를 낸다', async () => {
    // 메시지가 갈리면 "이 이메일은 가입돼 있다"는 사실이 새어 계정 열거 공격의 재료가
    // 된다. 두 경로가 문자열까지 같아야 한다.
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    const wrongPassword = await service
      .execute({ email: 'user@example.com', password: OTHER_PASSWORD })
      .catch((error: Error) => error);
    const unknownEmail = await service
      .execute({ email: 'nobody@example.com', password: VALID_PASSWORD })
      .catch((error: Error) => error);

    expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);
    expect((unknownEmail as Error).message).toBe((wrongPassword as Error).message);
  });

  it('로그인 실패는 세션을 만들지 않는다', async () => {
    const { service, accounts, hasher, customers, sessions } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'user@example.com', password: OTHER_PASSWORD }),
    ).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash('h(refresh-1)')).toBeNull();
  });

  it('비밀번호 정책 위반은 로그인에서 InvalidCredentialsError가 된다', async () => {
    // 로그인 입력은 "정책을 만족하는 새 비밀번호"가 아니라 "예전에 정한 비밀번호"다.
    // 정책이 나중에 강화되면 기존 사용자의 비밀번호가 정책을 만족하지 않을 수 있고,
    // 그때 422 PASSWORD_POLICY_VIOLATED를 돌려주면 "당신의 비밀번호는 10자 미만이군요"를
    // 알려주는 꼴이 된다.
    const { service, accounts, hasher, customers } = await build();
    await seedAccount(accounts, hasher, customers);

    await expect(
      service.execute({ email: 'user@example.com', password: 'short' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('잘못된 형식의 이메일도 InvalidCredentialsError가 된다', async () => {
    const { service } = await build();
    await expect(service.execute({ email: 'nope', password: VALID_PASSWORD })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('계정은 있는데 고객이 없으면 500 계열 예외를 던진다', async () => {
    const { service, accounts, hasher } = await build();
    const account = Account.register({
      id: ACCOUNT_ID,
      email: Email.of('orphan@example.com'),
      credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
      now: FIXED_NOW,
    });
    account.pullEvents();
    await accounts.save(account);
    // customers.provision을 부르지 않았다 — 데이터가 깨진 상태.

    await expect(
      service.execute({ email: 'orphan@example.com', password: VALID_PASSWORD }),
    ).rejects.toThrow(CustomerNotProvisionedError);
  });
});
```

- [ ] **Step 9: `sign-in.service.ts`를 구현한다**

```ts
import type { Duration } from '../../../../shared/kernel/duration';
import { SessionId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import { InvalidCredentialsError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import type { AccountRepository } from '../ports/out/account.repository';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import type { SessionTokens } from '../ports/in/sign-up.usecase';
import type { SignInCommand, SignInUseCase } from '../ports/in/sign-in.usecase';
import { mintSessionTokens } from './mint-session-tokens';

/**
 * 로그인은 트랜잭션을 열지 않는다. 쓰기가 세션 행 하나뿐이라 원자성을 보장할 대상이 없다.
 */
export class SignInService implements SignInUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: SignInCommand): Promise<SessionTokens> {
    // 형식·정책 위반도 전부 InvalidCredentialsError로 뭉갠다. 로그인 입력은 "정책을
    // 만족하는 새 비밀번호"가 아니라 "예전에 정한 비밀번호"이고, 여기서 정책 위반을
    // 알려주면 저장된 비밀번호의 성질이 새어 나간다.
    const email = SignInService.parseEmail(command.email);
    const password = SignInService.parsePassword(command.password);

    const account = email === null ? null : await this.accounts.findByEmail(email);
    if (account === null || password === null) {
      throw new InvalidCredentialsError();
    }

    if (!(await this.hasher.verify(account.credential, password))) {
      throw new InvalidCredentialsError();
    }

    const customerId = await this.customers.findByAccount(account.id);
    if (customerId === null) {
      throw new CustomerNotProvisionedError(account.id);
    }

    const principal: Principal = { accountId: account.id, customerId };
    const minted = await mintSessionTokens(this.tokens, principal);
    const now = this.clock.now();

    await this.sessions.save(
      Session.issue({
        id: SessionId.of(this.ids.nextId()),
        accountId: account.id,
        refreshTokenHash: minted.refreshTokenHash,
        now,
        ttl: this.refreshTtl,
      }),
    );

    return {
      accessToken: minted.access.token,
      refreshToken: minted.refreshToken,
      expiresInSeconds: minted.access.expiresInSeconds,
    };
  }

  private static parseEmail(raw: string): Email | null {
    try {
      return Email.of(raw);
    } catch {
      return null;
    }
  }

  private static parsePassword(raw: string): PlainPassword | null {
    try {
      return PlainPassword.of(raw);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 10: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/`
Expected: PASS

- [ ] **Step 11: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 리프레시 토큰 원본이 저장되지 않는가**
`sign-up.service.ts`에서 `refreshTokenHash: minted.refreshTokenHash`를 `refreshTokenHash: minted.refreshToken`으로 바꾼다.
Expected: FAIL — `'세션을 저장하되 저장하는 것은 해시다'`가 실패한다. 이 회귀는 **DB 유출 시 모든 세션이 즉시 탈취 가능한 상태**를 만든다.
되돌린다.

**(b) 계정 열거 방어가 실제로 있는가**
`sign-in.service.ts`에서 `if (account === null || password === null)` 블록의 예외를 `throw new Error('그런 이메일은 없습니다.')`로 바꾼다.
Expected: FAIL — `'없는 이메일도 같은 예외와 같은 메시지를 낸다'`가 실패한다.
되돌린다.

**(c) 트랜잭션 컨텍스트가 실제로 outbox까지 전달되는가**
`sign-up.service.ts`의 `await this.events.publish(account.pullEvents(), tx);`에서 `, tx`를 지운다.
Expected: FAIL — `'AccountRegistered 이벤트를 트랜잭션 컨텍스트와 함께 발행한다'`와 `'메일 발송은 트랜잭션 밖에서 일어난다'`가 `publishCalls[0].tx`가 `undefined`라며 실패한다. 이 회귀는 **계정은 만들어졌는데 이벤트는 유실되는** 경로를 연다.
되돌린다.

- [ ] **Step 12: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. 애플리케이션 커버리지 임계값(lines 90 / branches 85)이 이제 이 디렉터리에 적용된다.

```bash
git add apps/api/src/modules/identity
git commit -m "feat(identity): 가입과 로그인 유스케이스를 추가한다"
```

---

### Task 8: Identity 애플리케이션 — RefreshSession / SignOut / ChangePassword

**Files:**
- Modify: `apps/api/src/modules/identity/domain/session.errors.ts` (`SessionNotFoundError` 추가)
- Modify: `apps/api/src/modules/identity/domain/account.errors.ts` (`SamePasswordError` 추가)
- Create: `apps/api/src/modules/identity/application/ports/in/refresh-session.usecase.ts`
- Create: `apps/api/src/modules/identity/application/ports/in/sign-out.usecase.ts`
- Create: `apps/api/src/modules/identity/application/ports/in/change-password.usecase.ts`
- Create: `apps/api/src/modules/identity/application/services/refresh-session.service.ts` + spec
- Create: `apps/api/src/modules/identity/application/services/sign-out.service.ts` + spec
- Create: `apps/api/src/modules/identity/application/services/change-password.service.ts` + spec

**Interfaces:**
- Consumes: 태스크 6·7의 포트와 fake, `mintSessionTokens`
- Produces:
  - `RefreshSessionUseCase { execute(command: { refreshToken: string }): Promise<SessionTokens> }`, `REFRESH_SESSION_USECASE`
  - `SignOutUseCase { execute(command: { refreshToken: string }): Promise<void> }`, `SIGN_OUT_USECASE`
  - `ChangePasswordUseCase { execute(command: { accountId: AccountId; currentPassword: string; newPassword: string }): Promise<void> }`, `CHANGE_PASSWORD_USECASE`
  - `RefreshSessionService(sessions, customers, tokens, clock, refreshTtl)`
  - `SignOutService(sessions, tokens, clock)`
  - `ChangePasswordService(accounts, sessions, hasher, transactions, clock)`
  - `SessionNotFoundError` (`CODE = 'SESSION_NOT_FOUND'`), `SamePasswordError` (`CODE = 'SAME_PASSWORD'`)

- [ ] **Step 1: 예외 두 개를 추가한다**

`session.errors.ts`에 추가:

```ts
/**
 * 제시된 리프레시 토큰과 매치되는 세션이 없다. 회전 때문에 **정상 사용 중에도 발생한다** —
 * 옛 토큰은 회전 직후부터 어느 행과도 매치되지 않는다. 그래서 이건 공격 신호가 아니라
 * "다시 로그인하라"는 신호다.
 */
export class SessionNotFoundError extends DomainError {
  static readonly CODE = 'SESSION_NOT_FOUND';
  readonly code = SessionNotFoundError.CODE;

  constructor() {
    super('세션을 찾을 수 없습니다.');
  }
}
```

`account.errors.ts`에 추가:

```ts
/**
 * 새 비밀번호가 현재 비밀번호와 같다.
 *
 * 해시끼리 비교해서는 알 수 없다 — Argon2는 매번 다른 솔트를 쓰므로 같은 비밀번호도
 * 다른 해시가 나온다. 새 평문을 **현재 해시에 대조**해야만 알 수 있고, 그건 해셔가
 * 필요하므로 도메인이 아니라 유스케이스의 판단이다.
 */
export class SamePasswordError extends DomainError {
  static readonly CODE = 'SAME_PASSWORD';
  readonly code = SamePasswordError.CODE;

  constructor() {
    super('새 비밀번호가 현재 비밀번호와 같습니다.');
  }
}
```

- [ ] **Step 2: RefreshSession의 실패 테스트를 쓴다**

Create `apps/api/src/modules/identity/application/services/refresh-session.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Duration } from '../../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { Session } from '../../domain/session';
import {
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../../domain/session.errors';
import { FIXED_NOW, REFRESH_TTL } from '../../testing/identity.fixtures';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { StubCustomerDirectory } from '../../testing/stub-customer-directory';
import { RefreshSessionService } from './refresh-session.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f8001');
const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f8002');

async function build() {
  const sessions = new InMemorySessionRepository();
  const customers = new StubCustomerDirectory();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  const service = new RefreshSessionService(sessions, customers, tokens, clock, REFRESH_TTL);
  await customers.provision(ACCOUNT_ID, {} as never);
  return { service, sessions, customers, tokens, clock };
}

async function seedSession(sessions: InMemorySessionRepository, hash: string): Promise<Session> {
  const session = Session.issue({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    refreshTokenHash: hash,
    now: FIXED_NOW,
    ttl: REFRESH_TTL,
  });
  await sessions.save(session);
  return session;
}

describe('RefreshSessionService', () => {
  it('새 액세스 토큰과 새 리프레시 토큰을 낸다', async () => {
    const { service, sessions, customers } = await build();
    await seedSession(sessions, 'h(old-token)');

    const result = await service.execute({ refreshToken: 'old-token' });

    const customerId = await customers.findByAccount(ACCOUNT_ID);
    expect(result.accessToken).toBe(`access:${ACCOUNT_ID}:${customerId}`);
    expect(result.refreshToken).not.toBe('old-token');
  });

  it('회전 후 옛 리프레시 토큰은 더 이상 쓸 수 없다', async () => {
    // 회전의 존재 이유다. 옛 토큰이 계속 통하면 유출된 토큰을 회수할 방법이 없다.
    const { service, sessions } = await build();
    await seedSession(sessions, 'h(old-token)');

    await service.execute({ refreshToken: 'old-token' });

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it('회전된 세션은 같은 행을 유지한다 — 세션이 늘지 않는다', async () => {
    const { service, sessions } = await build();
    await seedSession(sessions, 'h(old-token)');

    const result = await service.execute({ refreshToken: 'old-token' });

    const rotated = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(rotated?.id).toBe(SESSION_ID);
    expect(rotated?.issuedAt).toEqual(FIXED_NOW);
  });

  it('만료 시각을 현재 시각 기준으로 다시 잡는다', async () => {
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');

    clock.advanceBy(Duration.hours(24 * 7));
    const later = clock.now();
    const result = await service.execute({ refreshToken: 'old-token' });

    const rotated = await sessions.findByRefreshTokenHash(`h(${result.refreshToken})`);
    expect(rotated?.expiresAt).toEqual(new Date(later.getTime() + REFRESH_TTL.millis));
    expect(rotated?.rotatedAt).toEqual(later);
  });

  it('없는 토큰은 SessionNotFoundError다', async () => {
    const { service } = await build();
    await expect(service.execute({ refreshToken: 'nope' })).rejects.toThrow(SessionNotFoundError);
  });

  it('만료된 세션은 SessionExpiredError다', async () => {
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');

    clock.advanceBy(Duration.hours(24 * 15));

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionExpiredError,
    );
  });

  it('폐기된 세션은 SessionRevokedError다', async () => {
    const { service, sessions } = await build();
    const session = await seedSession(sessions, 'h(old-token)');
    session.revoke(FIXED_NOW);
    await sessions.save(session);

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow(
      SessionRevokedError,
    );
  });

  it('회전 실패는 세션을 바꾸지 않는다', async () => {
    // 만료 확인 전에 해시부터 갈아 끼우면, 실패한 갱신이 멀쩡한 세션을 망가뜨린다.
    const { service, sessions, clock } = await build();
    await seedSession(sessions, 'h(old-token)');
    clock.advanceBy(Duration.hours(24 * 15));

    await expect(service.execute({ refreshToken: 'old-token' })).rejects.toThrow();

    expect(await sessions.findByRefreshTokenHash('h(old-token)')).not.toBeNull();
  });

  it('고객이 없으면 500 계열 예외를 던진다', async () => {
    const { service, sessions, customers } = await build();
    const orphanAccount = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9001');
    await sessions.save(
      Session.issue({
        id: SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9002'),
        accountId: orphanAccount,
        refreshTokenHash: 'h(orphan-token)',
        now: FIXED_NOW,
        ttl: REFRESH_TTL,
      }),
    );
    expect(await customers.findByAccount(orphanAccount)).toBeNull();

    await expect(service.execute({ refreshToken: 'orphan-token' })).rejects.toThrow(
      /고객이 없습니다/,
    );
  });
});
```

- [ ] **Step 3: `refresh-session.service.ts`를 구현한다**

인바운드 포트 `refresh-session.usecase.ts`:

```ts
import type { SessionTokens } from './sign-up.usecase';

export interface RefreshSessionCommand {
  readonly refreshToken: string;
}

export interface RefreshSessionUseCase {
  execute(command: RefreshSessionCommand): Promise<SessionTokens>;
}

export const REFRESH_SESSION_USECASE = Symbol('RefreshSessionUseCase');
```

```ts
import type { Duration } from '../../../../shared/kernel/duration';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import { SessionNotFoundError } from '../../domain/session.errors';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import type { SessionTokens } from '../ports/in/sign-up.usecase';
import type {
  RefreshSessionCommand,
  RefreshSessionUseCase,
} from '../ports/in/refresh-session.usecase';
import { mintSessionTokens } from './mint-session-tokens';

/**
 * 리프레시 토큰을 회전시킨다.
 *
 * 트랜잭션을 열지 않는다 — 쓰기가 세션 행 하나뿐이다. 다만 **회전 실패가 세션을
 * 망가뜨리지 않도록** `Session.rotate`가 상태 변경 전에 전부 검사한다.
 */
export class RefreshSessionService implements RefreshSessionUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: RefreshSessionCommand): Promise<SessionTokens> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(command.refreshToken),
    );
    if (session === null) {
      throw new SessionNotFoundError();
    }

    const customerId = await this.customers.findByAccount(session.accountId);
    if (customerId === null) {
      throw new CustomerNotProvisionedError(session.accountId);
    }

    const principal: Principal = { accountId: session.accountId, customerId };
    const minted = await mintSessionTokens(this.tokens, principal);

    // rotate가 만료·폐기를 먼저 검사하고 던진다. 여기서 던지면 아래 save에 도달하지 않아
    // 기존 세션이 그대로 남는다.
    session.rotate({
      refreshTokenHash: minted.refreshTokenHash,
      now: this.clock.now(),
      ttl: this.refreshTtl,
    });
    await this.sessions.save(session);

    return {
      accessToken: minted.access.token,
      refreshToken: minted.refreshToken,
      expiresInSeconds: minted.access.expiresInSeconds,
    };
  }
}
```

- [ ] **Step 4: SignOut의 실패 테스트와 구현**

`sign-out.usecase.ts`:

```ts
export interface SignOutCommand {
  readonly refreshToken: string;
}

/**
 * 멱등하다. 이미 없는 토큰이나 이미 폐기된 세션에도 성공으로 답한다 — 로그아웃 요청을
 * 재시도하는 클라이언트에게 실패를 돌려줄 이유가 없고, "그 토큰은 존재한다"는 정보를
 * 흘릴 이유도 없다.
 */
export interface SignOutUseCase {
  execute(command: SignOutCommand): Promise<void>;
}

export const SIGN_OUT_USECASE = Symbol('SignOutUseCase');
```

Create `sign-out.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { Session } from '../../domain/session';
import { FIXED_NOW, REFRESH_TTL } from '../../testing/identity.fixtures';
import { FakeTokenIssuer } from '../../testing/fake-token-issuer';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { SignOutService } from './sign-out.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fa001');
const SESSION_ID = SessionId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fa002');

function build() {
  const sessions = new InMemorySessionRepository();
  const tokens = new FakeTokenIssuer(900);
  const clock = new MutableClock(FIXED_NOW);
  return { service: new SignOutService(sessions, tokens, clock), sessions, clock };
}

async function seed(sessions: InMemorySessionRepository): Promise<void> {
  await sessions.save(
    Session.issue({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      refreshTokenHash: 'h(token)',
      now: FIXED_NOW,
      ttl: REFRESH_TTL,
    }),
  );
}

describe('SignOutService', () => {
  it('세션을 폐기한다', async () => {
    const { service, sessions } = build();
    await seed(sessions);

    await service.execute({ refreshToken: 'token' });

    const session = await sessions.findByRefreshTokenHash('h(token)');
    expect(session?.revokedAt).toEqual(FIXED_NOW);
    expect(session?.isActive(FIXED_NOW)).toBe(false);
  });

  it('없는 토큰이어도 성공한다 (멱등)', async () => {
    const { service } = build();
    await expect(service.execute({ refreshToken: 'nope' })).resolves.toBeUndefined();
  });

  it('두 번 로그아웃해도 성공하고 첫 폐기 시각을 유지한다', async () => {
    const { service, sessions, clock } = build();
    await seed(sessions);

    await service.execute({ refreshToken: 'token' });
    clock.setTo(new Date(FIXED_NOW.getTime() + 60_000));
    await expect(service.execute({ refreshToken: 'token' })).resolves.toBeUndefined();

    expect((await sessions.findByRefreshTokenHash('h(token)'))?.revokedAt).toEqual(FIXED_NOW);
  });

  it('폐기 후에는 그 세션의 리프레시 토큰이 아무 데도 쓰이지 못한다', async () => {
    const { service, sessions } = build();
    await seed(sessions);
    await service.execute({ refreshToken: 'token' });

    const session = await sessions.findByRefreshTokenHash('h(token)');
    expect(() =>
      session?.rotate({ refreshTokenHash: 'h(new)', now: FIXED_NOW, ttl: REFRESH_TTL }),
    ).toThrow();
  });
});
```

`sign-out.service.ts`:

```ts
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import type { SignOutCommand, SignOutUseCase } from '../ports/in/sign-out.usecase';

export class SignOutService implements SignOutUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(command: SignOutCommand): Promise<void> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(command.refreshToken),
    );
    if (session === null) {
      // 멱등. 이미 회전됐거나 애초에 없던 토큰이다. 실패로 답하면 클라이언트가
      // 재시도 루프에 빠지고, "그 토큰은 있었다"는 정보만 새어 나간다.
      return;
    }

    session.revoke(this.clock.now());
    await this.sessions.save(session);
  }
}
```

- [ ] **Step 5: ChangePassword의 실패 테스트를 쓴다**

`change-password.usecase.ts`:

```ts
import type { AccountId } from '../../../../shared/kernel/identifiers';

export interface ChangePasswordCommand {
  /** 인증된 principal에서 온다. 요청 본문에서 오지 않는다. */
  readonly accountId: AccountId;
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ChangePasswordUseCase {
  execute(command: ChangePasswordCommand): Promise<void>;
}

export const CHANGE_PASSWORD_USECASE = Symbol('ChangePasswordUseCase');
```

Create `change-password.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { Account } from '../../domain/account';
import { InvalidCredentialsError, SamePasswordError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PasswordPolicyViolationError, PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import { FIXED_NOW, OTHER_PASSWORD, REFRESH_TTL, VALID_PASSWORD } from '../../testing/identity.fixtures';
import { FakePasswordHasher } from '../../testing/fake-password-hasher';
import { InMemoryAccountRepository } from '../../testing/in-memory-account.repository';
import { InMemorySessionRepository } from '../../testing/in-memory-session.repository';
import { ChangePasswordService } from './change-password.service';

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fb001');
const OTHER_ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fb009');

async function build() {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakePasswordHasher();
  const transactions = new PassthroughTransactionManager();
  const clock = new MutableClock(FIXED_NOW);
  const service = new ChangePasswordService(accounts, sessions, hasher, transactions, clock);

  const account = Account.register({
    id: ACCOUNT_ID,
    email: Email.of('user@example.com'),
    credential: await hasher.hash(PlainPassword.of(VALID_PASSWORD)),
    now: FIXED_NOW,
  });
  account.pullEvents();
  await accounts.save(account);

  return { service, accounts, sessions, hasher, clock };
}

async function seedSessions(sessions: InMemorySessionRepository): Promise<void> {
  for (const [index, accountId] of [ACCOUNT_ID, ACCOUNT_ID, OTHER_ACCOUNT_ID].entries()) {
    await sessions.save(
      Session.issue({
        id: SessionId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fc00${index}`),
        accountId,
        refreshTokenHash: `h(token-${index})`,
        now: FIXED_NOW,
        ttl: REFRESH_TTL,
      }),
    );
  }
}

describe('ChangePasswordService', () => {
  it('비밀번호를 바꾸고 갱신 시각을 찍는다', async () => {
    const { service, accounts, clock } = await build();
    clock.setTo(new Date('2026-04-01T00:00:00.000Z'));

    await service.execute({
      accountId: ACCOUNT_ID,
      currentPassword: VALID_PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    const account = await accounts.findById(ACCOUNT_ID);
    expect(account?.credential.hash).toBe(`fake-hash:${OTHER_PASSWORD}`);
    expect(account?.updatedAt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
  });

  it('그 계정의 모든 세션을 폐기한다 — 현재 세션도 포함한다', async () => {
    // 비밀번호를 바꾸는 이유의 절반은 "누가 내 계정에 들어와 있다"이다. 현재 세션만
    // 남기면 공격자의 세션이 어느 쪽인지 알 수 없으므로 전부 끊는 편이 정직하다.
    const { service, sessions } = await build();
    await seedSessions(sessions);

    await service.execute({
      accountId: ACCOUNT_ID,
      currentPassword: VALID_PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    expect((await sessions.findByRefreshTokenHash('h(token-0)'))?.revokedAt).toEqual(FIXED_NOW);
    expect((await sessions.findByRefreshTokenHash('h(token-1)'))?.revokedAt).toEqual(FIXED_NOW);
    // 다른 계정의 세션은 건드리지 않는다.
    expect((await sessions.findByRefreshTokenHash('h(token-2)'))?.revokedAt).toBeNull();
  });

  it('현재 비밀번호가 틀리면 InvalidCredentialsError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: 'wrong password here',
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('현재 비밀번호가 틀리면 세션도 비밀번호도 그대로다', async () => {
    const { service, accounts, sessions } = await build();
    await seedSessions(sessions);

    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: 'wrong password here',
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow();

    expect((await accounts.findById(ACCOUNT_ID))?.credential.hash).toBe(
      `fake-hash:${VALID_PASSWORD}`,
    );
    expect((await sessions.findByRefreshTokenHash('h(token-0)'))?.revokedAt).toBeNull();
  });

  it('새 비밀번호가 정책을 어기면 PasswordPolicyViolationError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: 'short',
      }),
    ).rejects.toThrow(PasswordPolicyViolationError);
  });

  it('새 비밀번호가 현재와 같으면 SamePasswordError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({
        accountId: ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: VALID_PASSWORD,
      }),
    ).rejects.toThrow(SamePasswordError);
  });

  it('없는 계정이면 InvalidCredentialsError다', async () => {
    // 토큰은 유효한데 계정이 사라진 경우. 404로 답하면 "이 계정 ID는 존재하지 않는다"를
    // 알려주는 셈이고, 어차피 사용자가 할 일은 재로그인이다.
    const { service } = await build();
    await expect(
      service.execute({
        accountId: OTHER_ACCOUNT_ID,
        currentPassword: VALID_PASSWORD,
        newPassword: OTHER_PASSWORD,
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });
});
```

- [ ] **Step 6: `change-password.service.ts`를 구현한다**

```ts
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { InvalidCredentialsError, SamePasswordError } from '../../domain/account.errors';
import { PlainPassword } from '../../domain/plain-password';
import type { AccountRepository } from '../ports/out/account.repository';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';
import type {
  ChangePasswordCommand,
  ChangePasswordUseCase,
} from '../ports/in/change-password.usecase';

/**
 * 비밀번호 변경. 계정 갱신과 세션 폐기는 **같은 트랜잭션**이다 — 갈라지면 비밀번호는
 * 바뀌었는데 옛 세션이 살아 있는 창이 생긴다. 그 창이 정확히 이 유스케이스가 닫으려는
 * 것이다.
 */
export class ChangePasswordService implements ChangePasswordUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    // 새 비밀번호의 정책 검사가 먼저다 — 정책을 어긴 요청에 해싱·조회 비용을 쓰지 않는다.
    const newPassword = PlainPassword.of(command.newPassword);

    const account = await this.accounts.findById(command.accountId);
    if (account === null) {
      throw new InvalidCredentialsError();
    }

    const currentPassword = ChangePasswordService.parse(command.currentPassword);
    if (currentPassword === null || !(await this.hasher.verify(account.credential, currentPassword))) {
      throw new InvalidCredentialsError();
    }

    // 해시끼리 비교할 수 없다 — Argon2는 매번 다른 솔트를 쓴다. 새 평문을 현재 해시에
    // 대조하는 것이 유일한 방법이다.
    if (await this.hasher.verify(account.credential, newPassword)) {
      throw new SamePasswordError();
    }

    const next = await this.hasher.hash(newPassword);
    const now = this.clock.now();

    await this.transactions.run(async (tx) => {
      account.changeCredential(next, now);
      await this.accounts.save(account, tx);
      await this.sessions.revokeAllForAccount(account.id, now, tx);
    });
  }

  private static parse(raw: string): PlainPassword | null {
    try {
      return PlainPassword.of(raw);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/`
Expected: PASS

- [ ] **Step 8: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 회전이 실제로 옛 토큰을 무효화하는가**
`refresh-session.service.ts`의 `session.rotate({...})` 인자에서 `refreshTokenHash: minted.refreshTokenHash`를 `refreshTokenHash: session.refreshTokenHash`로 바꾼다(해시를 그대로 둔다).
Expected: FAIL — `'회전 후 옛 리프레시 토큰은 더 이상 쓸 수 없다'`가 실패한다.
되돌린다.

**(b) 회전 실패가 세션을 망가뜨리지 않는가**
`refresh-session.service.ts`에서 `session.rotate(...)`와 `await this.sessions.save(session)`의 순서를 유지한 채, `Session.rotate`의 `assertUsable` 호출을 메서드 **끝**으로 옮긴다.
Expected: FAIL — `'회전 실패는 세션을 바꾸지 않는다'`가 실패한다. 만료된 세션에 대해 해시가 이미 갈렸기 때문이다.
되돌린다.

**(c) 비밀번호 변경이 다른 계정을 건드리지 않는가**
`change-password.service.ts`에서 `revokeAllForAccount(account.id, ...)`를 `revokeAllForAccount(command.accountId, ...)`로 바꾸는 것은 같은 값이라 아무 차이가 없다. 대신 `ChangePasswordService`의 세션 폐기 줄을 통째로 지운다.
Expected: FAIL — `'그 계정의 모든 세션을 폐기한다'`가 실패한다. **이 회귀는 "비밀번호를 바꿨는데 침입자의 세션이 그대로 살아 있는" 상태**를 만들고, 사용자는 자신이 안전해졌다고 믿는다.
되돌린다.

- [ ] **Step 9: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/identity
git commit -m "feat(identity): 세션 갱신·로그아웃·비밀번호 변경 유스케이스를 추가한다"
```

---

### Task 9: 영속 스키마 — 테이블 4종과 부분 유니크 인덱스 (M8)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_identity_customer/migration.sql`
- Create: `apps/api/test/schema/indexes.integration.spec.ts`

**Interfaces:**
- Produces (태스크 11·13의 매퍼가 이 컬럼 이름에 의존한다):
  - `accounts(id, email UNIQUE, password_hash, created_at, updated_at)`
  - `sessions(id, account_id, refresh_token_hash UNIQUE, issued_at, expires_at, rotated_at, revoked_at)` + `account_id` 인덱스
  - `customers(id, account_id UNIQUE, created_at)`
  - `saved_addresses(id, customer_id, label, recipient, phone, zip, line1, line2, is_default)` + `customer_id` 인덱스 + **부분 유니크 인덱스** `saved_addresses_default_idx`
  - Prisma 모델명: `Account`, `Session`, `Customer`, `SavedAddress`

**M8이 여기서 해결된다.** 부분 인덱스는 Prisma 스키마 언어로 표현할 수 없다(`@@index`에 `where`가 없다). 그래서 원시 SQL로만 존재하고, **`prisma migrate dev`가 스키마와 DB를 비교하다가 "스키마에 없는 인덱스"라며 DROP을 제안할 수 있다.** 계획 1의 `outbox_unpublished_idx`가 정확히 그 상태였고 아무 검사도 없었다. 이 태스크가 두 인덱스 모두에 자동 검사를 붙인다.

- [ ] **Step 1: 인덱스 검사 통합 테스트를 먼저 쓴다**

Create `apps/api/test/schema/indexes.integration.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../setup/database';

interface IndexRow {
  indexdef: string;
}

async function indexDefinition(name: string): Promise<string | null> {
  const db = await testDb();
  const rows = await db.$queryRaw<IndexRow[]>`
    SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ${name}
  `;
  return rows[0]?.indexdef ?? null;
}

describe('부분 인덱스가 마이그레이션에 남아 있는지', () => {
  // 부분 인덱스는 Prisma 스키마 언어로 표현할 수 없어 원시 SQL로만 존재한다.
  // 즉 `prisma migrate dev`가 "스키마에 없는 인덱스"라며 DROP을 제안하는 순간
  // 조용히 사라질 수 있고, 사라져도 기능 테스트는 전부 통과한다 — 느려질 뿐이거나
  // (outbox), 불변식이 코드에만 남을 뿐이다(saved_addresses).
  // 이 스위트가 그 소실을 소리 나게 만든다.

  it('outbox_unpublished_idx가 존재하고 published_at IS NULL 부분 인덱스다', async () => {
    const def = await indexDefinition('outbox_unpublished_idx');
    expect(def).not.toBeNull();
    expect(def).toContain('occurred_at');
    expect(def?.toLowerCase()).toContain('where (published_at is null)');
  });

  it('saved_addresses_default_idx가 존재하고 부분 UNIQUE 인덱스다', async () => {
    const def = await indexDefinition('saved_addresses_default_idx');
    expect(def).not.toBeNull();
    expect(def).toContain('UNIQUE');
    expect(def).toContain('customer_id');
    expect(def?.toLowerCase()).toContain('where is_default');
  });
});

describe('outbox 릴레이 쿼리가 부분 인덱스를 실제로 쓰는지', () => {
  it('미발행 행이 많을 때 순차 스캔이 아니라 인덱스를 탄다', async () => {
    // 인덱스가 "존재한다"와 "쓰인다"는 다른 명제다. 계획 1에서 확인한 EXPLAIN은
    // 사람이 한 번 돌린 것이라 이후 어떤 변경도 다시 확인하지 않는다.
    const db = await testDb();

    await db.$executeRawUnsafe(`
      INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, occurred_at, attempts)
      SELECT gen_random_uuid(), 'Probe', gen_random_uuid(), 'probe.Event', '{}'::jsonb,
             now() - (n || ' seconds')::interval, 0
        FROM generate_series(1, 5000) AS n
    `);
    await db.$executeRawUnsafe('ANALYZE outbox');

    const plan = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`
      EXPLAIN SELECT id FROM outbox
        WHERE published_at IS NULL AND attempts < 10
        ORDER BY occurred_at ASC
        LIMIT 100
    `);
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(planText).toContain('outbox_unpublished_idx');
  });
});

describe('기본 배송지 부분 유니크 인덱스가 DB 수준에서 강제되는지', () => {
  // 도메인(AddressBook)도 "기본은 0 또는 1개"를 지키지만, 도메인만으로는 두 요청이
  // 동시에 서로 다른 주소를 기본으로 지정하는 경합을 막을 수 없다. 마지막 방어선은 DB다.
  beforeEach(async () => {
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d00000001', 'idx@example.com', 'h', now(), now())
    `);
    await db.$executeRawUnsafe(`
      INSERT INTO customers (id, account_id, created_at)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d00000002', '018f2b1c-4a5d-7e6f-8a9b-0c1d00000001', now())
    `);
  });

  async function insertAddress(id: string, isDefault: boolean): Promise<void> {
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO saved_addresses (id, customer_id, label, recipient, phone, zip, line1, is_default)
      VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0c1d00000002', '집', '홍길동', '010', '06236', '서울', ${isDefault})
    `);
  }

  it('한 고객에게 기본 배송지 두 개를 넣으면 거부된다', async () => {
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000011', true);
    await expect(insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000012', true)).rejects.toThrow();
  });

  it('기본이 아닌 주소는 몇 개든 넣을 수 있다', async () => {
    // 부분 인덱스가 아니라 통짜 UNIQUE(customer_id)였다면 여기서 깨진다.
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000021', false);
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000022', false);
    await expect(insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000023', false)).resolves.toBeUndefined();
  });

  it('기본 배송지 하나 + 일반 주소 여럿은 허용된다', async () => {
    await insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000031', true);
    await expect(insertAddress('018f2b1c-4a5d-7e6f-8a9b-0c1d00000032', false)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm db:up && pnpm test:int apps/api/test/schema/indexes.integration.spec.ts`
Expected: FAIL — `accounts` 등의 테이블이 없다.

- [ ] **Step 3: `schema.prisma`에 모델 4종을 추가한다**

기존 `Outbox` 모델은 그대로 두고 아래를 덧붙인다. `Outbox` 모델의 doc 주석에 부분 인덱스에 대한 한 줄을 추가한다.

```prisma
/// 도메인 이벤트를 애그리거트 저장과 같은 트랜잭션으로 커밋하기 위한 테이블.
/// 릴레이가 published_at IS NULL 인 행만 폴링해 발행한다.
///
/// 부분 인덱스 `outbox_unpublished_idx`(occurred_at) WHERE published_at IS NULL 는
/// Prisma 스키마 언어로 표현할 수 없어 원시 마이그레이션 SQL에만 존재한다.
/// `prisma migrate dev`가 DROP을 제안할 수 있으므로 **절대 수락하지 말 것** —
/// apps/api/test/schema/indexes.integration.spec.ts가 소실을 잡는다.
model Outbox {
  // ... 기존 내용 그대로
}

/// identity 컨텍스트의 계정.
model Account {
  id           String   @id @db.Uuid
  /// Email VO가 소문자로 정규화한 값만 들어온다. 정규화 없이는 이 unique가
  /// User@x.com 과 user@x.com 을 서로 다른 값으로 보고 통과시킨다.
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @map("updated_at") @db.Timestamptz(3)

  @@map("accounts")
}

/// 즉시 무효화의 근거. 리프레시 토큰의 **해시만** 저장한다.
model Session {
  id               String    @id @db.Uuid
  accountId        String    @map("account_id") @db.Uuid
  refreshTokenHash String    @unique @map("refresh_token_hash")
  issuedAt         DateTime  @map("issued_at") @db.Timestamptz(3)
  expiresAt        DateTime  @map("expires_at") @db.Timestamptz(3)
  rotatedAt        DateTime? @map("rotated_at") @db.Timestamptz(3)
  revokedAt        DateTime? @map("revoked_at") @db.Timestamptz(3)

  /// revokeAllForAccount가 이 인덱스를 탄다.
  @@index([accountId])
  @@map("sessions")
}

/// customer 컨텍스트의 고객. 계정과 1:1이다.
/// `name` 컬럼을 두지 않는다 — 이 계획에 이름을 수집하는 경로가 없어 영구히 빈 컬럼이
/// 된다. 수취인 이름은 saved_addresses.recipient가 갖는다.
model Customer {
  id        String         @id @db.Uuid
  accountId String         @unique @map("account_id") @db.Uuid
  createdAt DateTime       @map("created_at") @db.Timestamptz(3)
  addresses SavedAddress[]

  @@map("customers")
}

/// 주소록 항목. id를 가진 엔티티다 — 주문의 ShippingAddress(VO, id 없음)와 별개다.
/// 고객이 이사해 이 행을 고쳐도 과거 주문의 배송지는 바뀌지 않는다 (스펙 §5.3).
///
/// 부분 유니크 인덱스 `saved_addresses_default_idx`(customer_id) WHERE is_default 는
/// Prisma 스키마로 표현할 수 없어 원시 SQL에만 있다. "기본 배송지는 0 또는 1개"
/// 불변식의 마지막 방어선이다.
model SavedAddress {
  id         String   @id @db.Uuid
  customerId String   @map("customer_id") @db.Uuid
  label      String
  recipient  String
  phone      String
  zip        String
  line1      String
  line2      String?
  isDefault  Boolean  @default(false) @map("is_default")
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([customerId])
  @@map("saved_addresses")
}
```

- [ ] **Step 4: 마이그레이션을 `--create-only`로 만든다**

```bash
pnpm --filter @commerce/api exec prisma migrate dev --create-only --name identity_customer
```

**`--create-only`가 필수다.** 그냥 `migrate dev`를 돌리면 SQL을 손보기 전에 적용해버리고, 그 과정에서 부분 인덱스 DROP 문이 있어도 그대로 실행된다.

생성된 SQL을 **읽는다.** `DROP INDEX "outbox_unpublished_idx"` 같은 줄이 있으면 **삭제한다.** 있었다면 그 사실을 태스크 보고서에 적을 것 — M8이 우려한 바로 그 현상이다.

- [ ] **Step 5: 마이그레이션 끝에 부분 유니크 인덱스를 손으로 추가한다**

생성된 `migration.sql` 파일 끝에 붙인다.

```sql
-- 기본 배송지는 고객당 0개 또는 1개.
-- 부분 유니크 인덱스라서 is_default=false 인 행은 몇 개든 허용된다.
-- Prisma 스키마 언어로는 표현할 수 없어 여기에만 존재한다 —
-- apps/api/test/schema/indexes.integration.spec.ts가 소실을 감시한다.
CREATE UNIQUE INDEX "saved_addresses_default_idx"
  ON "saved_addresses" ("customer_id")
  WHERE "is_default";
```

- [ ] **Step 6: 적용하고 클라이언트를 재생성한다**

```bash
pnpm db:migrate
pnpm db:generate
```

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm test:int apps/api/test/schema/indexes.integration.spec.ts`
Expected: PASS (7개)

`globalSetup`이 템플릿 DB를 새로 만들고 `migrate deploy`로 마이그레이션을 적용하므로, 워커 DB에도 새 테이블과 인덱스가 들어온다.

EXPLAIN 테스트가 불안정하면(플래너가 순차 스캔을 고르면) 행 수를 20000으로 늘려 다시 확인한다. 그래도 인덱스를 타지 않으면 **그 사실 자체를 보고서에 적고** 해당 테스트를 삭제하지 말 것 — `expect(planText).not.toContain('Seq Scan on outbox')` 형태로 약화시키되, 왜 약화시켰는지 주석으로 남긴다.

- [ ] **Step 8: 이 검사가 무엇을 잡는지 증명한다 (M8)**

**(a) 부분 유니크 인덱스 소실을 잡는가**
방금 추가한 `CREATE UNIQUE INDEX "saved_addresses_default_idx" ...` 블록을 마이그레이션에서 주석 처리한다. 템플릿 DB를 지우고 다시 만들어야 반영된다.

```bash
docker exec commerce-db psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'commerce_test%'"
docker exec commerce-db psql -U postgres -c "DROP DATABASE IF EXISTS commerce_test_template"
pnpm test:int apps/api/test/schema/indexes.integration.spec.ts
```

Expected: FAIL — `'saved_addresses_default_idx가 존재하고 부분 UNIQUE 인덱스다'`가 `null`이라며 실패하고, `'한 고객에게 기본 배송지 두 개를 넣으면 거부된다'`도 실패한다(두 번째 INSERT가 성공해버린다).

주석을 되돌리고 같은 절차로 다시 통과하는지 확인한다.

**(b) 통짜 UNIQUE로 바꿔도 잡히는가**
같은 인덱스에서 `WHERE "is_default"`만 지운다. 템플릿을 다시 만들고 테스트한다.
Expected: FAIL — `'기본이 아닌 주소는 몇 개든 넣을 수 있다'`가 실패한다. 부분 조건이 없으면 고객당 주소를 하나밖에 못 넣는다.
되돌리고 다시 통과하는지 확인한다.

- [ ] **Step 9: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/prisma apps/api/test/schema
git commit -m "feat(db): identity·customer 테이블과 기본 배송지 부분 유니크 인덱스를 추가하고 인덱스 소실 감시를 붙인다 (M8)"
```

---

### Task 10: Identity 아웃바운드 어댑터 — Argon2 / JWT / 콘솔 메일러

**Files:**
- Modify: `apps/api/package.json` (의존성 3개 추가), `.env.example`, `apps/api/.env`(로컬, 커밋 대상 아님)
- Create: `apps/api/src/shared/infrastructure/auth/jwt.config.ts` + `jwt.config.spec.ts`
- Create: `apps/api/src/shared/infrastructure/auth/jwt-token.service.ts` + `jwt-token.service.spec.ts`
- Create: `apps/api/src/shared/infrastructure/http/unauthenticated.error.ts`
- Create: `apps/api/src/modules/identity/adapters/out/hashing/argon2-password.hasher.ts` + spec
- Create: `apps/api/src/modules/identity/adapters/out/token/jwt-token.issuer.ts` + spec
- Create: `apps/api/src/modules/identity/adapters/out/email/console-email.sender.ts` + spec

**Interfaces:**
- Consumes: `PasswordHasher`/`TokenIssuer`/`EmailSender` 포트 (태스크 6), `AccessTokenVerifier`/`Principal` (태스크 1)
- Produces:
  - `JwtConfig { secret: string; accessTokenTtlSeconds: number }`, `readJwtConfig(env: NodeJS.ProcessEnv): JwtConfig`
  - `JwtTokenService implements AccessTokenVerifier` — `issue(principal): { token; expiresInSeconds }`, `verify(token): Promise<Principal>`
  - `UnauthenticatedError` (`CODE = 'UNAUTHENTICATED'`, 401)
  - `Argon2PasswordHasher implements PasswordHasher`
  - `JwtTokenIssuer implements TokenIssuer`
  - `ConsoleEmailSender implements EmailSender`

- [ ] **Step 1: 의존성을 버전 고정으로 설치한다**

```bash
pnpm --filter @commerce/api add @node-rs/argon2@^2.2.0 jsonwebtoken@^9.0.3
pnpm --filter @commerce/api add -D @types/jsonwebtoken@^9.0.10
pnpm db:generate
```

선택 근거를 남긴다.

- **`@node-rs/argon2`** — napi 사전 빌드 바이너리를 optionalDependencies로 배포한다. 네이티브 컴파일(node-gyp)이 필요한 `argon2` 패키지와 달리 pnpm 10+의 빌드 승인 게이트에 걸리지 않는다. 설치 중 pnpm이 빌드 승인을 요구하면 `pnpm-workspace.yaml`의 `allowBuilds`에 추가하고 그 사실을 보고서에 적는다.
- **`jsonwebtoken`** — CommonJS다. `apps/api`는 `"type": "commonjs"`에 `module: "CommonJS"`로 컴파일되므로 ESM 전용 패키지(`jose` 등)를 쓰면 런타임 import가 깨진다. 계획 1의 버전 함정과 같은 계열이다.

설치 후 확인한다.

```bash
node -p "require('@node-rs/argon2').hash ? 'argon2 ok' : 'argon2 broken'"
node -p "typeof require('jsonwebtoken').sign"
```

- [ ] **Step 2: 환경변수를 추가한다**

`.env.example`에 추가한다.

```
# 액세스 토큰 서명. 32자 이상이어야 부팅된다. 운영에서는 반드시 교체할 것.
JWT_SECRET="dev-only-secret-please-change-me-32+"
# 액세스 토큰 수명(초). 스펙 §8.5의 15분.
ACCESS_TOKEN_TTL_SECONDS=900
# 리프레시 토큰 수명(일). 스펙 §8.5의 14일.
REFRESH_TOKEN_TTL_DAYS=14
```

**로컬 `apps/api/.env`에도 같은 세 줄을 추가한다.** `.env`는 커밋되지 않지만 `vitest.config.ts`가 이 파일을 읽으므로, 빠뜨리면 통합 테스트가 "JWT_SECRET이 설정되지 않았습니다"로 깨진다.

- [ ] **Step 3: `jwt.config.ts`의 실패 테스트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { readJwtConfig } from './jwt.config';

const LONG_SECRET = 'x'.repeat(32);

describe('readJwtConfig', () => {
  it('환경변수를 읽는다', () => {
    const config = readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: '900' });
    expect(config.secret).toBe(LONG_SECRET);
    expect(config.accessTokenTtlSeconds).toBe(900);
  });

  it('TTL이 없으면 900초를 쓴다', () => {
    expect(readJwtConfig({ JWT_SECRET: LONG_SECRET }).accessTokenTtlSeconds).toBe(900);
  });

  it('JWT_SECRET이 없으면 부팅을 거부한다', () => {
    expect(() => readJwtConfig({})).toThrow(/JWT_SECRET/);
  });

  it('32자 미만인 비밀키는 거부한다', () => {
    // HS256의 안전성은 키 엔트로피에 달려 있다. 개발 편의로 넣은 짧은 키가 그대로
    // 운영에 나가는 것이 가장 흔한 경로라, 부팅 자체를 막는다.
    expect(() => readJwtConfig({ JWT_SECRET: 'short' })).toThrow(/32/);
  });

  it('TTL이 숫자가 아니면 거부한다', () => {
    expect(() =>
      readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: 'abc' }),
    ).toThrow(/ACCESS_TOKEN_TTL_SECONDS/);
  });

  it('TTL이 0 이하면 거부한다', () => {
    expect(() =>
      readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: '0' }),
    ).toThrow(/ACCESS_TOKEN_TTL_SECONDS/);
  });
});
```

- [ ] **Step 4: `jwt.config.ts`를 구현한다**

```ts
export interface JwtConfig {
  readonly secret: string;
  readonly accessTokenTtlSeconds: number;
}

const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 900;

/**
 * 부팅 시 한 번 읽는다. 잘못된 설정은 **부팅을 실패시킨다** — 첫 로그인 요청에서
 * 500으로 드러나는 것보다 낫다.
 */
export function readJwtConfig(env: NodeJS.ProcessEnv): JwtConfig {
  const secret = env['JWT_SECRET'];
  if (!secret) {
    throw new Error('JWT_SECRET이 설정되지 않았습니다. apps/api/.env를 확인하세요.');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET은 ${MIN_SECRET_LENGTH}자 이상이어야 합니다.`);
  }

  const raw = env['ACCESS_TOKEN_TTL_SECONDS'];
  if (raw === undefined) {
    return { secret, accessTokenTtlSeconds: DEFAULT_TTL_SECONDS };
  }

  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(`ACCESS_TOKEN_TTL_SECONDS는 양의 정수여야 합니다: "${raw}"`);
  }
  return { secret, accessTokenTtlSeconds: ttl };
}
```

- [ ] **Step 5: `unauthenticated.error.ts`를 만든다**

```ts
import { DomainError } from '../../kernel/domain-error';

/**
 * 인증되지 않았다. 인바운드 어댑터(가드·토큰 검증)에서만 던진다 — 스펙 결정 6대로
 * 인증은 어댑터의 관심사다.
 *
 * `DomainError`를 상속하는 이유는 순전히 배관이다: 기존 `DomainExceptionFilter` 하나가
 * 모든 예외 → HTTP 매핑을 담당하고, 그 필터는 `@Catch(DomainError)`로 잡는다.
 * 여기서 `HttpException`을 던지면 매핑 지점이 두 곳이 되고 `ErrorDto` 형태도 갈린다.
 */
export class UnauthenticatedError extends DomainError {
  static readonly CODE = 'UNAUTHENTICATED';
  readonly code = UnauthenticatedError.CODE;

  constructor(message = '인증이 필요합니다.') {
    super(message);
  }
}
```

- [ ] **Step 6: `jwt-token.service.ts`의 실패 테스트를 쓴다**

```ts
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from '../http/unauthenticated.error';
import { JwtTokenService } from './jwt-token.service';

const SECRET = 'test-secret-that-is-long-enough!!';
const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fd001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fd002'),
};

function service(ttl = 900): JwtTokenService {
  return new JwtTokenService({ secret: SECRET, accessTokenTtlSeconds: ttl });
}

describe('JwtTokenService', () => {
  it('발급한 토큰을 스스로 검증해 같은 principal을 되돌린다', async () => {
    // 발급과 검증이 한 클래스에 있는 이유가 이 테스트다. 두 클래스로 갈리면 비밀키나
    // 클레임 이름이 어긋나도 각자의 단위 테스트는 통과하고 통합에서만 깨진다.
    const sut = service();
    const issued = sut.issue(PRINCIPAL);

    await expect(sut.verify(issued.token)).resolves.toEqual(PRINCIPAL);
  });

  it('설정된 TTL을 그대로 알려준다', () => {
    expect(service(60).issue(PRINCIPAL).expiresInSeconds).toBe(60);
  });

  it('다른 비밀키로 서명된 토큰을 거부한다', async () => {
    const other = new JwtTokenService({ secret: 'another-secret-long-enough-here!', accessTokenTtlSeconds: 900 });
    const token = other.issue(PRINCIPAL).token;

    await expect(service().verify(token)).rejects.toThrow(UnauthenticatedError);
  });

  it('만료된 토큰을 거부한다', async () => {
    const expired = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS256',
      expiresIn: -10,
    });

    await expect(service().verify(expired)).rejects.toThrow(UnauthenticatedError);
  });

  it('HS256이 아닌 알고리즘으로 서명된 토큰을 거부한다', async () => {
    // 알고리즘을 명시하지 않으면 라이브러리가 헤더의 alg를 믿는다.
    const hs512 = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS512',
      expiresIn: 900,
    });

    await expect(service().verify(hs512)).rejects.toThrow(UnauthenticatedError);
  });

  it('sub가 UUID가 아니면 400이 아니라 401이다', async () => {
    // AccountId.of는 InvalidIdError(400)를 던진다. 그대로 새어 나가면 "당신의 요청
    // 형식이 틀렸다"가 되는데, 실제로는 토큰이 조작된 것이므로 401이 맞다.
    const forged = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: 'not-a-uuid',
      algorithm: 'HS256',
      expiresIn: 900,
    });

    await expect(service().verify(forged)).rejects.toThrow(UnauthenticatedError);
  });

  it('cid 클레임이 없으면 거부한다', async () => {
    const noCid = jwt.sign({}, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS256',
      expiresIn: 900,
    });

    await expect(service().verify(noCid)).rejects.toThrow(UnauthenticatedError);
  });

  it('토큰이 아닌 문자열을 거부한다', async () => {
    await expect(service().verify('garbage')).rejects.toThrow(UnauthenticatedError);
  });
});
```

- [ ] **Step 7: `jwt-token.service.ts`를 구현한다**

```ts
import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type {
  AccessTokenVerifier,
  Principal,
} from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from '../http/unauthenticated.error';
import type { JwtConfig } from './jwt.config';

const ALGORITHM = 'HS256';

/**
 * 액세스 토큰의 발급과 검증을 한 클래스가 담당한다.
 *
 * 갈라놓으면 비밀키·알고리즘·클레임 이름이 두 곳에 생기고, 어긋나도 각자의 단위
 * 테스트는 통과한다. identity의 `TokenIssuer` 어댑터는 이 클래스에 위임한다 —
 * 그래서 발급-검증 왕복이 이 파일의 테스트 하나로 고정된다.
 *
 * 이 클래스가 `shared/infrastructure`에 있는 이유는 커널 포트 `AccessTokenVerifier`의
 * 구현이기 때문이다. 모든 모듈의 가드가 이것을 쓴다.
 */
@Injectable()
export class JwtTokenService implements AccessTokenVerifier {
  constructor(private readonly config: JwtConfig) {}

  issue(principal: Principal): { token: string; expiresInSeconds: number } {
    const token = jwt.sign({ cid: principal.customerId }, this.config.secret, {
      subject: principal.accountId,
      algorithm: ALGORITHM,
      expiresIn: this.config.accessTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.config.accessTokenTtlSeconds };
  }

  async verify(token: string): Promise<Principal> {
    try {
      // algorithms를 명시하지 않으면 라이브러리가 토큰 헤더의 alg를 믿는다.
      const payload = jwt.verify(token, this.config.secret, { algorithms: [ALGORITHM] });
      if (typeof payload === 'string') {
        throw new Error('payload가 객체가 아닙니다.');
      }

      // 식별자 복원도 try 안에 있어야 한다. AccountId.of는 InvalidIdError(400)를
      // 던지는데, 조작된 토큰에 400을 돌려주면 "당신의 요청 형식이 틀렸다"고
      // 거짓말하게 된다.
      return {
        accountId: AccountId.of(String(payload.sub ?? '')),
        customerId: CustomerId.of(String(payload['cid'] ?? '')),
      };
    } catch {
      throw new UnauthenticatedError('토큰이 유효하지 않습니다.');
    }
  }
}
```

- [ ] **Step 8: Argon2 해셔의 실패 테스트와 구현**

`argon2-password.hasher.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Credential } from '../../../domain/credential';
import { PlainPassword } from '../../../domain/plain-password';
import { Argon2PasswordHasher } from './argon2-password.hasher';

const PASSWORD = PlainPassword.of('correct horse battery staple');
const OTHER = PlainPassword.of('another valid password 42');

describe('Argon2PasswordHasher', () => {
  it('해시가 평문을 포함하지 않는다', async () => {
    const credential = await new Argon2PasswordHasher().hash(PASSWORD);
    expect(credential.hash).not.toContain('horse');
  });

  it('argon2id 형식의 해시를 만든다', async () => {
    const credential = await new Argon2PasswordHasher().hash(PASSWORD);
    expect(credential.hash.startsWith('$argon2id$')).toBe(true);
  });

  it('같은 비밀번호도 매번 다른 해시가 된다 (솔트)', async () => {
    // 솔트가 없으면 같은 비밀번호를 쓰는 계정들이 DB에서 한눈에 묶인다.
    const hasher = new Argon2PasswordHasher();
    const a = await hasher.hash(PASSWORD);
    const b = await hasher.hash(PASSWORD);
    expect(a.hash).not.toBe(b.hash);
  });

  it('올바른 비밀번호를 검증한다', async () => {
    const hasher = new Argon2PasswordHasher();
    const credential = await hasher.hash(PASSWORD);
    await expect(hasher.verify(credential, PASSWORD)).resolves.toBe(true);
  });

  it('틀린 비밀번호를 거절한다', async () => {
    const hasher = new Argon2PasswordHasher();
    const credential = await hasher.hash(PASSWORD);
    await expect(hasher.verify(credential, OTHER)).resolves.toBe(false);
  });

  it('망가진 해시로 검증하면 던지지 않고 false를 낸다', async () => {
    // 저장된 해시가 잘린 경우. 던지면 로그인 시도가 500이 되고, 그 계정은 영구히
    // 로그인 불가 상태로 보인다. false를 내면 평범한 인증 실패로 처리되어
    // 사용자가 비밀번호 재설정 흐름으로 갈 수 있다.
    const hasher = new Argon2PasswordHasher();
    await expect(hasher.verify(Credential.fromHash('not-a-hash'), PASSWORD)).resolves.toBe(false);
  });
});
```

`argon2-password.hasher.ts`:

```ts
import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { Credential } from '../../../domain/credential';
import type { PlainPassword } from '../../../domain/plain-password';
import type { PasswordHasher } from '../../../application/ports/out/password-hasher';

/**
 * Argon2id 해셔. 파라미터는 라이브러리 기본값(OWASP 권고에 맞춰진 값)을 쓴다.
 * 값을 직접 적어 넣지 않는 이유는, 여기 박아두면 권고가 바뀌어도 아무도 고치지
 * 않기 때문이다. 튜닝이 필요해지면 그때 벤치마크와 함께 명시한다.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: PlainPassword): Promise<Credential> {
    return Credential.fromHash(await hash(password.reveal()));
  }

  async verify(credential: Credential, password: PlainPassword): Promise<boolean> {
    try {
      return await verify(credential.hash, password.reveal());
    } catch {
      // 저장된 해시가 망가졌다. 던지면 그 계정의 로그인이 영구히 500이 된다.
      return false;
    }
  }
}
```

- [ ] **Step 9: JWT 토큰 발급 어댑터의 실패 테스트와 구현**

`jwt-token.issuer.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import { JwtTokenService } from '../../../../../shared/infrastructure/auth/jwt-token.service';
import { JwtTokenIssuer } from './jwt-token.issuer';

const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fe001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fe002'),
};

function build(): { issuer: JwtTokenIssuer; jwtService: JwtTokenService } {
  const jwtService = new JwtTokenService({
    secret: 'test-secret-that-is-long-enough!!',
    accessTokenTtlSeconds: 900,
  });
  return { issuer: new JwtTokenIssuer(jwtService), jwtService };
}

describe('JwtTokenIssuer', () => {
  it('발급한 액세스 토큰을 같은 서비스가 검증한다', async () => {
    const { issuer, jwtService } = build();
    const issued = await issuer.issueAccessToken(PRINCIPAL);
    await expect(jwtService.verify(issued.token)).resolves.toEqual(PRINCIPAL);
  });

  it('리프레시 토큰은 매번 다르다', () => {
    const { issuer } = build();
    const tokens = new Set(Array.from({ length: 100 }, () => issuer.generateRefreshToken()));
    expect(tokens.size).toBe(100);
  });

  it('리프레시 토큰은 최소 32바이트의 엔트로피를 갖는다', () => {
    // 추측 가능한 리프레시 토큰은 세션 탈취와 같다.
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('리프레시 토큰은 JWT가 아니다', () => {
    // 자기 완결적 토큰이면 로그아웃해도 만료까지 유효하다. 불투명 난수여야
    // sessions 행 삭제/폐기가 즉시 효력을 갖는다.
    const { issuer } = build();
    expect(issuer.generateRefreshToken()).not.toContain('.');
  });

  it('해싱은 결정적이다', () => {
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(issuer.hashRefreshToken(token)).toBe(issuer.hashRefreshToken(token));
  });

  it('해시가 원본 토큰을 포함하지 않는다', () => {
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(issuer.hashRefreshToken(token)).not.toContain(token);
  });

  it('다른 토큰은 다른 해시가 된다', () => {
    const { issuer } = build();
    expect(issuer.hashRefreshToken('a')).not.toBe(issuer.hashRefreshToken('b'));
  });
});
```

`jwt-token.issuer.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { JwtTokenService } from '../../../../../shared/infrastructure/auth/jwt-token.service';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import type {
  IssuedAccessToken,
  TokenIssuer,
} from '../../../application/ports/out/token-issuer';

const REFRESH_TOKEN_BYTES = 32;

/**
 * 액세스 토큰은 `JwtTokenService`에 위임한다 — 검증하는 쪽과 같은 코드를 쓰게 해
 * 비밀키와 클레임이 갈라질 수 없게 만든다.
 *
 * 리프레시 토큰은 여기서 만든다. **JWT가 아니라 불투명 난수다.** 자기 완결적 토큰이면
 * 로그아웃해도 만료 시각까지 유효한 토큰이 남아, `sessions` 테이블을 둔 이유(즉시
 * 무효화)가 통째로 사라진다.
 *
 * 해싱에 SHA-256을 쓴다. 비밀번호와 달리 이 입력은 256비트 난수라 무차별 대입 자체가
 * 불가능하므로, Argon2의 느림이 사줄 안전이 없고 갱신 요청마다 100ms를 더할 뿐이다.
 */
@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly jwt: JwtTokenService) {}

  async issueAccessToken(principal: Principal): Promise<IssuedAccessToken> {
    return this.jwt.issue(principal);
  }

  generateRefreshToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
```

- [ ] **Step 10: 콘솔 메일러의 실패 테스트와 구현**

`console-email.sender.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ConsoleEmailSender } from './console-email.sender';

describe('ConsoleEmailSender', () => {
  it('수신자와 제목을 로그에 남긴다', async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((line) => lines.push(line));

    await sender.send({ to: 'user@example.com', subject: '가입을 환영합니다', body: '본문' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('user@example.com');
    expect(lines[0]).toContain('가입을 환영합니다');
  });

  it('본문도 남긴다', async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((line) => lines.push(line));
    await sender.send({ to: 'a@b.com', subject: '제목', body: '확인 링크: https://example.com/x' });
    expect(lines[0]).toContain('https://example.com/x');
  });
});
```

> `vi`는 import하지 않아도 된다. 로그 대상을 생성자로 주입받는 형태라 스파이가 필요 없다 — 이것이 `vi.spyOn(console, 'log')` 금지 규칙을 지키면서 로깅을 검증하는 방법이다. 위 import 줄에서 `vi`를 지운다.

`console-email.sender.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from '../../../application/ports/out/email-sender';

/**
 * 개발용 메일 발송기. 스펙 §1.3대로 실제 발송은 범위 밖이다.
 *
 * 출력 함수를 생성자로 받는 이유는 테스트가 `console.log`를 스파이하지 않고도 로그
 * 내용을 검증하기 위해서다 — 목 라이브러리 금지 규칙을 지키는 형태다.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private static readonly logger = new Logger('ConsoleEmailSender');

  constructor(
    private readonly write: (line: string) => void = (line) =>
      ConsoleEmailSender.logger.log(line),
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.write(`[메일] to=${message.to} subject=${message.subject}\n${message.body}`);
  }
}
```

- [ ] **Step 11: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/adapters apps/api/src/shared/infrastructure/auth`
Expected: PASS

- [ ] **Step 12: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 알고리즘 고정이 실제로 있는가**
`jwt-token.service.ts`의 `jwt.verify(...)`에서 `{ algorithms: [ALGORITHM] }` 인자를 지운다.
Expected: FAIL — `'HS256이 아닌 알고리즘으로 서명된 토큰을 거부한다'`가 실패한다.
되돌린다.

**(b) 식별자 복원이 try 안에 있는가**
`jwt-token.service.ts`에서 `return { accountId: ..., customerId: ... }` 블록을 `try` 밖으로 옮긴다(payload를 try 밖 변수로 빼서).
Expected: FAIL — `'sub가 UUID가 아니면 400이 아니라 401이다'`가 `InvalidIdError`가 새어 나와 실패한다.
되돌린다.

**(c) 해셔 검증이 실제로 대조하는가**
`argon2-password.hasher.ts`의 `verify`를 `return true;`로 바꾼다.
Expected: FAIL — `'틀린 비밀번호를 거절한다'`와 `'망가진 해시로 검증하면 던지지 않고 false를 낸다'`가 실패한다. **전자가 실패하는 것을 반드시 확인할 것** — 이 회귀는 아무 비밀번호로나 모든 계정에 로그인할 수 있게 만든다.
되돌린다.

- [ ] **Step 13: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src apps/api/package.json .env.example pnpm-lock.yaml
git commit -m "feat(identity): Argon2 해셔·JWT 토큰 발급기·콘솔 메일러 어댑터를 추가한다"
```

---

### Task 11: Identity 영속 어댑터 — Prisma 리포지토리와 계약 테스트

**Files:**
- Create: `apps/api/src/modules/identity/adapters/out/persistence/account.mapper.ts` + spec
- Create: `apps/api/src/modules/identity/adapters/out/persistence/session.mapper.ts` + spec
- Create: `apps/api/src/modules/identity/adapters/out/persistence/prisma-account.repository.ts`
- Create: `apps/api/src/modules/identity/adapters/out/persistence/prisma-session.repository.ts`
- Create: `apps/api/src/modules/identity/adapters/out/persistence/prisma-account.repository.integration.spec.ts`
- Create: `apps/api/src/modules/identity/adapters/out/persistence/prisma-session.repository.integration.spec.ts`
- Modify: `apps/api/prisma/schema.prisma` (주석 한 줄 — 애그리거트 경계와 FK)

**Interfaces:**
- Consumes: `AccountRepository`/`SessionRepository` 포트, `accountRepositoryContract`/`sessionRepositoryContract` (태스크 6), `asPrismaClient` (`shared/infrastructure/prisma/prisma-transaction-manager.ts`), `testDb()` (`apps/api/test/setup/database.ts`)
- Produces: `toAccountRow`/`toAccountDomain`, `toSessionRow`/`toSessionDomain`, `PrismaAccountRepository`, `PrismaSessionRepository`

**애그리거트 경계와 FK.** `sessions.account_id`에는 외래 키를 걸지 않고 `saved_addresses.customer_id`에는 건다. 기준은 스펙 §5.1의 "애그리거트 간 참조는 무조건 ID로만"이다 — `Session`과 `Account`는 **서로 다른 애그리거트 루트**라 생명주기가 독립적이어야 하고, `SavedAddress`는 `Customer` 애그리거트 **안**이라 고객이 사라지면 함께 사라져야 한다(`onDelete: Cascade`). `schema.prisma`의 `Session` 모델에 이 한 줄을 주석으로 남긴다.

- [ ] **Step 1: 매퍼의 실패 테스트를 쓴다**

`account.mapper.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, CorruptedRecordError } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { Credential } from '../../../domain/credential';
import { Email } from '../../../domain/email';
import { toAccountDomain, toAccountRow } from './account.mapper';

const ID = '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3ff001';
const CREATED = new Date('2026-03-01T10:00:00.000Z');
const UPDATED = new Date('2026-04-01T10:00:00.000Z');

const row = {
  id: ID,
  email: 'user@example.com',
  passwordHash: '$argon2id$hash',
  createdAt: CREATED,
  updatedAt: UPDATED,
};

describe('account.mapper', () => {
  it('행을 애그리거트로 복원한다', () => {
    const account = toAccountDomain(row);
    expect(account.id).toBe(ID);
    expect(account.email.value).toBe('user@example.com');
    expect(account.credential.hash).toBe('$argon2id$hash');
    expect(account.createdAt).toEqual(CREATED);
    expect(account.updatedAt).toEqual(UPDATED);
  });

  it('복원된 애그리거트는 미커밋 이벤트를 갖지 않는다', () => {
    expect(toAccountDomain(row).hasUncommittedEvents).toBe(false);
  });

  it('애그리거트를 행으로 되돌린다', () => {
    const account = Account.rehydrate({
      id: AccountId.of(ID),
      email: Email.of('user@example.com'),
      credential: Credential.fromHash('$argon2id$hash'),
      createdAt: CREATED,
      updatedAt: UPDATED,
    });
    expect(toAccountRow(account)).toEqual(row);
  });

  it('깨진 UUID를 만나면 CorruptedRecordError를 던진다 — DomainError가 아니다', () => {
    // M7. `of`를 쓰면 InvalidIdError(400)가 나가서, 우리 DB가 깨진 상황에
    // "당신의 요청이 잘못됐다"고 답하게 된다.
    expect(() => toAccountDomain({ ...row, id: 'broken' })).toThrow(CorruptedRecordError);
  });

  it('왕복해도 값이 보존된다', () => {
    expect(toAccountRow(toAccountDomain(row))).toEqual(row);
  });
});
```

`session.mapper.spec.ts`도 같은 모양으로 쓴다 — 행 ↔ 애그리거트 왕복, `revokedAt`/`rotatedAt`의 `null` 보존, 깨진 `account_id`에 대한 `CorruptedRecordError`, 복원 시 미커밋 이벤트 없음.

- [ ] **Step 2: 매퍼를 구현한다**

`account.mapper.ts`:

```ts
import { AccountId } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { Credential } from '../../../domain/credential';
import { Email } from '../../../domain/email';

export interface AccountRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `AccountId.fromPersistence`를 쓴다. `of`를 쓰면 깨진 행을 만났을 때
 * `InvalidIdError`(400)가 나가고, 클라이언트는 자기 요청이 잘못됐다고 듣는다.
 * 실제로는 우리 데이터가 깨진 것이므로 500이어야 한다 (M7).
 */
export function toAccountDomain(row: AccountRow): Account {
  return Account.rehydrate({
    id: AccountId.fromPersistence(row.id),
    email: Email.of(row.email),
    credential: Credential.fromHash(row.passwordHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toAccountRow(account: Account): AccountRow {
  return {
    id: account.id,
    email: account.email.value,
    passwordHash: account.credential.hash,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
```

`session.mapper.ts`는 같은 형태로 쓴다. `SessionId.fromPersistence`, `AccountId.fromPersistence`를 쓰고 `rotatedAt`/`revokedAt`의 `null`을 그대로 옮긴다.

- [ ] **Step 3: 계약 테스트를 Prisma 위에 돌리는 통합 spec을 쓴다**

`prisma-account.repository.integration.spec.ts`:

```ts
import { testDb } from '../../../../../../test/setup/database';
import { accountRepositoryContract } from '../../../testing/account-repository.contract';
import { PrismaAccountRepository } from './prisma-account.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다
// (testing/in-memory-account.repository.spec.ts). 두 구현이 같은 계약을 통과해야
// 유스케이스 테스트 수십 개가 fake 위에서 빠르게 돌면서도 실물과 어긋나지 않는다.
// 파일 간 정리는 integration-setup.ts의 TRUNCATE가 한다.
accountRepositoryContract('prisma', async () => new PrismaAccountRepository(await testDb()));
```

`prisma-session.repository.integration.spec.ts`도 같은 모양으로 쓴다.

Run: `pnpm test:int apps/api/src/modules/identity`
Expected: FAIL — 리포지토리 클래스가 없다.

- [ ] **Step 4: `prisma-account.repository.ts`를 구현한다**

```ts
import type { PrismaClient } from '@prisma/client';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { AccountRepository } from '../../../application/ports/out/account.repository';
import type { Account } from '../../../domain/account';
import { EmailAlreadyRegisteredError } from '../../../domain/account.errors';
import type { Email } from '../../../domain/email';
import { toAccountDomain, toAccountRow } from './account.mapper';

/** Prisma가 유니크 제약 위반에 쓰는 코드. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Prisma 7의 클라이언트는 Proxy라 `instanceof`가 프로토타입 체인을 타고 성립하지
 * 않는 경우가 있다(계획 1의 `app.module.spec.ts` 참고). 오류 판별도 클래스 대신
 * 구조적으로 한다 — `Prisma.PrismaClientKnownRequestError`를 import하지 않으면
 * 이 파일이 Prisma의 내부 클래스 구조 변화에 묶이지도 않는다.
 */
function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== UNIQUE_VIOLATION) {
    return false;
  }
  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes(field)
    : typeof target === 'string' && target.includes(field);
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: AccountId, tx?: TransactionContext): Promise<Account | null> {
    const row = await this.client(tx).account.findUnique({ where: { id } });
    return row === null ? null : toAccountDomain(row);
  }

  async findByEmail(email: Email, tx?: TransactionContext): Promise<Account | null> {
    // Email VO가 소문자로 정규화한 값으로만 조회한다. DB에 저장된 값도 같은 정규화를
    // 거친 값이므로 대소문자 무시 비교(citext, ILIKE)가 필요 없다 — 그리고 그런 비교는
    // unique 인덱스를 무력화한다.
    const row = await this.client(tx).account.findUnique({ where: { email: email.value } });
    return row === null ? null : toAccountDomain(row);
  }

  async save(account: Account, tx?: TransactionContext): Promise<void> {
    const row = toAccountRow(account);
    try {
      await this.client(tx).account.upsert({
        where: { id: row.id },
        create: row,
        update: {
          email: row.email,
          passwordHash: row.passwordHash,
          updatedAt: row.updatedAt,
        },
      });
    } catch (error) {
      // 유스케이스의 사전 조회를 두 요청이 동시에 통과한 경우 여기가 마지막 방어선이다.
      // 번역하지 않으면 500이 나가고, 사용자는 "서버 오류"를 보며 재시도한다.
      if (isUniqueViolationOn(error, 'email')) {
        throw new EmailAlreadyRegisteredError(row.email);
      }
      throw error;
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
```

- [ ] **Step 5: `prisma-session.repository.ts`를 구현한다**

```ts
import type { PrismaClient } from '@prisma/client';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { SessionRepository } from '../../../application/ports/out/session.repository';
import type { Session } from '../../../domain/session';
import { toSessionDomain, toSessionRow } from './session.mapper';

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByRefreshTokenHash(
    hash: string,
    tx?: TransactionContext,
  ): Promise<Session | null> {
    const row = await this.client(tx).session.findUnique({ where: { refreshTokenHash: hash } });
    return row === null ? null : toSessionDomain(row);
  }

  async save(session: Session, tx?: TransactionContext): Promise<void> {
    const row = toSessionRow(session);
    await this.client(tx).session.upsert({
      where: { id: row.id },
      create: row,
      update: {
        refreshTokenHash: row.refreshTokenHash,
        expiresAt: row.expiresAt,
        rotatedAt: row.rotatedAt,
        revokedAt: row.revokedAt,
      },
    });
  }

  async revokeAllForAccount(
    accountId: AccountId,
    now: Date,
    tx?: TransactionContext,
  ): Promise<number> {
    // 애그리거트를 하나씩 불러와 revoke()를 부르지 않는다. 세션이 수십 개일 수 있고,
    // 그 전부를 왕복시키는 것은 이 연산의 성질(집합 갱신)과 맞지 않는다.
    // `revokedAt: null` 조건이 멱등성을 만든다 — 이미 폐기된 세션은 세지도, 시각을
    // 덮어쓰지도 않는다.
    const result = await this.client(tx).session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/identity`
Expected: PASS — `accountRepositoryContract`의 10개와 `sessionRepositoryContract`의 8개가 Prisma 위에서 전부 통과한다.

계약 테스트가 실패하면 **fake가 아니라 어댑터를 의심할 것.** fake는 이미 같은 스위트를 통과했다.

- [ ] **Step 7: 동시 가입 경합 테스트를 추가한다**

`prisma-account.repository.integration.spec.ts` 끝에 추가한다.

```ts
import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { EmailAlreadyRegisteredError } from '../../../domain/account.errors';
import { Credential } from '../../../domain/credential';
import { Email } from '../../../domain/email';

describe('동시 가입 경합', () => {
  it('같은 이메일로 동시에 두 계정을 저장하면 정확히 하나만 성공한다', async () => {
    // 유스케이스의 사전 조회(findByEmail)는 두 요청이 동시에 통과할 수 있다.
    // 유일성의 진짜 근거는 DB의 unique 인덱스이고, 이 테스트가 그것을 확인한다.
    // 트랜잭션 안에서 감싸 롤백하는 방식으로는 이 경합을 재현할 수 없다 (스펙 §9.5).
    const repo = new PrismaAccountRepository(await testDb());
    const now = new Date('2026-03-01T10:00:00.000Z');

    const make = (suffix: string): Account => {
      const account = Account.register({
        id: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dcccc${suffix}`),
        email: Email.of('race@example.com'),
        credential: Credential.fromHash(`$argon2id$${suffix}`),
        now,
      });
      account.pullEvents();
      return account;
    };

    const results = await Promise.allSettled([repo.save(make('0001')), repo.save(make('0002'))]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 500이 아니라 409로 나가야 한다.
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });
});
```

Run: `pnpm test:int apps/api/src/modules/identity/adapters/out/persistence/prisma-account.repository.integration.spec.ts`
Expected: PASS

- [ ] **Step 8: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 계약 테스트가 매퍼의 컬럼 누락을 잡는가**
`session.mapper.ts`의 `toSessionDomain`에서 `revokedAt: row.revokedAt`을 `revokedAt: null`로 바꾼다.
Run: `pnpm test:int apps/api/src/modules/identity` **와** `pnpm vitest run --project api-unit apps/api/src/modules/identity/testing`
Expected: 통합(Prisma)에서 `'폐기된 세션은 복원해도 폐기 상태다'`가 실패하고, **단위(in-memory)에서는 전부 통과한다.** 이것이 계약 테스트를 양쪽에 돌리는 이유다 — fake만 봤다면 이 버그는 운영까지 갔다.
되돌린다.

**(b) P2002 번역이 실제로 있는가**
`prisma-account.repository.ts`의 `catch` 블록을 `throw error;`만 남기고 지운다.
Expected: FAIL — `'다른 계정이 같은 이메일을 쓰면 EmailAlreadyRegisteredError를 던진다'`(계약)와 `'같은 이메일로 동시에 두 계정을 저장하면 정확히 하나만 성공한다'`가 실패한다.
되돌린다.

**(c) M7의 `fromPersistence`가 매퍼에서 실제로 쓰이는가**
`account.mapper.ts`의 `AccountId.fromPersistence(row.id)`를 `AccountId.of(row.id)`로 바꾼다.
Run: `pnpm vitest run --project api-unit apps/api/src/modules/identity/adapters`
Expected: FAIL — `'깨진 UUID를 만나면 CorruptedRecordError를 던진다'`가 실패한다.
되돌린다.

- [ ] **Step 9: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/identity apps/api/prisma/schema.prisma
git commit -m "feat(identity): Prisma 리포지토리 2종을 추가하고 계약 테스트를 fake와 실물 양쪽에 돌린다"
```

---

### Task 12: Customer 도메인 — `AddressDetails` / `SavedAddress` / `AddressBook` / `Customer`

**Files:**
- Create: `apps/api/src/modules/customer/domain/customer.errors.ts`
- Create: `apps/api/src/modules/customer/domain/address-details.ts` + spec
- Create: `apps/api/src/modules/customer/domain/saved-address.ts`
- Create: `apps/api/src/modules/customer/domain/address-book.ts` + spec
- Create: `apps/api/src/modules/customer/domain/customer.ts` + spec

**Interfaces:**
- Consumes: `DomainError`, `AccountId`/`AddressId`/`CustomerId` (`shared/kernel/identifiers.ts`)
- Produces:
  - `AddressDetails.of({ label, recipient, phone, zip, line1, line2? }): AddressDetails`, `details.equals(other)`
  - `SavedAddress { id: AddressId; details: AddressDetails; isDefault: boolean }`
  - `AddressBook.empty()`, `AddressBook.rehydrate(items)`, `book.all`, `book.defaultAddress`, `book.add(id, details)`, `book.update(id, details)`, `book.remove(id)`, `book.setDefault(id)`
  - `Customer.register({ id, accountId, now })`, `Customer.rehydrate({ id, accountId, createdAt, addresses })`, `customer.addressBook`, `customer.addAddress(id, details)`, `customer.updateAddress(id, details)`, `customer.removeAddress(id)`, `customer.setDefaultAddress(id)`
  - `AddressNotFoundError` (`CODE = 'ADDRESS_NOT_FOUND'`), `InvalidAddressError` (`CODE = 'INVALID_ADDRESS'`), `CorruptedAddressBookError` (일반 `Error`)

**설계 결정 (`Customer`는 `AggregateRoot`를 상속하지 않는다):** 주소록 변경을 구독하는 컨텍스트가 없다. 이벤트를 발행하지 않는데 `AggregateRoot`를 상속하면 리포지토리가 매번 빈 `pullEvents()`를 부르는 죽은 배관만 남는다. 스펙 §5.6의 이벤트 목록에도 customer 발행 이벤트가 없다. 필요해지는 시점에 상속을 추가한다.

**설계 결정 (소유권 검사는 도메인이 한다):** 다른 고객의 주소 ID로 수정·삭제를 시도하면 `AddressNotFoundError`(404)가 난다. 403이 아닌 이유는 "그 ID는 존재한다"는 사실을 흘리지 않기 위해서다. 그리고 이 검사가 어댑터 가드가 아니라 도메인에 있는 이유는 스펙 §5.5 그대로다 — 가드에 두면 HTTP가 아닌 경로(배치, 관리자 CLI)로 들어올 때 규칙이 통째로 사라진다. `AddressBook`이 `Customer` 애그리거트 **안**에 있으므로 소유권은 구조적으로 보장된다.

- [ ] **Step 1: `AddressDetails`의 실패 테스트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { AddressDetails } from './address-details';
import { InvalidAddressError } from './customer.errors';

const VALID = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '101동 1001호',
};

describe('AddressDetails', () => {
  it('정상 입력을 만든다', () => {
    const details = AddressDetails.of(VALID);
    expect(details.recipient).toBe('홍길동');
    expect(details.line2).toBe('101동 1001호');
  });

  it('line2를 생략하면 null이 된다', () => {
    const { line2: _omitted, ...rest } = VALID;
    expect(AddressDetails.of(rest).line2).toBeNull();
  });

  it('빈 line2도 null로 정규화한다', () => {
    // ''와 null이 섞이면 "같은 주소인가" 비교가 조용히 어긋난다.
    expect(AddressDetails.of({ ...VALID, line2: '' }).line2).toBeNull();
    expect(AddressDetails.of({ ...VALID, line2: '   ' }).line2).toBeNull();
  });

  it('필수 항목의 앞뒤 공백을 제거한다', () => {
    expect(AddressDetails.of({ ...VALID, recipient: '  홍길동  ' }).recipient).toBe('홍길동');
  });

  it.each(['label', 'recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 비어 있으면 거부한다',
    (field) => {
      expect(() => AddressDetails.of({ ...VALID, [field]: '' })).toThrow(InvalidAddressError);
    },
  );

  it.each(['label', 'recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 공백뿐이면 거부한다',
    (field) => {
      expect(() => AddressDetails.of({ ...VALID, [field]: '   ' })).toThrow(InvalidAddressError);
    },
  );

  it('실패는 DomainError다', () => {
    expect(() => AddressDetails.of({ ...VALID, zip: '' })).toThrow(DomainError);
  });

  it('모든 필드가 같으면 equals가 참이다', () => {
    expect(AddressDetails.of(VALID).equals(AddressDetails.of(VALID))).toBe(true);
  });

  it('한 필드라도 다르면 equals가 거짓이다', () => {
    expect(AddressDetails.of(VALID).equals(AddressDetails.of({ ...VALID, zip: '00000' }))).toBe(
      false,
    );
  });

  it('line2가 null인 것과 값이 있는 것은 다르다', () => {
    const { line2: _omitted, ...rest } = VALID;
    expect(AddressDetails.of(VALID).equals(AddressDetails.of(rest))).toBe(false);
  });
});
```

- [ ] **Step 2: `customer.errors.ts`와 `address-details.ts`를 구현한다**

`customer.errors.ts`:

```ts
import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 주소 항목이 비어 있다. 어댑터의 Zod도 같은 것을 보지만(스펙 §8.4의 형식 검증),
 * 여기 한 벌 더 있는 이유는 HTTP가 아닌 경로로 들어올 때도 배송 불가능한 주소가
 * 저장되지 않게 하기 위해서다.
 */
export class InvalidAddressError extends DomainError {
  static readonly CODE = 'INVALID_ADDRESS';
  readonly code = InvalidAddressError.CODE;

  constructor(field: string) {
    super(`주소의 ${field}은(는) 비어 있을 수 없습니다.`);
  }
}

/**
 * 주소록에 그 ID가 없다. **다른 고객의 주소 ID를 넣었을 때도 이것이 난다** —
 * 403이 아닌 이유는 "그 ID는 존재하지만 당신 것이 아니다"라는 사실 자체를 흘리지
 * 않기 위해서다.
 */
export class AddressNotFoundError extends DomainError {
  static readonly CODE = 'ADDRESS_NOT_FOUND';
  readonly code = AddressNotFoundError.CODE;

  constructor(addressId: string) {
    super(`주소를 찾을 수 없습니다: ${addressId}`);
  }
}

/**
 * 저장된 주소록이 불변식을 어긴 상태다(기본 배송지가 둘 이상). 부분 유니크 인덱스가
 * 막고 있으므로 정상 경로로는 발생할 수 없다 — 발생했다면 인덱스가 사라졌거나 데이터가
 * 수동으로 손상된 것이다. `DomainError`가 아니므로 500으로 떨어진다.
 */
export class CorruptedAddressBookError extends Error {
  constructor(customerId: string, defaultCount: number) {
    super(`고객 ${customerId}의 기본 배송지가 ${defaultCount}개입니다.`);
    this.name = 'CorruptedAddressBookError';
  }
}
```

`address-details.ts`:

```ts
import { InvalidAddressError } from './customer.errors';

export interface AddressDetailsInput {
  readonly label: string;
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2?: string | null;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidAddressError(field);
  }
  return trimmed;
}

/**
 * 주소 상세 VO. **id가 없다** — 같은 내용의 주소 둘은 같은 값이다.
 *
 * 주문의 `ShippingAddress`(계획 4)는 이 타입을 재사용하지 않고 자기 것을 따로 갖는다.
 * 스펙 §5.3의 스냅샷 규칙: 경계를 넘을 때는 값만 복사하고 모델은 넘기지 않는다.
 */
export class AddressDetails {
  private constructor(
    readonly label: string,
    readonly recipient: string,
    readonly phone: string,
    readonly zip: string,
    readonly line1: string,
    readonly line2: string | null,
  ) {}

  static of(input: AddressDetailsInput): AddressDetails {
    const line2 = input.line2?.trim() ?? '';
    return new AddressDetails(
      required(input.label, '라벨'),
      required(input.recipient, '수취인'),
      required(input.phone, '연락처'),
      required(input.zip, '우편번호'),
      required(input.line1, '주소'),
      // ''와 null이 섞이면 "같은 주소인가" 비교가 조용히 어긋난다. 하나로 모은다.
      line2.length === 0 ? null : line2,
    );
  }

  equals(other: AddressDetails): boolean {
    return (
      this.label === other.label &&
      this.recipient === other.recipient &&
      this.phone === other.phone &&
      this.zip === other.zip &&
      this.line1 === other.line1 &&
      this.line2 === other.line2
    );
  }
}
```

- [ ] **Step 3: `AddressBook`의 실패 테스트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { AddressId } from '../../../shared/kernel/identifiers';
import { AddressBook } from './address-book';
import { AddressDetails } from './address-details';
import { AddressNotFoundError, CorruptedAddressBookError } from './customer.errors';
import { SavedAddress } from './saved-address';

const ID_A = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0001');
const ID_B = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0002');
const ID_C = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0003');
const MISSING = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa9999');

function details(label: string): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
  });
}

describe('AddressBook.add', () => {
  it('첫 주소는 자동으로 기본 배송지가 된다', () => {
    // 주소가 하나뿐인데 기본이 없으면 주문 화면에서 배송지를 고르는 단계가 무의미해진다.
    const book = AddressBook.empty();
    const added = book.add(ID_A, details('집'));
    expect(added.isDefault).toBe(true);
    expect(book.defaultAddress?.id).toBe(ID_A);
  });

  it('두 번째 주소는 기본이 되지 않는다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    const second = book.add(ID_B, details('회사'));
    expect(second.isDefault).toBe(false);
    expect(book.defaultAddress?.id).toBe(ID_A);
  });

  it('기본 배송지가 목록의 맨 앞에 온다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.setDefault(ID_B);
    expect(book.all.map((a) => a.id)).toEqual([ID_B, ID_A]);
  });
});

describe('AddressBook.setDefault', () => {
  it('이전 기본을 해제하고 새 기본을 세운다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));

    book.setDefault(ID_B);

    expect(book.all.filter((a) => a.isDefault)).toHaveLength(1);
    expect(book.defaultAddress?.id).toBe(ID_B);
  });

  it('이미 기본인 주소를 다시 지정해도 기본이 하나다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.setDefault(ID_A);
    expect(book.all.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    expect(() => book.setDefault(MISSING)).toThrow(AddressNotFoundError);
  });

  it('실패해도 기존 기본이 유지된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    expect(() => book.setDefault(MISSING)).toThrow();
    expect(book.defaultAddress?.id).toBe(ID_A);
  });
});

describe('AddressBook.update', () => {
  it('내용을 바꾸되 기본 여부는 유지한다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    const updated = book.update(ID_A, details('본가'));
    expect(updated.details.label).toBe('본가');
    expect(updated.isDefault).toBe(true);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    expect(() => AddressBook.empty().update(MISSING, details('집'))).toThrow(AddressNotFoundError);
  });
});

describe('AddressBook.remove', () => {
  it('주소를 지운다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.remove(ID_B);
    expect(book.all.map((a) => a.id)).toEqual([ID_A]);
  });

  it('기본 배송지를 지우면 기본이 없어진다', () => {
    // 남은 주소 중 하나를 자동 승격시키지 않는다. "어느 것을 골랐는지"는 사용자의
    // 결정이고, 시스템이 임의로 고르면 다음 주문이 엉뚱한 곳으로 간다.
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.remove(ID_A);
    expect(book.defaultAddress).toBeNull();
    expect(book.all).toHaveLength(1);
  });

  it('마지막 주소를 지우면 빈 주소록이 된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.remove(ID_A);
    expect(book.all).toEqual([]);
    expect(book.defaultAddress).toBeNull();
  });

  it('지운 뒤 새로 넣은 주소는 다시 자동 기본이 된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.remove(ID_A);
    expect(book.add(ID_B, details('회사')).isDefault).toBe(true);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    expect(() => AddressBook.empty().remove(MISSING)).toThrow(AddressNotFoundError);
  });
});

describe('AddressBook.rehydrate', () => {
  it('저장된 항목을 복원한다', () => {
    const book = AddressBook.rehydrate('cust-1', [
      new SavedAddress(ID_A, details('집'), false),
      new SavedAddress(ID_B, details('회사'), true),
    ]);
    expect(book.defaultAddress?.id).toBe(ID_B);
    expect(book.all).toHaveLength(2);
  });

  it('기본이 둘 이상이면 CorruptedAddressBookError다', () => {
    // 부분 유니크 인덱스가 막고 있으므로 정상 경로로는 불가능하다. 인덱스가 사라졌을 때
    // 조용히 굴러가지 않게 한다.
    expect(() =>
      AddressBook.rehydrate('cust-1', [
        new SavedAddress(ID_A, details('집'), true),
        new SavedAddress(ID_B, details('회사'), true),
      ]),
    ).toThrow(CorruptedAddressBookError);
  });

  it('기본이 없는 주소록도 유효하다', () => {
    const book = AddressBook.rehydrate('cust-1', [new SavedAddress(ID_C, details('집'), false)]);
    expect(book.defaultAddress).toBeNull();
  });

  it('빈 주소록도 유효하다', () => {
    expect(AddressBook.rehydrate('cust-1', []).all).toEqual([]);
  });
});
```

- [ ] **Step 4: `saved-address.ts`와 `address-book.ts`를 구현한다**

`saved-address.ts`:

```ts
import type { AddressId } from '../../../shared/kernel/identifiers';
import type { AddressDetails } from './address-details';

/**
 * 주소록 항목. **엔티티다** — 내용이 같아도 ID가 다르면 다른 주소다(집 주소를 두 개
 * 등록해 라벨만 다르게 쓰는 경우가 실제로 있다).
 *
 * 상태를 바꾸는 메서드는 `AddressBook`만 부른다. `Customer` 애그리거트 밖에서는
 * 읽기만 한다 — 밖에서 `markDefault()`를 부를 수 있으면 "기본은 0 또는 1개"
 * 불변식을 지킬 주인이 없어진다.
 */
export class SavedAddress {
  constructor(
    readonly id: AddressId,
    private detailsValue: AddressDetails,
    private defaultFlag: boolean,
  ) {}

  get details(): AddressDetails {
    return this.detailsValue;
  }

  get isDefault(): boolean {
    return this.defaultFlag;
  }

  /** @internal AddressBook 전용 */
  changeDetails(next: AddressDetails): void {
    this.detailsValue = next;
  }

  /** @internal AddressBook 전용 */
  setDefaultFlag(value: boolean): void {
    this.defaultFlag = value;
  }
}
```

`address-book.ts`:

```ts
import type { AddressId } from '../../../shared/kernel/identifiers';
import type { AddressDetails } from './address-details';
import { AddressNotFoundError, CorruptedAddressBookError } from './customer.errors';
import { SavedAddress } from './saved-address';

/**
 * 주소록. `Customer` 애그리거트 **안**의 내부 엔티티다.
 *
 * 불변식: **기본 배송지는 0개 또는 1개.** 이 규칙을 여기 두는 이유는, 규칙을 지키려면
 * 목록 전체를 봐야 하기 때문이다 — `SavedAddress` 하나만으로는 "다른 것이 이미 기본인가"를
 * 알 수 없다. 애그리거트 경계가 여기 그어지는 이유가 정확히 그것이다.
 *
 * DB의 부분 유니크 인덱스가 같은 규칙을 한 번 더 강제한다. 도메인만으로는 두 요청이
 * 동시에 서로 다른 주소를 기본으로 지정하는 경합을 막을 수 없다.
 */
export class AddressBook {
  private constructor(private readonly items: SavedAddress[]) {}

  static empty(): AddressBook {
    return new AddressBook([]);
  }

  static rehydrate(customerId: string, items: SavedAddress[]): AddressBook {
    const defaults = items.filter((item) => item.isDefault).length;
    if (defaults > 1) {
      throw new CorruptedAddressBookError(customerId, defaults);
    }
    return new AddressBook([...items]);
  }

  /** 기본 배송지가 맨 앞에 온다. 화면이 정렬을 다시 하지 않아도 되게 한다. */
  get all(): readonly SavedAddress[] {
    return [...this.items].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  get defaultAddress(): SavedAddress | null {
    return this.items.find((item) => item.isDefault) ?? null;
  }

  add(id: AddressId, details: AddressDetails): SavedAddress {
    // 첫 주소는 자동으로 기본이 된다. 주소가 하나뿐인데 기본이 없으면 주문 화면의
    // 배송지 선택 단계가 무의미해진다.
    const address = new SavedAddress(id, details, this.items.length === 0);
    this.items.push(address);
    return address;
  }

  update(id: AddressId, details: AddressDetails): SavedAddress {
    const address = this.require(id);
    address.changeDetails(details);
    return address;
  }

  remove(id: AddressId): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new AddressNotFoundError(id);
    }
    // 남은 주소 중 하나를 자동 승격시키지 않는다. 어디로 배송할지는 사용자의 결정이고,
    // 시스템이 임의로 고르면 다음 주문이 엉뚱한 곳으로 간다.
    this.items.splice(index, 1);
  }

  setDefault(id: AddressId): void {
    // 찾기를 먼저 한다. 없는 ID로 호출했을 때 기존 기본이 이미 해제된 상태가 되면 안 된다.
    const target = this.require(id);
    for (const item of this.items) {
      item.setDefaultFlag(item === target);
    }
  }

  private require(id: AddressId): SavedAddress {
    const found = this.items.find((item) => item.id === id);
    if (found === undefined) {
      throw new AddressNotFoundError(id);
    }
    return found;
  }
}
```

- [ ] **Step 5: `Customer`의 실패 테스트와 구현**

`customer.spec.ts`는 위임이 실제로 이뤄지는지와 생성 시각을 확인한다.

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import { AddressDetails } from './address-details';
import { AddressNotFoundError } from './customer.errors';
import { Customer } from './customer';
import { SavedAddress } from './saved-address';

const CUSTOMER_ID = CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0001');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0002');
const ADDRESS_ID = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0003');
const OTHER_ADDRESS_ID = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0004');
const NOW = new Date('2026-03-01T10:00:00.000Z');

function details(label = '집'): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
  });
}

describe('Customer', () => {
  it('빈 주소록으로 만들어진다', () => {
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });
    expect(customer.createdAt).toEqual(NOW);
    expect(customer.addressBook.all).toEqual([]);
  });

  it('주소 추가·수정·기본 지정·삭제를 주소록에 위임한다', () => {
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });

    const added = customer.addAddress(ADDRESS_ID, details());
    expect(added.isDefault).toBe(true);

    customer.addAddress(OTHER_ADDRESS_ID, details('회사'));
    customer.setDefaultAddress(OTHER_ADDRESS_ID);
    expect(customer.addressBook.defaultAddress?.id).toBe(OTHER_ADDRESS_ID);

    customer.updateAddress(ADDRESS_ID, details('본가'));
    expect(customer.addressBook.all.find((a) => a.id === ADDRESS_ID)?.details.label).toBe('본가');

    customer.removeAddress(ADDRESS_ID);
    expect(customer.addressBook.all).toHaveLength(1);
  });

  it('다른 고객의 주소 ID로는 아무것도 할 수 없다', () => {
    // 소유권 검사가 구조적으로 보장된다 — 주소록이 애그리거트 안에 있으므로
    // 다른 고객의 ID는 애초에 이 목록에 없다.
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });
    customer.addAddress(ADDRESS_ID, details());

    expect(() => customer.updateAddress(OTHER_ADDRESS_ID, details())).toThrow(AddressNotFoundError);
    expect(() => customer.removeAddress(OTHER_ADDRESS_ID)).toThrow(AddressNotFoundError);
    expect(() => customer.setDefaultAddress(OTHER_ADDRESS_ID)).toThrow(AddressNotFoundError);
  });

  it('저장된 주소와 함께 복원된다', () => {
    const customer = Customer.rehydrate({
      id: CUSTOMER_ID,
      accountId: ACCOUNT_ID,
      createdAt: NOW,
      addresses: [new SavedAddress(ADDRESS_ID, details(), true)],
    });
    expect(customer.addressBook.defaultAddress?.id).toBe(ADDRESS_ID);
  });
});
```

`customer.ts`:

```ts
import type { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import { AddressBook } from './address-book';
import type { AddressDetails } from './address-details';
import type { SavedAddress } from './saved-address';

/**
 * 고객 애그리거트 루트.
 *
 * `AggregateRoot`를 상속하지 않는다 — 주소록 변경을 구독하는 컨텍스트가 없고
 * (스펙 §5.6의 이벤트 목록에 customer 발행 이벤트가 없다), 상속만 해두면 리포지토리가
 * 매번 빈 `pullEvents()`를 부르는 죽은 배관이 남는다. 필요해지면 그때 붙인다.
 *
 * 계정과 1:1이지만 `Account`를 참조로 들지 않고 `accountId`만 갖는다 (스펙 §5.1).
 */
export class Customer {
  private constructor(
    readonly id: CustomerId,
    readonly accountId: AccountId,
    readonly createdAt: Date,
    private readonly book: AddressBook,
  ) {}

  static register(params: { id: CustomerId; accountId: AccountId; now: Date }): Customer {
    return new Customer(params.id, params.accountId, params.now, AddressBook.empty());
  }

  static rehydrate(params: {
    id: CustomerId;
    accountId: AccountId;
    createdAt: Date;
    addresses: SavedAddress[];
  }): Customer {
    return new Customer(
      params.id,
      params.accountId,
      params.createdAt,
      AddressBook.rehydrate(params.id, params.addresses),
    );
  }

  get addressBook(): AddressBook {
    return this.book;
  }

  addAddress(id: AddressId, details: AddressDetails): SavedAddress {
    return this.book.add(id, details);
  }

  updateAddress(id: AddressId, details: AddressDetails): SavedAddress {
    return this.book.update(id, details);
  }

  removeAddress(id: AddressId): void {
    this.book.remove(id);
  }

  setDefaultAddress(id: AddressId): void {
    this.book.setDefault(id);
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/customer/`
Expected: PASS

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 기본 배송지 0~1개 불변식이 실제로 지켜지는가**
`AddressBook.setDefault`의 루프에서 `item.setDefaultFlag(item === target)`을 `if (item === target) item.setDefaultFlag(true)`로 바꾼다(이전 기본을 해제하지 않는다).
Expected: FAIL — `'이전 기본을 해제하고 새 기본을 세운다'`가 `filter(isDefault)`의 길이가 2라며 실패한다.
되돌린다.

**(b) 실패한 setDefault가 상태를 바꾸지 않는가**
`setDefault`에서 `const target = this.require(id);`를 루프 **뒤로** 옮긴다(먼저 전부 해제한 뒤 찾는다).
Expected: FAIL — `'실패해도 기존 기본이 유지된다'`가 실패한다.
되돌린다.

**(c) 첫 주소 자동 기본이 실제로 조건부인가**
`add`의 `this.items.length === 0`을 `true`로 바꾼다.
Expected: FAIL — `'두 번째 주소는 기본이 되지 않는다'`가 실패한다. 이 회귀는 DB의 부분 유니크 인덱스에도 걸려 두 번째 주소 저장 자체가 실패하게 만든다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/customer
git commit -m "feat(customer): Customer 애그리거트와 주소록 불변식을 추가한다"
```

---

### Task 13: Customer 애플리케이션 — 포트, 유스케이스 5종, fake

**Files:**
- Create: `apps/api/src/modules/customer/application/ports/out/customer.repository.ts`
- Create: `apps/api/src/modules/customer/application/ports/out/address.query.ts`
- Create: `apps/api/src/modules/customer/application/ports/in/provision-customer.usecase.ts`
- Create: `apps/api/src/modules/customer/application/ports/in/manage-addresses.usecase.ts`
- Create: `apps/api/src/modules/customer/application/ports/in/queries/get-address-book.query.ts`
- Create: `apps/api/src/modules/customer/application/services/provision-customer.service.ts` + spec
- Create: `apps/api/src/modules/customer/application/services/manage-addresses.service.ts` + spec
- Create: `apps/api/src/modules/customer/application/services/get-address-book.service.ts` + spec
- Create: `apps/api/src/modules/customer/testing/{in-memory-customer.repository.ts, in-memory-address.query.ts, customer-repository.contract.ts, in-memory-customer.repository.spec.ts, customer.fixtures.ts}`

**Interfaces:**
- Produces:
  - `CustomerRepository { findById(id, tx?); findByAccountId(accountId, tx?); save(customer, tx?) }`, `CUSTOMER_REPOSITORY`
  - `AddressQuery { listByCustomer(customerId): Promise<AddressView[]> }`, `ADDRESS_QUERY`
  - `AddressView { id: string; label; recipient; phone; zip; line1; line2: string | null; isDefault: boolean }`
  - `ProvisionCustomerUseCase { execute(command: { accountId: AccountId; tx: TransactionContext }): Promise<CustomerId> }`, `PROVISION_CUSTOMER_USECASE`
  - `ManageAddressesUseCase { add(...); update(...); remove(...); setDefault(...) }`, `MANAGE_ADDRESSES_USECASE`
  - `GetAddressBookQuery { execute(command: { customerId: CustomerId }): Promise<AddressView[]> }`, `GET_ADDRESS_BOOK_QUERY`
  - `CustomerNotFoundError` (일반 `Error` — 500)

**설계 결정 (주소 유스케이스 네 개를 한 포트에 묶는다):** 스펙 §7.6은 `AddAddress`/`UpdateAddress`/`DeleteAddress`/`SetDefaultAddress`를 나열한다. 넷 모두 **같은 애그리거트를 불러 한 메서드를 부르고 저장하는 다섯 줄**이고, 의존성 집합도 완전히 같다. 인터페이스를 넷으로 쪼개면 Nest 프로바이더 넷, 팩토리 넷, 주입 넷이 늘어나면서 얻는 게 없다. 하나의 `ManageAddressesUseCase`에 네 메서드를 둔다. 인바운드 어댑터에서는 여전히 네 엔드포인트다.

**설계 결정 (`AddressView`를 애플리케이션이 소유한다):** 스펙 §7.2의 조회 포트는 DTO를 직접 돌려준다. 다만 그 DTO를 `@commerce/contracts`에서 가져오면 애플리케이션 계층이 와이어 계약에 묶인다 — 계약이 바뀔 때마다 유스케이스가 깨진다. 포트가 자기 읽기 모델(`AddressView`)을 정의하고, 컨트롤러가 `AddressDto`로 옮긴다. 모양이 같아 매핑은 한 줄이지만, 계약이 갈라지는 순간 그 한 줄만 바뀐다.

- [ ] **Step 1: 포트를 만든다**

`customer.repository.ts`:

```ts
import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Customer } from '../../../domain/customer';

/**
 * `save`는 주소록 전체를 함께 저장한다 — `SavedAddress`는 애그리거트 **안**이라
 * 따로 저장할 방법이 없어야 한다. 어댑터가 삭제된 주소의 행을 지우는 것까지 책임진다.
 */
export interface CustomerRepository {
  findById(id: CustomerId, tx?: TransactionContext): Promise<Customer | null>;
  findByAccountId(accountId: AccountId, tx?: TransactionContext): Promise<Customer | null>;
  save(customer: Customer, tx?: TransactionContext): Promise<void>;
}

export const CUSTOMER_REPOSITORY = Symbol('CustomerRepository');
```

`address.query.ts`:

```ts
import type { CustomerId } from '../../../../../shared/kernel/identifiers';

/**
 * 읽기 전용 모델. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다 (스펙 §7.2).
 *
 * `@commerce/contracts`의 `AddressDto`를 쓰지 않는 이유는 애플리케이션 계층이 와이어
 * 계약에 묶이지 않기 위해서다. 모양이 같아 컨트롤러의 매핑은 한 줄이고, 계약이
 * 갈라지는 순간 그 한 줄만 바뀐다.
 */
export interface AddressView {
  readonly id: string;
  readonly label: string;
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly isDefault: boolean;
}

export interface AddressQuery {
  /** 기본 배송지가 맨 앞에 온다. */
  listByCustomer(customerId: CustomerId): Promise<AddressView[]>;
}

export const ADDRESS_QUERY = Symbol('AddressQuery');
```

`provision-customer.usecase.ts`:

```ts
import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';

export interface ProvisionCustomerCommand {
  readonly accountId: AccountId;
  /**
   * 호출자(identity의 가입 유스케이스)가 연 트랜잭션. 필수다 — 계정과 고객이 갈라져
   * 커밋되면 로그인은 되는데 주소를 하나도 추가할 수 없는 사용자가 생긴다.
   */
  readonly tx: TransactionContext;
}

/** 멱등하다. 이미 고객이 있으면 그 ID를 돌려준다. */
export interface ProvisionCustomerUseCase {
  execute(command: ProvisionCustomerCommand): Promise<CustomerId>;
}

export const PROVISION_CUSTOMER_USECASE = Symbol('ProvisionCustomerUseCase');
```

`manage-addresses.usecase.ts`:

```ts
import type { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AddressDetailsInput } from '../../../domain/address-details';
import type { AddressView } from '../out/address.query';

export interface AddAddressCommand {
  readonly customerId: CustomerId;
  readonly details: AddressDetailsInput;
}

export interface UpdateAddressCommand extends AddAddressCommand {
  readonly addressId: AddressId;
}

export interface AddressCommand {
  readonly customerId: CustomerId;
  readonly addressId: AddressId;
}

/**
 * 네 연산을 한 포트에 묶었다. 넷 모두 같은 애그리거트를 불러 한 메서드를 부르고
 * 저장하는 다섯 줄이고 의존성도 완전히 같다 — 인터페이스를 넷으로 쪼개면 Nest
 * 프로바이더·팩토리·주입만 넷씩 늘어난다. 인바운드 어댑터에서는 여전히 네 엔드포인트다.
 */
export interface ManageAddressesUseCase {
  add(command: AddAddressCommand): Promise<AddressView>;
  update(command: UpdateAddressCommand): Promise<AddressView>;
  remove(command: AddressCommand): Promise<void>;
  setDefault(command: AddressCommand): Promise<void>;
}

export const MANAGE_ADDRESSES_USECASE = Symbol('ManageAddressesUseCase');
```

`queries/get-address-book.query.ts`:

```ts
import type { CustomerId } from '../../../../../../shared/kernel/identifiers';
import type { AddressView } from '../../out/address.query';

export interface GetAddressBookCommand {
  readonly customerId: CustomerId;
}

export interface GetAddressBookQuery {
  execute(command: GetAddressBookCommand): Promise<AddressView[]>;
}

export const GET_ADDRESS_BOOK_QUERY = Symbol('GetAddressBookQuery');
```

- [ ] **Step 2: 계약 테스트와 in-memory 리포지토리의 실패 테스트를 쓴다**

`customer-repository.contract.ts`는 아래를 확인한다. 각 항목마다 왜 필요한지 주석을 남긴다.

```ts
import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import { AddressDetails } from '../domain/address-details';
import { Customer } from '../domain/customer';
import type { CustomerRepository } from '../application/ports/out/customer.repository';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function details(label: string): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
    line2: label === '집' ? '101동' : null,
  });
}

function aCustomer(suffix: string): Customer {
  return Customer.register({
    id: CustomerId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dcust${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dacct${suffix}`),
    now: NOW,
  });
}

export function customerRepositoryContract(
  name: string,
  createRepo: () => Promise<CustomerRepository>,
): void {
  describe(`CustomerRepository 계약 — ${name}`, () => {
    it('저장한 고객을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0001');
      await repo.save(customer);
      expect((await repo.findById(customer.id))?.accountId).toBe(customer.accountId);
    });

    it('계정 ID로도 찾는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0002');
      await repo.save(customer);
      expect((await repo.findByAccountId(customer.accountId))?.id).toBe(customer.id);
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dcust9999'))).toBeNull();
      expect(
        await repo.findByAccountId(AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dacct9999')),
      ).toBeNull();
    });

    it('주소록이 애그리거트와 함께 저장되고 복원된다', async () => {
      // SavedAddress는 애그리거트 안이다. 따로 저장할 방법이 없어야 한다.
      const repo = await createRepo();
      const customer = aCustomer('0003');
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10001'), details('집'));
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10002'), details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      expect(loaded?.addressBook.all).toHaveLength(2);
    });

    it('주소의 모든 필드가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0004');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd20001');
      customer.addAddress(addressId, details('집'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      const saved = loaded?.addressBook.all.find((a) => a.id === addressId);
      expect(saved?.details.equals(details('집'))).toBe(true);
    });

    it('line2가 null인 주소도 그대로 보존된다', async () => {
      // ''로 저장되면 도메인의 정규화(빈 문자열 → null)와 어긋나 equals가 깨진다.
      const repo = await createRepo();
      const customer = aCustomer('0005');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd30001');
      customer.addAddress(addressId, details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      expect(loaded?.addressBook.all.find((a) => a.id === addressId)?.details.line2).toBeNull();
    });

    it('기본 배송지 표시가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0006');
      const first = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd40001');
      const second = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd40002');
      customer.addAddress(first, details('집'));
      customer.addAddress(second, details('회사'));
      customer.setDefaultAddress(second);
      await repo.save(customer);

      expect((await repo.findById(customer.id))?.addressBook.defaultAddress?.id).toBe(second);
    });

    it('삭제된 주소는 다시 저장해도 되살아나지 않는다', async () => {
      // 어댑터가 upsert만 하고 삭제를 하지 않으면, 지운 주소가 다음 조회에서 되돌아온다.
      const repo = await createRepo();
      const customer = aCustomer('0007');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd50001');
      customer.addAddress(addressId, details('집'));
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd50002'), details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      loaded?.removeAddress(addressId);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(customer.id);
      expect(reloaded?.addressBook.all.map((a) => a.id)).not.toContain(addressId);
      expect(reloaded?.addressBook.all).toHaveLength(1);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0008');
      await repo.save(customer);

      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd60001'), details('집'));

      expect((await repo.findById(customer.id))?.addressBook.all).toEqual([]);
    });
  });
}
```

`in-memory-customer.repository.spec.ts`:

```ts
import { customerRepositoryContract } from './customer-repository.contract';
import { InMemoryCustomerRepository } from './in-memory-customer.repository';

customerRepositoryContract('in-memory', async () => new InMemoryCustomerRepository());
```

Run: `pnpm vitest run --project api-unit apps/api/src/modules/customer/testing`
Expected: FAIL — 클래스가 없다.

- [ ] **Step 3: fake를 구현한다**

`in-memory-customer.repository.ts`는 `Customer.rehydrate`로 깊은 복사를 한다 — `SavedAddress`도 새 인스턴스로 만들어야 한다(그렇지 않으면 `changeDetails`가 저장본까지 바꾼다).

```ts
import type { AccountId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CustomerRepository } from '../application/ports/out/customer.repository';
import { Customer } from '../domain/customer';
import { SavedAddress } from '../domain/saved-address';

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly byId = new Map<string, Customer>();

  async findById(id: CustomerId, _tx?: TransactionContext): Promise<Customer | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryCustomerRepository.copy(stored) : null;
  }

  async findByAccountId(
    accountId: AccountId,
    _tx?: TransactionContext,
  ): Promise<Customer | null> {
    for (const stored of this.byId.values()) {
      if (stored.accountId === accountId) {
        return InMemoryCustomerRepository.copy(stored);
      }
    }
    return null;
  }

  async save(customer: Customer, _tx?: TransactionContext): Promise<void> {
    this.byId.set(customer.id, InMemoryCustomerRepository.copy(customer));
  }

  private static copy(customer: Customer): Customer {
    return Customer.rehydrate({
      id: customer.id,
      accountId: customer.accountId,
      createdAt: new Date(customer.createdAt.getTime()),
      // SavedAddress도 새 인스턴스여야 한다. 같은 인스턴스를 공유하면 저장 뒤
      // changeDetails 한 번이 저장본까지 바꾼다.
      addresses: customer.addressBook.all.map(
        (address) => new SavedAddress(address.id, address.details, address.isDefault),
      ),
    });
  }
}
```

`in-memory-address.query.ts`는 리포지토리를 감싸 읽기 모델로 옮긴다.

```ts
import type { CustomerId } from '../../../shared/kernel/identifiers';
import type { AddressQuery, AddressView } from '../application/ports/out/address.query';
import type { CustomerRepository } from '../application/ports/out/customer.repository';

export class InMemoryAddressQuery implements AddressQuery {
  constructor(private readonly customers: CustomerRepository) {}

  async listByCustomer(customerId: CustomerId): Promise<AddressView[]> {
    const customer = await this.customers.findById(customerId);
    if (customer === null) {
      return [];
    }
    return customer.addressBook.all.map((address) => ({
      id: address.id,
      label: address.details.label,
      recipient: address.details.recipient,
      phone: address.details.phone,
      zip: address.details.zip,
      line1: address.details.line1,
      line2: address.details.line2,
      isDefault: address.isDefault,
    }));
  }
}
```

`customer.fixtures.ts`에는 `FIXED_NOW`와 주소 입력 리터럴을 모은다.

- [ ] **Step 4: 유스케이스를 구현한다**

`provision-customer.service.ts`:

```ts
import { type AccountId, CustomerId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import { Customer } from '../../domain/customer';
import type { CustomerRepository } from '../ports/out/customer.repository';
import type {
  ProvisionCustomerCommand,
  ProvisionCustomerUseCase,
} from '../ports/in/provision-customer.usecase';

export class ProvisionCustomerService implements ProvisionCustomerUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: ProvisionCustomerCommand): Promise<CustomerId> {
    // 멱등. 가입이 재시도되거나(네트워크 타임아웃 후) 나중에 관리자 도구가 같은 계정에
    // 고객을 만들려 해도 새 고객이 생기지 않는다. accounts.account_id의 unique 인덱스도
    // 같은 것을 강제하지만, 여기서 먼저 걸러야 좋은 결과(기존 ID)를 돌려줄 수 있다.
    const existing = await this.customers.findByAccountId(command.accountId, command.tx);
    if (existing !== null) {
      return existing.id;
    }

    const customer = Customer.register({
      id: CustomerId.of(this.ids.nextId()),
      accountId: command.accountId,
      now: this.clock.now(),
    });
    await this.customers.save(customer, command.tx);
    return customer.id;
  }
}
```

`manage-addresses.service.ts`는 네 메서드가 같은 골격을 쓴다.

```ts
import { AddressId, type CustomerId } from '../../../../shared/kernel/identifiers';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type {
  TransactionContext,
  TransactionManager,
} from '../../../../shared/kernel/ports/transaction-manager';
import { AddressDetails } from '../../domain/address-details';
import type { Customer } from '../../domain/customer';
import type { SavedAddress } from '../../domain/saved-address';
import type { AddressView } from '../ports/out/address.query';
import type { CustomerRepository } from '../ports/out/customer.repository';
import type {
  AddAddressCommand,
  AddressCommand,
  ManageAddressesUseCase,
  UpdateAddressCommand,
} from '../ports/in/manage-addresses.usecase';

/**
 * 토큰은 유효한데 고객 행이 없다. 가입이 계정과 고객을 한 트랜잭션에서 만들므로
 * 정상 경로로는 불가능하다 — 데이터가 깨진 것이다. `DomainError`가 아니므로 500이다.
 */
export class CustomerNotFoundError extends Error {
  constructor(customerId: string) {
    super(`고객을 찾을 수 없습니다: ${customerId}`);
    this.name = 'CustomerNotFoundError';
  }
}

export function toAddressView(address: SavedAddress): AddressView {
  return {
    id: address.id,
    label: address.details.label,
    recipient: address.details.recipient,
    phone: address.details.phone,
    zip: address.details.zip,
    line1: address.details.line1,
    line2: address.details.line2,
    isDefault: address.isDefault,
  };
}

export class ManageAddressesService implements ManageAddressesUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly transactions: TransactionManager,
    private readonly ids: IdGenerator,
  ) {}

  async add(command: AddAddressCommand): Promise<AddressView> {
    // 값 객체 생성이 트랜잭션 밖이다. 잘못된 주소로 트랜잭션을 열 이유가 없다.
    const details = AddressDetails.of(command.details);
    return this.mutate(command.customerId, (customer) =>
      customer.addAddress(AddressId.of(this.ids.nextId()), details),
    );
  }

  async update(command: UpdateAddressCommand): Promise<AddressView> {
    const details = AddressDetails.of(command.details);
    return this.mutate(command.customerId, (customer) =>
      customer.updateAddress(command.addressId, details),
    );
  }

  async remove(command: AddressCommand): Promise<void> {
    await this.mutate(command.customerId, (customer) => {
      customer.removeAddress(command.addressId);
      return null;
    });
  }

  async setDefault(command: AddressCommand): Promise<void> {
    await this.mutate(command.customerId, (customer) => {
      customer.setDefaultAddress(command.addressId);
      return null;
    });
  }

  /**
   * 불러오기 → 도메인 메서드 → 저장을 한 트랜잭션으로 묶는다. `setDefault`가 특히
   * 필요하다 — 이전 기본 해제와 새 기본 지정이 한 번에 커밋돼야 부분 유니크 인덱스를
   * 어기지 않는다.
   */
  private async mutate<T extends SavedAddress | null>(
    customerId: CustomerId,
    change: (customer: Customer, tx: TransactionContext) => T,
  ): Promise<T extends SavedAddress ? AddressView : void> {
    return this.transactions.run(async (tx) => {
      const customer = await this.customers.findById(customerId, tx);
      if (customer === null) {
        throw new CustomerNotFoundError(customerId);
      }
      const changed = change(customer, tx);
      await this.customers.save(customer, tx);
      return (changed === null ? undefined : toAddressView(changed)) as never;
    });
  }
}
```

> `mutate`의 조건부 반환 타입이 읽기 어려우면 `mutate`를 두 개로 나눈다(`mutateReturning`과 `mutateVoid`). 타입 곡예보다 두 메서드가 낫다 — 구현자가 판단한다.

`get-address-book.service.ts`:

```ts
import type { AddressQuery, AddressView } from '../ports/out/address.query';
import type {
  GetAddressBookCommand,
  GetAddressBookQuery,
} from '../ports/in/queries/get-address-book.query';

/**
 * 조회는 애그리거트를 거치지 않는다 (스펙 §7.2). `Customer`를 재구성하면 불변식 검증
 * 비용을 조회에까지 물리고, 화면에 필요 없는 것까지 로딩한다.
 */
export class GetAddressBookService implements GetAddressBookQuery {
  constructor(private readonly addresses: AddressQuery) {}

  async execute(command: GetAddressBookCommand): Promise<AddressView[]> {
    return this.addresses.listByCustomer(command.customerId);
  }
}
```

- [ ] **Step 5: 유스케이스 spec을 쓴다**

각 서비스마다 아래를 확인한다. 코드는 태스크 7·8의 spec과 같은 형태로 쓴다 — fake를 조립하는 `build()` 헬퍼, 시나리오별 `it`.

`provision-customer.service.spec.ts`:
- 새 고객을 만들고 ID를 돌려준다
- 같은 계정으로 두 번 부르면 같은 ID를 돌려주고 고객이 하나만 생긴다 (멱등)
- 생성 시각이 주입된 `Clock`의 값이다
- 전달받은 `tx`를 리포지토리에 그대로 넘긴다 (`InMemoryCustomerRepository`를 감싸 `save`가 받은 `tx`를 기록하는 지역 클래스로 확인한다)

`manage-addresses.service.spec.ts`:
- 주소를 추가하고 `AddressView`를 돌려준다. 첫 주소는 `isDefault: true`
- 두 번째 주소는 `isDefault: false`
- 수정이 내용을 바꾸고 기본 여부는 유지한다
- 삭제 후 조회하면 없다
- 기본 지정이 이전 기본을 해제한다 (저장본에서 확인 — 메모리 인스턴스가 아니라 리포지토리를 다시 읽는다)
- 다른 고객의 주소 ID로 수정하면 `AddressNotFoundError`다
- 없는 고객 ID면 `CustomerNotFoundError`다
- 빈 수취인으로 추가하면 `InvalidAddressError`이고 **고객은 저장되지 않는다**

`get-address-book.service.spec.ts`:
- 주소 목록을 돌려주고 기본 배송지가 맨 앞이다
- 주소가 없으면 빈 배열이다

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src/modules/customer/`
Expected: PASS

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 프로비저닝이 실제로 멱등한가**
`provision-customer.service.ts`의 `findByAccountId` 사전 조회 블록을 지운다.
Expected: FAIL — `'같은 계정으로 두 번 부르면 같은 ID를 돌려준다'`가 실패한다. 이 회귀는 계정 하나에 고객 둘을 만들고, `customers.account_id`의 unique 인덱스가 뒤늦게 500으로 터진다.
되돌린다.

**(b) 기본 지정이 트랜잭션으로 묶여 있는가**
`ManageAddressesService.mutate`의 `this.transactions.run(...)`을 걷어내고 본문을 직접 실행한다.
Expected: 단위 테스트는 `PassthroughTransactionManager`를 쓰므로 **전부 통과한다.** 이것이 단위 테스트의 한계다 — 그래서 태스크 16이 통합 테스트로 같은 성질을 한 번 더 본다. 이 사실을 확인하고 보고서에 적는다.
되돌린다.

**(c) fake의 깊은 복사가 주소까지 미치는가**
`InMemoryCustomerRepository.copy`의 `new SavedAddress(...)`를 `address`로 바꾼다(같은 인스턴스를 공유한다).
Expected: FAIL — 계약 테스트의 `'저장 후 원본을 변경해도 저장본은 바뀌지 않는다'`가 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/customer
git commit -m "feat(customer): 주소록 유스케이스와 계약 테스트를 통과하는 fake를 추가한다"
```

---

### Task 14: Customer 영속 어댑터 — Prisma 리포지토리와 조회

**Files:**
- Create: `apps/api/src/modules/customer/adapters/out/persistence/customer.mapper.ts` + spec
- Create: `apps/api/src/modules/customer/adapters/out/persistence/prisma-customer.repository.ts`
- Create: `apps/api/src/modules/customer/adapters/out/persistence/prisma-address.query.ts`
- Create: `apps/api/src/modules/customer/adapters/out/persistence/prisma-customer.repository.integration.spec.ts`
- Create: `apps/api/src/modules/customer/adapters/out/persistence/prisma-address.query.integration.spec.ts`

**Interfaces:**
- Consumes: `CustomerRepository`/`AddressQuery` 포트, `customerRepositoryContract` (태스크 13), `asPrismaClient`, `testDb()`
- Produces: `toCustomerDomain(row)`, `toSavedAddressRows(customer)`, `PrismaCustomerRepository`, `PrismaAddressQuery`

- [ ] **Step 1: 계약 테스트를 Prisma 위에 돌리는 통합 spec을 쓴다**

```ts
import { testDb } from '../../../../../../test/setup/database';
import { customerRepositoryContract } from '../../../testing/customer-repository.contract';
import { PrismaCustomerRepository } from './prisma-customer.repository';

customerRepositoryContract('prisma', async () => new PrismaCustomerRepository(await testDb()));
```

**주의:** 계약 테스트의 `aCustomer`는 `accounts` 행을 만들지 않는다. `customers.account_id`에는 외래 키가 없으므로(애그리거트 경계, 태스크 11 참고) 그대로 통과해야 한다. 통과하지 않는다면 스키마에 의도치 않은 FK가 들어간 것이므로 그 사실을 보고한다.

Run: `pnpm test:int apps/api/src/modules/customer`
Expected: FAIL — 클래스가 없다.

- [ ] **Step 2: 매퍼를 구현한다**

```ts
import { AccountId, AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import { AddressDetails } from '../../../domain/address-details';
import { Customer } from '../../../domain/customer';
import { SavedAddress } from '../../../domain/saved-address';

export interface SavedAddressRow {
  id: string;
  customerId: string;
  label: string;
  recipient: string;
  phone: string;
  zip: string;
  line1: string;
  line2: string | null;
  isDefault: boolean;
}

export interface CustomerRow {
  id: string;
  accountId: string;
  createdAt: Date;
  addresses: SavedAddressRow[];
}

/** M7: 영속 복원에는 `fromPersistence`를 쓴다. 깨진 행은 400이 아니라 500이다. */
export function toCustomerDomain(row: CustomerRow): Customer {
  return Customer.rehydrate({
    id: CustomerId.fromPersistence(row.id),
    accountId: AccountId.fromPersistence(row.accountId),
    createdAt: row.createdAt,
    addresses: row.addresses.map(
      (address) =>
        new SavedAddress(
          AddressId.fromPersistence(address.id),
          AddressDetails.of({
            label: address.label,
            recipient: address.recipient,
            phone: address.phone,
            zip: address.zip,
            line1: address.line1,
            line2: address.line2,
          }),
          address.isDefault,
        ),
    ),
  });
}

export function toSavedAddressRows(customer: Customer): SavedAddressRow[] {
  return customer.addressBook.all.map((address) => ({
    id: address.id,
    customerId: customer.id,
    label: address.details.label,
    recipient: address.details.recipient,
    phone: address.details.phone,
    zip: address.details.zip,
    line1: address.details.line1,
    line2: address.details.line2,
    isDefault: address.isDefault,
  }));
}
```

- [ ] **Step 3: `prisma-customer.repository.ts`를 구현한다**

```ts
import type { PrismaClient } from '@prisma/client';
import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { CustomerRepository } from '../../../application/ports/out/customer.repository';
import type { Customer } from '../../../domain/customer';
import { toCustomerDomain, toSavedAddressRows } from './customer.mapper';

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: CustomerId, tx?: TransactionContext): Promise<Customer | null> {
    const row = await this.client(tx).customer.findUnique({
      where: { id },
      include: { addresses: true },
    });
    return row === null ? null : toCustomerDomain(row);
  }

  async findByAccountId(
    accountId: AccountId,
    tx?: TransactionContext,
  ): Promise<Customer | null> {
    const row = await this.client(tx).customer.findUnique({
      where: { accountId },
      include: { addresses: true },
    });
    return row === null ? null : toCustomerDomain(row);
  }

  /**
   * 주소록 전체를 애그리거트와 함께 쓴다.
   *
   * **삭제가 핵심이다.** upsert만 하면 도메인에서 지운 주소가 DB에 남아 다음 조회에서
   * 되살아난다. "지금 애그리거트에 없는 행은 지운다"가 애그리거트를 저장한다는 말의
   * 실제 의미다.
   *
   * 삭제를 먼저 하고 upsert를 나중에 하는 순서도 의도적이다. 기본 배송지를 A에서 B로
   * 옮기면서 A를 지우는 경우, 순서가 반대면 A와 B가 동시에 is_default=true인 순간이
   * 생겨 부분 유니크 인덱스에 걸린다.
   */
  async save(customer: Customer, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const rows = toSavedAddressRows(customer);

    await client.customer.upsert({
      where: { id: customer.id },
      create: { id: customer.id, accountId: customer.accountId, createdAt: customer.createdAt },
      update: {},
    });

    await client.savedAddress.deleteMany({
      where: { customerId: customer.id, id: { notIn: rows.map((row) => row.id) } },
    });

    // 기본 해제를 먼저 반영해야 두 행이 동시에 is_default=true가 되는 순간이 없다.
    for (const row of rows.filter((row) => !row.isDefault)) {
      await client.savedAddress.upsert({ where: { id: row.id }, create: row, update: row });
    }
    for (const row of rows.filter((row) => row.isDefault)) {
      await client.savedAddress.upsert({ where: { id: row.id }, create: row, update: row });
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
```

> `deleteMany`의 `notIn`이 빈 배열이면 Prisma는 조건을 무시하지 않고 "아무것도 매치하지 않음"이 아니라 **전부 삭제**로 동작한다(주소가 하나도 없는 애그리거트를 저장하는 경우). 이것은 우리가 원하는 동작이다 — 마지막 주소를 지운 애그리거트를 저장하면 행도 전부 사라져야 한다. 계약 테스트의 `'삭제된 주소는 다시 저장해도 되살아나지 않는다'`와 `'저장 후 원본을 변경해도 저장본은 바뀌지 않는다'`가 두 경우를 모두 덮는다.

- [ ] **Step 4: `prisma-address.query.ts`를 구현한다**

```ts
import type { PrismaClient } from '@prisma/client';
import type { CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AddressQuery, AddressView } from '../../../application/ports/out/address.query';

/**
 * 조회 전용. 애그리거트를 만들지 않고 필요한 컬럼만 골라 읽기 모델로 바로 옮긴다
 * (스펙 §7.2). `Customer.rehydrate`를 거치지 않으므로 불변식 검증 비용도 없다.
 */
export class PrismaAddressQuery implements AddressQuery {
  constructor(private readonly prisma: PrismaClient) {}

  async listByCustomer(customerId: CustomerId): Promise<AddressView[]> {
    const rows = await this.prisma.savedAddress.findMany({
      where: { customerId },
      select: {
        id: true,
        label: true,
        recipient: true,
        phone: true,
        zip: true,
        line1: true,
        line2: true,
        isDefault: true,
      },
      // 기본 배송지가 맨 앞. 그 다음은 라벨 순으로 안정 정렬한다 — 정렬을 지정하지
      // 않으면 Postgres는 순서를 보장하지 않고, 화면의 목록이 새로고침마다 뒤바뀐다.
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    });
    return rows;
  }
}
```

- [ ] **Step 5: 조회 어댑터의 통합 spec을 쓴다**

`prisma-address.query.integration.spec.ts`는 아래를 확인한다.

- 고객의 주소를 모두 돌려준다
- 기본 배송지가 맨 앞에 온다
- 기본이 아닌 주소들이 라벨 순으로 안정적으로 정렬된다 (같은 데이터로 두 번 조회해 같은 순서인지 확인)
- 다른 고객의 주소는 섞이지 않는다
- 주소가 없으면 빈 배열
- `line2`가 `null`인 행이 `null`로 나온다

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm test:int apps/api/src/modules/customer`
Expected: PASS — 계약 9개 + 조회 6개.

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 삭제 동기화가 실제로 있는가**
`prisma-customer.repository.ts`의 `client.savedAddress.deleteMany({...})` 블록을 지운다.
Expected: FAIL — 계약의 `'삭제된 주소는 다시 저장해도 되살아나지 않는다'`가 Prisma 쪽에서만 실패하고 **in-memory 쪽은 통과한다.**
되돌린다.

**(b) 기본 해제 순서가 실제로 필요한가**
두 개의 `for` 루프를 하나로 합쳐 `rows` 순서대로 upsert한다.
Run: 계약 테스트를 여러 번 돌린다. `'기본 배송지 표시가 왕복해도 보존된다'`가 부분 유니크 인덱스 위반으로 실패하는지 확인한다.
**만약 통과한다면** — `all` getter가 기본을 맨 앞으로 정렬하므로 순서가 우연히 맞을 수 있다. 그 경우 계약 테스트에 "기본을 A→B로 옮긴 뒤 저장" 케이스를 추가해 실제로 실패하게 만든 다음, 그 테스트를 남긴다. 우연히 통과하는 코드를 그대로 두지 않는다.
되돌린다.

**(c) 조회 정렬이 실제로 지정돼 있는가**
`prisma-address.query.ts`의 `orderBy`를 지운다.
Expected: `'기본 배송지가 맨 앞에 온다'`가 실패하거나 불안정해진다. 불안정하기만 하고 실패하지 않으면 행을 20개로 늘려 다시 확인한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/modules/customer
git commit -m "feat(customer): Prisma 리포지토리와 주소 조회 어댑터를 추가한다"
```

---

### Task 15: 공유 인바운드 인프라 — 검증 파이프, 인증 가드, `@CurrentPrincipal`

**Files:**
- Create: `apps/api/src/shared/infrastructure/http/zod-validation.pipe.ts` + spec
- Create: `apps/api/src/shared/infrastructure/http/access-token.guard.ts` + `access-token.guard.spec.ts`
- Create: `apps/api/src/shared/infrastructure/http/current-principal.decorator.ts`
- Modify: `apps/api/src/shared/shared.module.ts`
- Modify: `apps/api/src/shared/infrastructure/http/kernel-domain-error-mappings.ts`
- Modify: `apps/api/src/app.module.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenVerifier`/`ACCESS_TOKEN_VERIFIER`/`Principal` (태스크 1), `JwtTokenService`/`readJwtConfig` (태스크 10), `UnauthenticatedError` (태스크 10), `DomainErrorRegistry`
- Produces:
  - `SchemaParser<T> { parse(input: unknown): T }`, `ZodValidationPipe<T>`, `ValidationFailedError` (`CODE = 'VALIDATION_FAILED'`)
  - `AccessTokenGuard` (Nest `CanActivate`) — 검증 성공 시 `request.principal`을 채운다
  - `CurrentPrincipal` 파라미터 데코레이터
  - `SharedModule`이 `ACCESS_TOKEN_VERIFIER`와 `JwtTokenService`를 export한다

- [ ] **Step 1: `ZodValidationPipe`의 실패 테스트를 쓴다**

```ts
import { describe, expect, it } from 'vitest';
import { signUpBodySchema } from '@commerce/contracts';
import { DomainError } from '../../kernel/domain-error';
import { ValidationFailedError, ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(signUpBodySchema);

  it('유효한 입력을 파싱해 돌려준다', () => {
    const body = { email: 'user@example.com', password: 'correct horse battery' };
    expect(pipe.transform(body)).toEqual(body);
  });

  it('스키마가 값을 정규화하면 정규화된 값이 나온다', () => {
    // 파이프가 입력을 그대로 반환하면(파싱 결과를 버리면) 이 단언이 깨진다.
    const strict = new ZodValidationPipe({
      parse: (input: unknown) => ({ normalized: String(input).trim() }),
    });
    expect(strict.transform('  x  ')).toEqual({ normalized: 'x' });
  });

  it('잘못된 입력은 ValidationFailedError다', () => {
    expect(() => pipe.transform({ email: 'nope', password: 'x' })).toThrow(ValidationFailedError);
  });

  it('실패는 DomainError라 예외 필터가 400으로 옮긴다', () => {
    expect(() => pipe.transform({})).toThrow(DomainError);
  });

  it('메시지에 어느 필드가 문제인지 담는다', () => {
    // "요청이 잘못됐습니다"만 돌려주면 클라이언트가 고칠 수 없다.
    const error = (() => {
      try {
        pipe.transform({ email: 'nope', password: 'x' });
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error?.message).toContain('email');
  });

  it('계약에 없는 필드가 있으면 거부한다', () => {
    expect(() =>
      pipe.transform({ email: 'a@b.com', password: 'x'.repeat(12), role: 'admin' }),
    ).toThrow(ValidationFailedError);
  });

  it('zod가 아닌 예외는 그대로 통과시킨다', () => {
    // 파싱 중 발생한 진짜 버그(TypeError 등)를 400으로 뭉개면 원인을 잃는다.
    const exploding = new ZodValidationPipe({
      parse: () => {
        throw new RangeError('내부 버그');
      },
    });
    expect(() => exploding.transform({})).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: `zod-validation.pipe.ts`를 구현한다**

```ts
import { Injectable, type PipeTransform } from '@nestjs/common';
import { DomainError } from '../../kernel/domain-error';

/**
 * 형식 검증 실패 (스펙 §8.4의 첫 번째 종류).
 *
 * `DomainError`를 상속하는 것은 배관이다 — 기존 예외 필터 하나가 모든 매핑을 담당하게
 * 하기 위해서다. 의미상 도메인 규칙 위반이 아니라는 점은 400 매핑이 표현한다.
 */
export class ValidationFailedError extends DomainError {
  static readonly CODE = 'VALIDATION_FAILED';
  readonly code = ValidationFailedError.CODE;

  constructor(message: string) {
    super(message);
  }
}

/**
 * 계약 스키마를 구조적 타입으로 받는다.
 *
 * `z.ZodType`을 쓰지 않는 이유: `apps/api`의 package.json에 `zod`가 없어 `'zod'`를
 * 값으로건 타입으로건 import하면 dependency-cruiser의 `not-to-unresolvable`에 걸린다.
 * 그리고 이 파이프가 실제로 필요로 하는 것은 `parse` 하나뿐이라, 구조적 타입이
 * 정확히 그만큼만 요구하는 더 정직한 시그니처이기도 하다.
 */
export interface SchemaParser<T> {
  parse(input: unknown): T;
}

interface ZodLikeIssue {
  path: Array<string | number>;
  message: string;
}

function formatIssues(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return null;
  }
  return (issues as ZodLikeIssue[])
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join(', ');
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: SchemaParser<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      const formatted = formatIssues(error);
      if (formatted === null) {
        // zod 오류가 아니다 — 파싱 중 발생한 진짜 버그다. 400으로 뭉개면 원인을 잃는다.
        throw error;
      }
      throw new ValidationFailedError(`요청 형식이 올바르지 않습니다 — ${formatted}`);
    }
  }
}
```

**계약 스키마를 값으로 import하는 것은 괜찮다.** spec 파일이 `signUpBodySchema`를 `@commerce/contracts`에서 가져오지만, `'zod'`를 직접 import하지는 않으므로 `not-to-unresolvable`에 걸리지 않는다. 타입 쪽도 문제없다 — contracts는 `main`이 소스(`./src/index.ts`)라 TypeScript가 그 파일을 직접 컴파일하고, 그 안의 `import { z } from 'zod'`는 `packages/contracts/node_modules/zod`로 해석된다. 만약 `arch:check`나 `typecheck`가 여기서 깨지면 `apps/api`에 zod를 추가하지 말고 **그 사실을 보고서에 적는다** — 계획 1이 `health.controller.ts`에서 `ReturnType<...['parse']>`로 우회한 것과 같은 종류의 함정이고, 우회 방식을 통일해야 한다.

`ValidationFailedError.CODE`를 `kernel-domain-error-mappings.ts`에 등록한다 — 400 / `ErrorCode.VALIDATION_FAILED`. `InvalidIdError`와 같은 매핑이지만 **코드가 다르므로 별도 등록이 필요하다.** 등록을 빼먹으면 422로 조용히 떨어진다.

- [ ] **Step 3: 가드와 데코레이터의 실패 테스트를 쓴다**

```ts
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { AccessTokenVerifier, Principal } from '../../kernel/ports/access-token-verifier';
import { AccessTokenGuard } from './access-token.guard';
import { UnauthenticatedError } from './unauthenticated.error';

const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dffff0002'),
};

class FakeVerifier implements AccessTokenVerifier {
  readonly seen: string[] = [];

  constructor(private readonly result: Principal | Error = PRINCIPAL) {}

  async verify(token: string): Promise<Principal> {
    this.seen.push(token);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function contextWith(authorization?: string): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; principal?: Principal };
} {
  const request = {
    headers: authorization === undefined ? {} : { authorization },
  } as { headers: Record<string, string>; principal?: Principal };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AccessTokenGuard', () => {
  it('유효한 Bearer 토큰이면 통과시키고 principal을 채운다', async () => {
    const verifier = new FakeVerifier();
    const { context, request } = contextWith('Bearer valid-token');

    await expect(new AccessTokenGuard(verifier).canActivate(context)).resolves.toBe(true);
    expect(verifier.seen).toEqual(['valid-token']);
    expect(request.principal).toEqual(PRINCIPAL);
  });

  it('Authorization 헤더가 없으면 401이다', async () => {
    const { context } = contextWith();
    await expect(new AccessTokenGuard(new FakeVerifier()).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('Bearer가 아닌 스킴은 401이다', async () => {
    const { context } = contextWith('Basic dXNlcjpwYXNz');
    await expect(new AccessTokenGuard(new FakeVerifier()).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('Bearer 뒤가 비어 있으면 검증기를 부르지 않고 401이다', async () => {
    // 빈 문자열을 검증기에 넘기면 어댑터마다 다르게 실패한다. 여기서 막는다.
    const verifier = new FakeVerifier();
    const { context } = contextWith('Bearer ');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
    expect(verifier.seen).toEqual([]);
  });

  it('검증기가 던지면 그 예외가 그대로 나간다', async () => {
    const verifier = new FakeVerifier(new UnauthenticatedError('토큰이 유효하지 않습니다.'));
    const { context } = contextWith('Bearer bad');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow(
      '토큰이 유효하지 않습니다.',
    );
  });

  it('검증에 실패하면 principal을 채우지 않는다', async () => {
    const verifier = new FakeVerifier(new UnauthenticatedError());
    const { context, request } = contextWith('Bearer bad');
    await expect(new AccessTokenGuard(verifier).canActivate(context)).rejects.toThrow();
    expect(request.principal).toBeUndefined();
  });
});
```

- [ ] **Step 4: 가드와 데코레이터를 구현한다**

`access-token.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type Principal,
} from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from './unauthenticated.error';

const SCHEME = 'Bearer ';

/** 가드가 채우는 요청 확장. 컨트롤러는 `@CurrentPrincipal()`로만 읽는다. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

/**
 * 스펙 결정 6의 구현: 인증은 인바운드 어댑터의 관심사다. 유스케이스는 확인된
 * `Principal`만 받고 토큰·헤더·쿠키를 모른다.
 *
 * `shared/infrastructure`에 있는 이유는 identity와 customer 양쪽 컨트롤러가 쓰기
 * 때문이다. identity 안에 두면 customer가 identity를 import하게 되고, identity는
 * 가입 시 customer를 import하므로 순환이 생긴다.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];

    if (typeof header !== 'string' || !header.startsWith(SCHEME)) {
      throw new UnauthenticatedError('인증 토큰이 없습니다.');
    }

    const token = header.slice(SCHEME.length);
    if (token.length === 0) {
      // 빈 문자열을 검증기에 넘기면 어댑터마다 다르게 실패한다. 여기서 막는다.
      throw new UnauthenticatedError('인증 토큰이 비어 있습니다.');
    }

    request.principal = await this.verifier.verify(token);
    return true;
  }
}
```

`current-principal.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import type { AuthenticatedRequest } from './access-token.guard';
import { UnauthenticatedError } from './unauthenticated.error';

/**
 * 가드가 채운 principal을 꺼낸다. 가드 없이 이 데코레이터만 쓰면 던진다 —
 * `@UseGuards(AccessTokenGuard)`를 빠뜨린 컨트롤러가 `undefined` principal로
 * 조용히 동작하는 것을 막는다.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new UnauthenticatedError('인증 정보가 없습니다.');
    }
    return request.principal;
  },
);
```

- [ ] **Step 5: `SharedModule`에 배선한다**

```ts
import { readJwtConfig } from './infrastructure/auth/jwt.config';
import { JwtTokenService } from './infrastructure/auth/jwt-token.service';
import { AccessTokenGuard } from './infrastructure/http/access-token.guard';
import { ACCESS_TOKEN_VERIFIER } from './kernel/ports/access-token-verifier';
```

providers에 추가한다.

```ts
    // JwtConfig는 인터페이스라 DI로 해석할 수 없다. 팩토리로 만든다.
    // 잘못된 설정은 여기서 부팅을 실패시킨다 — 첫 로그인 요청에서 500으로 드러나는
    // 것보다 낫다.
    {
      provide: JwtTokenService,
      useFactory: () => new JwtTokenService(readJwtConfig(process.env)),
    },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JwtTokenService },
    AccessTokenGuard,
```

exports에 `JwtTokenService`, `ACCESS_TOKEN_VERIFIER`, `AccessTokenGuard`를 더한다.

`ValidationFailedError`의 매핑을 `kernel-domain-error-mappings.ts`에 등록하고, `UnauthenticatedError`도 함께 등록한다.

```ts
  registry.register(ValidationFailedError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });

  registry.register(UnauthenticatedError.CODE, {
    status: 401,
    code: ErrorCode.UNAUTHENTICATED,
  });
```

`app.module.spec.ts`에 세 가지를 추가한다.

```ts
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
```

`app.module.spec.ts`는 DB에 붙지 않지만 `readJwtConfig`가 `process.env`를 읽으므로, `vitest.config.ts`가 로드하는 `apps/api/.env`에 `JWT_SECRET`이 있어야 한다(태스크 10 Step 2).

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --project api-unit apps/api/src`
Expected: PASS

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

**(a) 파이프가 파싱 결과를 실제로 쓰는가**
`ZodValidationPipe.transform`을 `this.schema.parse(value); return value as T;`로 바꾼다.
Expected: FAIL — `'스키마가 값을 정규화하면 정규화된 값이 나온다'`가 실패한다. 나머지 테스트는 전부 통과한다는 점을 확인할 것 — 정규화를 확인하는 테스트가 없었다면 이 버그는 그대로 통과한다.
되돌린다.

**(b) 가드가 실제로 검증기를 부르는가**
`AccessTokenGuard.canActivate`의 `request.principal = await this.verifier.verify(token);`을 `request.principal = { accountId: ..., customerId: ... } as Principal;`로 바꿔 토큰 내용을 무시하게 만든다.
Expected: FAIL — `'검증기가 던지면 그 예외가 그대로 나간다'`와 `'유효한 Bearer 토큰이면 ... 검증기를 부른다'`가 실패한다.
되돌린다.

**(c) `ValidationFailedError` 매핑 등록 누락을 잡는가**
`kernel-domain-error-mappings.ts`에서 `ValidationFailedError` 등록을 주석 처리한다.
Expected: FAIL — `app.module.spec.ts`의 `'검증·인증 예외 매핑이 등록되어 있다'`가 폴백 `{422, DOMAIN_RULE_VIOLATED}`를 받아 실패한다.
되돌린다.

- [ ] **Step 8: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0.

```bash
git add apps/api/src/shared apps/api/src/app.module.spec.ts
git commit -m "feat(api): 형식 검증 파이프와 액세스 토큰 가드를 공유 인바운드 인프라로 추가한다"
```

---

### Task 16: 컨트롤러와 모듈 배선 — 두 컨텍스트를 연결한다

**Files:**
- Create: `apps/api/src/modules/customer/adapters/in/http/address.controller.ts`
- Create: `apps/api/src/modules/customer/adapters/in/http/customer-domain-error-mappings.ts`
- Create: `apps/api/src/modules/customer/customer.module.ts`
- Create: `apps/api/src/modules/customer/index.ts`
- Create: `apps/api/src/modules/identity/adapters/in/http/auth.controller.ts`
- Create: `apps/api/src/modules/identity/adapters/in/http/identity-domain-error-mappings.ts`
- Create: `apps/api/src/modules/identity/adapters/out/customer/in-process-customer.adapter.ts`
- Create: `apps/api/src/modules/identity/refresh-ttl.config.ts` + spec
- Create: `apps/api/src/modules/identity/identity.module.ts`
- Create: `apps/api/src/modules/identity/index.ts`
- Create: `apps/api/src/modules/identity/adapters/in/http/auth.controller.integration.spec.ts`
- Create: `apps/api/src/modules/customer/adapters/in/http/address.controller.integration.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`, `.dependency-cruiser.js`

**Interfaces:**
- Consumes: 태스크 7·8·13의 유스케이스 포트와 서비스, 태스크 10·11·14의 어댑터, 태스크 15의 파이프·가드·데코레이터, `authContract`/`addressContract` (태스크 2)
- Produces:
  - `customer/index.ts` → `CustomerModule`, `PROVISION_CUSTOMER_USECASE`, `CUSTOMER_REPOSITORY`, `ProvisionCustomerUseCase`, `CustomerRepository` 타입
  - `identity/index.ts` → `IdentityModule`
  - HTTP 엔드포인트 10개

**순환 참조 회피 구조.** `identity` → `customer/index.ts` 한 방향만 존재한다. `customer`는 `identity`를 전혀 import하지 않고, 인증은 `shared/infrastructure/http/access-token.guard.ts`(커널 포트 의존)에서 온다. `no-circular` 규칙이 이 구조를 강제한다.

- [ ] **Step 1: 새 경계 규칙 두 개를 추가한다**

`.dependency-cruiser.js`의 `forbidden` 배열에 추가한다.

```js
    {
      // shared는 모든 모듈이 의존하는 바닥이다. 반대 방향이 생기면 순환이 만들어지고,
      // "공유 커널"이라는 말이 "아무나 아무거나 넣는 곳"이 된다.
      // 이 계획에서 실제로 유혹이 있었다: 인증 가드가 identity의 TokenIssuer를
      // 직접 부르면 편하다. 그 지름길이 identity↔customer 순환을 만든다.
      name: 'shared-knows-no-modules',
      comment: 'shared는 어느 모듈도 모른다. 반대 방향만 허용된다',
      severity: 'error',
      from: { path: 'apps/api/src/shared' },
      to: { path: 'apps/api/src/modules' },
    },
    {
      // no-cross-module-internals는 index.ts를 통한 참조를 허용하는데, 그 예외가
      // 도메인 계층에도 적용된다. 도메인이 다른 컨텍스트의 공개 API를 직접 부르면
      // 컨텍스트 간 통신이 포트를 우회하고(스펙 §4.1), 도메인 테스트가 다른
      // 모듈 전체를 끌고 온다.
      name: 'domain-imports-no-other-module',
      comment: '도메인은 다른 컨텍스트를 공개 API로도 부르지 않는다. ACL 포트로만 간다',
      severity: 'error',
      from: { path: 'apps/api/src/modules/([^/]+)/domain' },
      to: { path: 'apps/api/src/modules/(?!$1/)[^/]+/' },
    },
```

Run: `pnpm arch:check`
Expected: 통과 (아직 위반이 없다).

- [ ] **Step 2: 규칙 두 개가 실제로 발화하는지 증명한다**

**(a)** `apps/api/src/shared/infrastructure/http/access-token.guard.ts` 맨 위에
`import { AddressBook } from '../../../modules/customer/domain/address-book';`을 추가한다.
Run: `pnpm arch:check`
Expected: FAIL — `shared-knows-no-modules`와 `no-cross-module-internals` 두 규칙이 이 파일 경로를 지목한다. **위반 줄에 `access-token.guard.ts`가 실제로 찍히는지** 확인한다.
지운다.

**(b)** `apps/api/src/modules/identity/domain/account.ts` 맨 위에
`import { CustomerModule } from '../../customer';`을 추가한다(파일이 아직 없어도 된다 — 없으면 `not-to-unresolvable`이 대신 잡으므로, 이 검사는 Step 6 이후에 다시 한다).
Step 6에서 `customer/index.ts`를 만든 뒤 이 검사를 수행한다.
Expected: FAIL — `domain-imports-no-other-module`이 발화한다.
지운다.

- [ ] **Step 3: `customer/index.ts`와 `customer.module.ts`를 만든다**

`customer.module.ts`:

```ts
import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다.
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
// biome-ignore lint/style/useImportType: 위와 같다.
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import { AddressController } from './adapters/in/http/address.controller';
import { registerCustomerDomainErrors } from './adapters/in/http/customer-domain-error-mappings';
import { PrismaAddressQuery } from './adapters/out/persistence/prisma-address.query';
import { PrismaCustomerRepository } from './adapters/out/persistence/prisma-customer.repository';
import { ADDRESS_QUERY, type AddressQuery } from './application/ports/out/address.query';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from './application/ports/out/customer.repository';
import { GET_ADDRESS_BOOK_QUERY } from './application/ports/in/queries/get-address-book.query';
import { MANAGE_ADDRESSES_USECASE } from './application/ports/in/manage-addresses.usecase';
import { PROVISION_CUSTOMER_USECASE } from './application/ports/in/provision-customer.usecase';
import { GetAddressBookService } from './application/services/get-address-book.service';
import { ManageAddressesService } from './application/services/manage-addresses.service';
import { ProvisionCustomerService } from './application/services/provision-customer.service';

@Module({
  controllers: [AddressController],
  providers: [
    {
      provide: CUSTOMER_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaCustomerRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: ADDRESS_QUERY,
      useFactory: (prisma: PrismaService) => new PrismaAddressQuery(prisma),
      inject: [PrismaService],
    },
    {
      provide: PROVISION_CUSTOMER_USECASE,
      useFactory: (customers: CustomerRepository, clock: Clock, ids: IdGenerator) =>
        new ProvisionCustomerService(customers, clock, ids),
      inject: [CUSTOMER_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: MANAGE_ADDRESSES_USECASE,
      useFactory: (
        customers: CustomerRepository,
        transactions: TransactionManager,
        ids: IdGenerator,
      ) => new ManageAddressesService(customers, transactions, ids),
      inject: [CUSTOMER_REPOSITORY, TRANSACTION_MANAGER, ID_GENERATOR],
    },
    {
      provide: GET_ADDRESS_BOOK_QUERY,
      useFactory: (addresses: AddressQuery) => new GetAddressBookService(addresses),
      inject: [ADDRESS_QUERY],
    },
  ],
  // identity가 ACL 어댑터에서 쓴다. 리포지토리는 내보내지 않는다 —
  // 다른 모듈이 우리 애그리거트를 직접 만지면 불변식의 주인이 사라진다.
  exports: [PROVISION_CUSTOMER_USECASE],
})
export class CustomerModule {
  constructor(registry: DomainErrorRegistry) {
    registerCustomerDomainErrors(registry);
  }
}
```

`customer-domain-error-mappings.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import { AddressNotFoundError, InvalidAddressError } from '../../../domain/customer.errors';

/**
 * 등록하지 않으면 폴백 `{422, DOMAIN_RULE_VIOLATED}`로 조용히 떨어진다 —
 * 예외가 나지 않고 **틀린 상태 코드가 나간다.** `register`는 중복 등록에 던지므로
 * 모듈이 두 번 초기화되면 그건 소리 나게 실패한다.
 */
export function registerCustomerDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(AddressNotFoundError.CODE, {
    status: 404,
    code: ErrorCode.NOT_FOUND,
  });
  registry.register(InvalidAddressError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
}
```

`customer/index.ts`:

```ts
/**
 * customer 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다
 * (`no-cross-module-internals`가 강제한다).
 *
 * 리포지토리도, 애그리거트도, 도메인 예외도 내보내지 않는다. 밖에서 필요한 것은
 * "계정에 고객을 붙여라" 하나뿐이다.
 */
export { CustomerModule } from './customer.module';
export {
  PROVISION_CUSTOMER_USECASE,
  type ProvisionCustomerCommand,
  type ProvisionCustomerUseCase,
} from './application/ports/in/provision-customer.usecase';
```

- [ ] **Step 4: 주소록 컨트롤러를 만든다**

```ts
import {
  addressBodySchema,
  type AddressDto,
  type AddressListDto,
} from '@commerce/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AddressId } from '../../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import {
  GET_ADDRESS_BOOK_QUERY,
  type GetAddressBookQuery,
} from '../../../application/ports/in/queries/get-address-book.query';
import {
  MANAGE_ADDRESSES_USECASE,
  type ManageAddressesUseCase,
} from '../../../application/ports/in/manage-addresses.usecase';
import type { AddressView } from '../../../application/ports/out/address.query';

/**
 * `AddressView`(애플리케이션의 읽기 모델) → `AddressDto`(와이어 계약).
 * 지금은 모양이 같아 한 줄이지만, 계약이 갈라지는 순간 이 한 줄만 바뀐다.
 */
function toDto(view: AddressView): AddressDto {
  return {
    id: view.id,
    label: view.label,
    recipient: view.recipient,
    phone: view.phone,
    zip: view.zip,
    line1: view.line1,
    ...(view.line2 === null ? {} : { line2: view.line2 }),
    isDefault: view.isDefault,
  };
}

@Controller('addresses')
@UseGuards(AccessTokenGuard)
export class AddressController {
  constructor(
    @Inject(MANAGE_ADDRESSES_USECASE) private readonly addresses: ManageAddressesUseCase,
    @Inject(GET_ADDRESS_BOOK_QUERY) private readonly addressBook: GetAddressBookQuery,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<AddressListDto> {
    const views = await this.addressBook.execute({ customerId: principal.customerId });
    return { addresses: views.map(toDto) };
  }

  @Post()
  @HttpCode(201)
  async add(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(addressBodySchema)) body: unknown,
  ): Promise<AddressDto> {
    const view = await this.addresses.add({
      customerId: principal.customerId,
      details: body as Parameters<ManageAddressesUseCase['add']>[0]['details'],
    });
    return toDto(view);
  }

  @Put(':addressId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
    @Body(new ZodValidationPipe(addressBodySchema)) body: unknown,
  ): Promise<AddressDto> {
    const view = await this.addresses.update({
      customerId: principal.customerId,
      // AddressId.of가 InvalidIdError(400)를 던진다 — 경로 파라미터는 사용자 입력이므로
      // 400이 맞다. 이것이 태스크 1에서 `of`와 `fromPersistence`를 가른 이유다.
      addressId: AddressId.of(addressId),
      details: body as Parameters<ManageAddressesUseCase['update']>[0]['details'],
    });
    return toDto(view);
  }

  @Delete(':addressId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.remove({
      customerId: principal.customerId,
      addressId: AddressId.of(addressId),
    });
  }

  @Post(':addressId/default')
  @HttpCode(204)
  async setDefault(
    @CurrentPrincipal() principal: Principal,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.setDefault({
      customerId: principal.customerId,
      addressId: AddressId.of(addressId),
    });
  }
}
```

> `body as Parameters<...>` 캐스팅이 거슬리면 `ZodValidationPipe<AddressBody>`의 반환 타입을 파라미터 타입으로 직접 쓴다(`@Body(new ZodValidationPipe(addressBodySchema)) body: AddressBody`). `AddressBody`는 contracts가 export하므로 그쪽이 낫다 — 구현자가 그렇게 쓸 것. 위 캐스팅은 피할 것.

- [ ] **Step 5: identity의 ACL 어댑터·컨트롤러·모듈을 만든다**

`in-process-customer.adapter.ts`:

```ts
import { CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { ProvisionCustomerUseCase } from '../../../../customer';
import type { CustomerDirectory } from '../../../application/ports/out/customer-directory';

/**
 * Customer 컨텍스트로 나가는 ACL 어댑터 (스펙 §4.2).
 *
 * `../../../../customer`(= `modules/customer/index.ts`)만 본다 — 내부 파일을 하나라도
 * import하면 `no-cross-module-internals`가 잡는다. 나중에 customer가 별도 서비스로
 * 떨어져 나가면 **이 파일 하나만** HTTP 클라이언트로 바뀐다.
 *
 * `findByAccount`가 리포지토리 대신 조회를 하지 않고 프로비저닝 유스케이스를 재사용하는
 * 이유: `provision`이 멱등하므로 "있으면 그 ID, 없으면 만들어서 ID"가 곧 조회다.
 * customer가 조회 전용 API를 따로 내보내면 그때 바꾼다.
 */
export class InProcessCustomerAdapter implements CustomerDirectory {
  constructor(private readonly provisionCustomer: ProvisionCustomerUseCase) {}

  async provision(accountId: AccountId, tx: TransactionContext): Promise<CustomerId> {
    return this.provisionCustomer.execute({ accountId, tx });
  }

  async findByAccount(accountId: AccountId): Promise<CustomerId | null> {
    return this.lookup(accountId);
  }

  private async lookup(_accountId: AccountId): Promise<CustomerId | null> {
    throw new Error('구현자 주의: 아래 설명대로 조회 경로를 정한다.');
  }
}
```

**구현자 판단이 필요한 지점.** `findByAccount`는 트랜잭션 없이 읽기만 해야 하는데, `ProvisionCustomerUseCase.execute`는 `tx`를 필수로 받고 없으면 쓰기를 시도할 수 있다. 두 선택지 중 하나를 고르고 이유를 보고서에 적는다.

1. **`customer/index.ts`에 조회 전용 포트를 하나 더 내보낸다** — `FindCustomerByAccountQuery { execute({ accountId }): Promise<CustomerId | null> }`. `customer/application/ports/in/queries/`에 추가하고 `CustomerRepository.findByAccountId`에 위임하는 5줄짜리 서비스를 만든다. **권장한다** — 조회와 쓰기가 갈리고, `provision`의 `tx` 필수 계약이 유지된다.
2. `ProvisionCustomerCommand.tx`를 optional로 바꾼다. 간단하지만 "계정과 고객은 같은 트랜잭션에서 만들어져야 한다"는 계약이 약해진다.

선택지 1을 택하면 `customer` 쪽에 `FIND_CUSTOMER_BY_ACCOUNT_QUERY`와 `FindCustomerByAccountService`를 추가하고, `index.ts`에 함께 내보내고, `InProcessCustomerAdapter`가 둘을 주입받는다. 위 스켈레톤의 `lookup`은 지운다.

`identity-domain-error-mappings.ts`:

```ts
import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  SamePasswordError,
} from '../../../domain/account.errors';
import { InvalidEmailError } from '../../../domain/email';
import { PasswordPolicyViolationError } from '../../../domain/plain-password';
import {
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../../../domain/session.errors';

export function registerIdentityDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(EmailAlreadyRegisteredError.CODE, {
    status: 409,
    code: ErrorCode.EMAIL_ALREADY_REGISTERED,
  });
  registry.register(InvalidCredentialsError.CODE, {
    status: 401,
    code: ErrorCode.INVALID_CREDENTIALS,
  });
  registry.register(InvalidEmailError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
  registry.register(PasswordPolicyViolationError.CODE, {
    status: 422,
    code: ErrorCode.PASSWORD_POLICY_VIOLATED,
  });
  registry.register(SamePasswordError.CODE, {
    status: 422,
    code: ErrorCode.PASSWORD_POLICY_VIOLATED,
  });
  // 세 가지 세션 실패는 모두 401 UNAUTHENTICATED다. 도메인 예외를 갈라둔 것은
  // 서버 로그에서 "만료"와 "로그아웃 후 재사용"을 구분하기 위해서지, 클라이언트가
  // 다르게 행동해야 해서가 아니다 — 어느 쪽이든 할 일은 재로그인이다.
  for (const errorClass of [SessionExpiredError, SessionRevokedError, SessionNotFoundError]) {
    registry.register(errorClass.CODE, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  }
}
```

`auth.controller.ts`는 다섯 엔드포인트를 계약대로 노출한다.

```ts
import {
  changePasswordBodySchema,
  refreshBodySchema,
  type ChangePasswordBody,
  type RefreshBody,
  type SessionTokensDto,
  type SignInBody,
  type SignUpBody,
  signInBodySchema,
  signUpBodySchema,
} from '@commerce/contracts';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import {
  CHANGE_PASSWORD_USECASE,
  type ChangePasswordUseCase,
} from '../../../application/ports/in/change-password.usecase';
import {
  REFRESH_SESSION_USECASE,
  type RefreshSessionUseCase,
} from '../../../application/ports/in/refresh-session.usecase';
import { SIGN_IN_USECASE, type SignInUseCase } from '../../../application/ports/in/sign-in.usecase';
import { SIGN_OUT_USECASE, type SignOutUseCase } from '../../../application/ports/in/sign-out.usecase';
import { SIGN_UP_USECASE, type SignUpUseCase } from '../../../application/ports/in/sign-up.usecase';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SIGN_UP_USECASE) private readonly signUp: SignUpUseCase,
    @Inject(SIGN_IN_USECASE) private readonly signIn: SignInUseCase,
    @Inject(REFRESH_SESSION_USECASE) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(SIGN_OUT_USECASE) private readonly signOut: SignOutUseCase,
    @Inject(CHANGE_PASSWORD_USECASE) private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Post('sign-up')
  @HttpCode(201)
  async postSignUp(
    @Body(new ZodValidationPipe(signUpBodySchema)) body: SignUpBody,
  ): Promise<SessionTokensDto> {
    return this.signUp.execute(body);
  }

  @Post('sign-in')
  @HttpCode(200)
  async postSignIn(
    @Body(new ZodValidationPipe(signInBodySchema)) body: SignInBody,
  ): Promise<SessionTokensDto> {
    return this.signIn.execute(body);
  }

  @Post('refresh')
  @HttpCode(200)
  async postRefresh(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody,
  ): Promise<SessionTokensDto> {
    return this.refreshSession.execute(body);
  }

  @Post('sign-out')
  @HttpCode(204)
  async postSignOut(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody,
  ): Promise<void> {
    // 인증을 요구하지 않는다. 액세스 토큰이 이미 만료된 상태에서도 로그아웃할 수
    // 있어야 하고, 리프레시 토큰 소지 자체가 그 세션에 대한 권한이다.
    await this.signOut.execute(body);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async postChangePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordBodySchema)) body: ChangePasswordBody,
  ): Promise<void> {
    // accountId는 **요청 본문이 아니라 토큰에서** 온다. 본문에서 받으면 남의 계정
    // 비밀번호를 바꿀 수 있다.
    await this.changePassword.execute({ accountId: principal.accountId, ...body });
  }
}
```

`identity/refresh-ttl.config.ts` (`readJwtConfig`와 같은 형태의 작은 설정 리더. spec을 붙인다 — 숫자가 아니거나 0 이하면 부팅을 거부한다):

```ts
import { Duration } from '../../shared/kernel/duration';

const DEFAULT_DAYS = 14;

export function readRefreshTtl(env: NodeJS.ProcessEnv): Duration {
  const raw = env['REFRESH_TOKEN_TTL_DAYS'];
  if (raw === undefined) {
    return Duration.hours(24 * DEFAULT_DAYS);
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`REFRESH_TOKEN_TTL_DAYS는 양의 정수여야 합니다: "${raw}"`);
  }
  // Duration에 days 팩토리가 없다. hours로 만든다.
  return Duration.hours(24 * days);
}
```

`identity.module.ts` — **생성자 인자 순서가 태스크 7·8의 서비스 시그니처와 정확히 일치해야 한다.** Nest의 `useFactory`는 위치 인자로 주입하므로 순서가 어긋나도 타입이 우연히 맞으면 컴파일이 통과한다.

```ts
import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다.
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
// biome-ignore lint/style/useImportType: 위와 같다.
import { JwtTokenService } from '../../shared/infrastructure/auth/jwt-token.service';
// biome-ignore lint/style/useImportType: 위와 같다.
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import type { Duration } from '../../shared/kernel/duration';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../shared/kernel/ports/domain-event.publisher';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import {
  CustomerModule,
  PROVISION_CUSTOMER_USECASE,
  type ProvisionCustomerUseCase,
} from '../customer';
import { AuthController } from './adapters/in/http/auth.controller';
import { registerIdentityDomainErrors } from './adapters/in/http/identity-domain-error-mappings';
import { InProcessCustomerAdapter } from './adapters/out/customer/in-process-customer.adapter';
import { ConsoleEmailSender } from './adapters/out/email/console-email.sender';
import { Argon2PasswordHasher } from './adapters/out/hashing/argon2-password.hasher';
import { PrismaAccountRepository } from './adapters/out/persistence/prisma-account.repository';
import { PrismaSessionRepository } from './adapters/out/persistence/prisma-session.repository';
import { JwtTokenIssuer } from './adapters/out/token/jwt-token.issuer';
import { CHANGE_PASSWORD_USECASE } from './application/ports/in/change-password.usecase';
import { REFRESH_SESSION_USECASE } from './application/ports/in/refresh-session.usecase';
import { SIGN_IN_USECASE } from './application/ports/in/sign-in.usecase';
import { SIGN_OUT_USECASE } from './application/ports/in/sign-out.usecase';
import { SIGN_UP_USECASE } from './application/ports/in/sign-up.usecase';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from './application/ports/out/account.repository';
import {
  CUSTOMER_DIRECTORY,
  type CustomerDirectory,
} from './application/ports/out/customer-directory';
import { EMAIL_SENDER, type EmailSender } from './application/ports/out/email-sender';
import { PASSWORD_HASHER, type PasswordHasher } from './application/ports/out/password-hasher';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './application/ports/out/session.repository';
import { TOKEN_ISSUER, type TokenIssuer } from './application/ports/out/token-issuer';
import { ChangePasswordService } from './application/services/change-password.service';
import { RefreshSessionService } from './application/services/refresh-session.service';
import { SignInService } from './application/services/sign-in.service';
import { SignOutService } from './application/services/sign-out.service';
import { SignUpService } from './application/services/sign-up.service';
import { readRefreshTtl } from './refresh-ttl.config';

const REFRESH_TTL = Symbol('RefreshTtl');

@Module({
  // 이 한 줄이 스펙 §4.2의 호출 경로를 만든다. 반대 방향(customer → identity)은
  // 존재하지 않으며, no-circular가 그것을 강제한다.
  imports: [CustomerModule],
  controllers: [AuthController],
  providers: [
    { provide: REFRESH_TTL, useFactory: () => readRefreshTtl(process.env) },

    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaAccountRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: SESSION_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaSessionRepository(prisma),
      inject: [PrismaService],
    },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    {
      provide: TOKEN_ISSUER,
      useFactory: (jwt: JwtTokenService) => new JwtTokenIssuer(jwt),
      inject: [JwtTokenService],
    },
    {
      // useClass를 쓰지 않는다 — ConsoleEmailSender의 생성자 파라미터에 기본값이 있어
      // Nest가 그 자리를 주입 대상으로 보고 해석에 실패한다.
      provide: EMAIL_SENDER,
      useFactory: () => new ConsoleEmailSender(),
    },
    {
      provide: CUSTOMER_DIRECTORY,
      useFactory: (provisionCustomer: ProvisionCustomerUseCase) =>
        new InProcessCustomerAdapter(provisionCustomer),
      inject: [PROVISION_CUSTOMER_USECASE],
    },

    {
      provide: SIGN_UP_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        customers: CustomerDirectory,
        hasher: PasswordHasher,
        tokens: TokenIssuer,
        emails: EmailSender,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
        events: DomainEventPublisher,
        refreshTtl: Duration,
      ) =>
        new SignUpService(
          accounts,
          sessions,
          customers,
          hasher,
          tokens,
          emails,
          transactions,
          clock,
          ids,
          events,
          refreshTtl,
        ),
      inject: [
        ACCOUNT_REPOSITORY,
        SESSION_REPOSITORY,
        CUSTOMER_DIRECTORY,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        EMAIL_SENDER,
        TRANSACTION_MANAGER,
        CLOCK,
        ID_GENERATOR,
        DOMAIN_EVENT_PUBLISHER,
        REFRESH_TTL,
      ],
    },
    {
      provide: SIGN_IN_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        customers: CustomerDirectory,
        hasher: PasswordHasher,
        tokens: TokenIssuer,
        clock: Clock,
        ids: IdGenerator,
        refreshTtl: Duration,
      ) => new SignInService(accounts, sessions, customers, hasher, tokens, clock, ids, refreshTtl),
      inject: [
        ACCOUNT_REPOSITORY,
        SESSION_REPOSITORY,
        CUSTOMER_DIRECTORY,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        CLOCK,
        ID_GENERATOR,
        REFRESH_TTL,
      ],
    },
    {
      provide: REFRESH_SESSION_USECASE,
      useFactory: (
        sessions: SessionRepository,
        customers: CustomerDirectory,
        tokens: TokenIssuer,
        clock: Clock,
        refreshTtl: Duration,
      ) => new RefreshSessionService(sessions, customers, tokens, clock, refreshTtl),
      inject: [SESSION_REPOSITORY, CUSTOMER_DIRECTORY, TOKEN_ISSUER, CLOCK, REFRESH_TTL],
    },
    {
      provide: SIGN_OUT_USECASE,
      useFactory: (sessions: SessionRepository, tokens: TokenIssuer, clock: Clock) =>
        new SignOutService(sessions, tokens, clock),
      inject: [SESSION_REPOSITORY, TOKEN_ISSUER, CLOCK],
    },
    {
      provide: CHANGE_PASSWORD_USECASE,
      useFactory: (
        accounts: AccountRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        transactions: TransactionManager,
        clock: Clock,
      ) => new ChangePasswordService(accounts, sessions, hasher, transactions, clock),
      inject: [ACCOUNT_REPOSITORY, SESSION_REPOSITORY, PASSWORD_HASHER, TRANSACTION_MANAGER, CLOCK],
    },
  ],
})
export class IdentityModule {
  constructor(registry: DomainErrorRegistry) {
    registerIdentityDomainErrors(registry);
  }
}
```

`identity/index.ts`:

```ts
/**
 * identity 컨텍스트의 공개 API. `IdentityModule`만 내보낸다 — identity의 유스케이스를
 * 다른 모듈이 부를 일이 없다. 인증은 `shared/infrastructure/http`의 가드가 담당하고,
 * 그 가드는 커널 포트에만 의존한다.
 */
export { IdentityModule } from './identity.module';
```

- [ ] **Step 6: `app.module.ts`에 두 모듈을 등록한다**

```ts
@Module({
  imports: [SharedModule, IdentityModule, CustomerModule],
  controllers: [HealthController],
})
export class AppModule {}
```

`app.module.spec.ts`에 추가한다.

```ts
  it('두 컨트롤러가 유스케이스를 주입받는다', () => {
    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
    expect(moduleRef.get(AddressController)).toBeInstanceOf(AddressController);
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
```

Step 2의 (b) 증명을 지금 수행한다.

- [ ] **Step 7: 인증 흐름 통합 테스트를 쓴다**

`auth.controller.integration.spec.ts`는 실제 Nest 앱 + 실제 Postgres에 supertest로 요청한다. **배선 확인이 목적이다** — 비즈니스 케이스는 이미 유스케이스 테스트가 덮었다(스펙 §9.4의 5단계).

```ts
import { ErrorCode } from '@commerce/contracts';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../../../app.module';
import { workerDatabaseName } from '../../../../../../test/setup/database';

let app: INestApplication;
const originalDatabaseUrl = process.env['DATABASE_URL'];

beforeAll(async () => {
  process.env['DATABASE_URL'] = `${process.env['TEST_DATABASE_BASE_URL']}/${workerDatabaseName()}`;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  // 이월 25: 복원하지 않으면 같은 워커의 이후 spec이 이 값을 상속한다.
  if (originalDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
  }
});

const CREDENTIALS = { email: 'flow@example.com', password: 'correct horse battery staple' };

describe('인증 흐름', () => {
  it('가입 → 로그인 → 갱신 → 로그아웃이 이어진다', async () => {
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    expect(signUp.status).toBe(201);
    expect(signUp.body.accessToken).toEqual(expect.any(String));

    const signIn = await request(app.getHttpServer()).post('/auth/sign-in').send(CREDENTIALS);
    expect(signIn.status).toBe(200);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signIn.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(signIn.body.refreshToken);

    // 회전된 옛 토큰은 죽어 있다.
    const reused = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signIn.body.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe(ErrorCode.UNAUTHENTICATED);

    const signedOut = await request(app.getHttpServer())
      .post('/auth/sign-out')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(signedOut.status).toBe(204);

    const afterSignOut = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken });
    expect(afterSignOut.status).toBe(401);
  });

  it('중복 이메일 가입은 409 EMAIL_ALREADY_REGISTERED다', async () => {
    await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const again = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(ErrorCode.EMAIL_ALREADY_REGISTERED);
  });

  it('잘못된 이메일 형식은 400 VALIDATION_FAILED다', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'nope', password: CREDENTIALS.password });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('짧은 비밀번호는 422 PASSWORD_POLICY_VIOLATED다', async () => {
    // Zod가 아니라 도메인이 잡는 것을 확인한다 (스펙 §8.4).
    const response = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ email: 'short@example.com', password: 'short' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe(ErrorCode.PASSWORD_POLICY_VIOLATED);
  });

  it('틀린 비밀번호 로그인은 401 INVALID_CREDENTIALS다', async () => {
    await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const response = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ ...CREDENTIALS, password: 'a different password' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('가입은 계정과 고객을 함께 만든다 — 곧바로 주소를 추가할 수 있다', async () => {
    // ACL이 실제로 연결됐는지 확인하는 유일한 테스트다. 두 모듈의 단위 테스트는
    // 각자의 대역 위에서 돌기 때문에 이 연결을 볼 수 없다.
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const response = await request(app.getHttpServer())
      .post('/addresses')
      .set('Authorization', `Bearer ${signUp.body.accessToken}`)
      .send({
        label: '집',
        recipient: '홍길동',
        phone: '010-1234-5678',
        zip: '06236',
        line1: '서울시 강남구 테헤란로 1',
      });
    expect(response.status).toBe(201);
    expect(response.body.isDefault).toBe(true);
  });

  it('비밀번호를 바꾸면 기존 세션이 전부 끊긴다', async () => {
    const signUp = await request(app.getHttpServer()).post('/auth/sign-up').send(CREDENTIALS);
    const changed = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${signUp.body.accessToken}`)
      .send({ currentPassword: CREDENTIALS.password, newPassword: 'a brand new password 99' });
    expect(changed.status).toBe(204);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: signUp.body.refreshToken });
    expect(refreshed.status).toBe(401);
  });
});
```

- [ ] **Step 8: 주소록 통합 테스트를 쓴다**

`address.controller.integration.spec.ts`는 같은 형태로 아래를 확인한다.

- 토큰 없이 `GET /addresses` → 401 `UNAUTHENTICATED`
- 잘못된 토큰 → 401
- 추가 → 목록에 나오고 첫 주소가 `isDefault: true`
- 두 번째 추가 → `isDefault: false`, 기본 지정 후 목록의 맨 앞이 바뀐다
- 수정 → 200, 내용이 바뀌고 `isDefault` 유지
- 삭제 → 204, 목록에서 사라진다
- **다른 사용자의 주소 ID로 수정 → 404** (403이 아니다)
- 경로 파라미터가 uuid가 아니면 → 400 `VALIDATION_FAILED`
- 빈 수취인으로 추가 → 400 `VALIDATION_FAILED`
- 기본 배송지를 A→B로 옮기는 요청이 부분 유니크 인덱스를 어기지 않는다 (204, 목록에 기본이 하나)

두 번째 사용자를 만들려면 다른 이메일로 한 번 더 가입하고 그 토큰을 쓴다.

- [ ] **Step 9: 통과를 확인한다**

Run: `pnpm test:int`
Expected: PASS

- [ ] **Step 10: 이 검사가 무엇을 잡는지 증명한다**

**(a) 가드가 실제로 걸려 있는가**
`address.controller.ts`의 `@UseGuards(AccessTokenGuard)`를 지운다.
Expected: FAIL — `'토큰 없이 GET /addresses → 401'`이 실패한다(`@CurrentPrincipal()`이 던지므로 401은 유지될 수 있다 — 그 경우 응답 코드가 아니라 **어떤 경로로 401이 났는지**를 확인하고, 가드 없이도 401이 난다면 그 사실을 보고서에 적는다. 데코레이터의 방어선이 실제로 작동한다는 증거다).
되돌린다.

**(b) `accountId`가 토큰에서 오는가**
`auth.controller.ts`의 `postChangePassword`에서 `accountId: principal.accountId`를 `accountId: (body as { accountId?: string }).accountId as never`로 바꾼다.
Expected: FAIL — `'비밀번호를 바꾸면 기존 세션이 전부 끊긴다'`가 실패한다(본문에 `accountId`가 없어 `undefined`가 넘어간다). 그리고 `changePasswordBodySchema`가 `.strict()`라 본문에 `accountId`를 넣는 것 자체가 400이 된다는 점도 확인한다 — 두 방어선이 겹쳐 있다.
되돌린다.

**(c) ACL이 실제로 연결됐는가**
`sign-up.service.ts`에서 `await this.customers.provision(account.id, tx);`를 지우고 임의의 `CustomerId`를 쓰게 만든다.
Expected: FAIL — `'가입은 계정과 고객을 함께 만든다'`가 실패한다(주소 추가가 `CustomerNotFoundError`로 500이 된다).
되돌린다.

- [ ] **Step 11: 전체 검증과 커밋**

Run: `pnpm verify`
Expected: exit 0. `arch:check`가 `no-circular`를 포함해 전부 통과해야 한다 — identity ↔ customer 순환이 없다는 것이 여기서 확인된다.

```bash
git add apps/api/src .dependency-cruiser.js
git commit -m "feat(api): 인증·주소록 컨트롤러를 배선하고 identity→customer ACL을 연결한다"
```

---

### Task 17: BFF — 암호화 쿠키 세션과 401 refresh 재시도

**Files:**
- Modify: `apps/web/package.json` (`iron-session@^9.0.1`), `apps/web/src/shared/api/contract-client.ts`
- Create: `apps/web/.env.example`
- Create: `apps/web/src/server/token-store.ts`
- Create: `apps/web/src/server/session.ts`
- Create: `apps/web/src/server/api-client.ts` + `api-client.spec.ts`
- Create: `apps/web/src/server/auth-actions.ts` + `auth-actions.spec.ts`
- Create: `apps/web/src/server/testing/in-memory-token-store.ts`
- Create: `apps/web/app/api/auth/sign-in/route.ts`, `apps/web/app/api/auth/sign-out/route.ts`
- Create: `apps/web/src/shared/api/msw/handlers/auth.ts`
- Modify: `apps/web/src/shared/api/msw/server.ts`

**Interfaces:**
- Consumes: `apiContract`/`authContract`/`errorDtoSchema`/`ErrorCode`/`sessionTokensSchema` (`@commerce/contracts`), `initClient`/`tsRestFetchApi`/`ApiFetcher` (`@ts-rest/core@3.52.1`), `msw@^2.15.0`
- Produces:
  - `Tokens { accessToken: string; refreshToken: string }`
  - `TokenStore { read(): Promise<Tokens | null>; write(tokens): Promise<void>; clear(): Promise<void> }`
  - `SessionExpiredError`
  - `createAuthenticatedApi(baseUrl, store): ApiFetcher`
  - `createApiClient(baseUrl, store)` — 토큰이 주입된 ts-rest 클라이언트
  - `signInAction(input, deps)`, `signOutAction(deps)`
  - `cookieTokenStore(): Promise<TokenStore>`

**스펙 §8.1을 지키는 방법.** BFF에는 헥사고날을 적용하지 않는다. 다만 **테스트 seam 하나**는 둔다: `TokenStore` 인터페이스다. 그것 없이는 세션 로직을 테스트하려면 Next의 `cookies()`가 필요하고, 그건 요청 컨텍스트 안에서만 동작한다. 이 하나의 인터페이스가 401 재시도 로직 전체를 테스트 가능하게 만든다 — 포트를 여러 개 두는 것과는 다른 일이다.

**이 태스크에 화면은 없다.** 편차 2 참고. 로그인 폼·주소록 화면은 다음 계획이다.

- [ ] **Step 1: 의존성과 환경변수**

```bash
pnpm --filter @commerce/web add iron-session@^9.0.1
pnpm db:generate
```

Create `apps/web/.env.example`:

```
# Nest API의 주소. BFF 서버에서만 읽는다 (NEXT_PUBLIC_ 접두사 없음 = 브라우저에 노출되지 않음).
API_BASE_URL="http://localhost:3001"
# 세션 쿠키 암호화 키. 32자 이상이어야 iron-session이 동작한다. 운영에서 반드시 교체할 것.
SESSION_PASSWORD="dev-only-cookie-password-at-least-32-chars"
```

`apps/web/.env.local`에도 같은 두 줄을 넣는다(개발 서버용, 커밋되지 않음).

- [ ] **Step 2: `TokenStore`와 in-memory 대역을 만든다**

`src/server/token-store.ts`:

```ts
export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * 토큰이 사는 곳. 운영에서는 암호화 쿠키(`session.ts`), 테스트에서는 메모리다.
 *
 * 이 인터페이스가 BFF의 유일한 seam이다 (스펙 §8.1). 이것 없이는 401 재시도 로직을
 * 테스트하려면 Next의 `cookies()`가 필요하고, 그건 요청 컨텍스트 밖에서 동작하지 않는다.
 */
export interface TokenStore {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}
```

`src/server/testing/in-memory-token-store.ts`:

```ts
import type { Tokens, TokenStore } from '../token-store';

export class InMemoryTokenStore implements TokenStore {
  readonly writes: Tokens[] = [];
  clearCalls = 0;

  constructor(private tokens: Tokens | null = null) {}

  async read(): Promise<Tokens | null> {
    return this.tokens;
  }

  async write(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
    this.writes.push(tokens);
  }

  async clear(): Promise<void> {
    this.tokens = null;
    this.clearCalls += 1;
  }
}
```

- [ ] **Step 3: 401 재시도의 실패 테스트를 쓴다**

이 파일이 이 태스크의 핵심이다. `apps/web/src/server/api-client.spec.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../shared/api/msw/server';
import { createApiClient, SessionExpiredError } from './api-client';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = 'http://api.test';

let refreshCalls: number;
let seenAuthorization: string[];

beforeEach(() => {
  refreshCalls = 0;
  seenAuthorization = [];
});

/** 지정한 순서대로 주소록 응답을 돌려주는 핸들러. */
function addressesReturning(...statuses: number[]): void {
  let index = 0;
  server.use(
    http.get(`${BASE}/addresses`, ({ request }) => {
      seenAuthorization.push(request.headers.get('authorization') ?? '');
      const status = statuses[Math.min(index, statuses.length - 1)] ?? 200;
      index += 1;
      return status === 200
        ? HttpResponse.json({ addresses: [] }, { status: 200 })
        : HttpResponse.json({ code: 'UNAUTHENTICATED', message: '만료' }, { status });
    }),
  );
}

function refreshReturning(status: number): void {
  server.use(
    http.post(`${BASE}/auth/refresh`, () => {
      refreshCalls += 1;
      return status === 200
        ? HttpResponse.json(
            { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 900 },
            { status: 200 },
          )
        : HttpResponse.json({ code: 'UNAUTHENTICATED', message: '만료' }, { status });
    }),
  );
}

describe('createApiClient', () => {
  it('액세스 토큰을 Authorization 헤더로 주입한다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(200);
    expect(seenAuthorization).toEqual(['Bearer access-1']);
  });

  it('200이면 갱신하지 않는다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await createApiClient(BASE, store).address.list();

    expect(refreshCalls).toBe(0);
  });

  it('401이면 갱신하고 새 토큰으로 정확히 한 번 재시도한다', async () => {
    // 스펙 §8.5의 "401이면 refresh로 갱신 후 1회 재시도 (BFF 안에서 조용히)".
    addressesReturning(401, 200);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(seenAuthorization).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('갱신에 성공하면 새 토큰을 저장한다', async () => {
    // 저장하지 않으면 다음 요청이 또 401 → 갱신을 반복한다. 회전 때문에 그 갱신은
    // 실패하고, 사용자는 매 요청마다 로그아웃된다.
    addressesReturning(401, 200);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await createApiClient(BASE, store).address.list();

    expect(store.writes).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
  });

  it('갱신에 실패하면 세션을 지우고 SessionExpiredError를 던진다', async () => {
    addressesReturning(401);
    refreshReturning(401);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(store.clearCalls).toBe(1);
    expect(await store.read()).toBeNull();
  });

  it('갱신 후에도 401이면 다시 갱신하지 않는다', async () => {
    // 무한 재시도 루프를 막는 단언이다. 이것이 없으면 API가 계속 401을 내는 상황에서
    // BFF가 갱신-재시도를 영원히 반복한다.
    addressesReturning(401, 401);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(refreshCalls).toBe(1);
    expect(seenAuthorization).toHaveLength(2);
    expect(store.clearCalls).toBe(1);
  });

  it('세션이 없으면 요청 자체를 보내지 않는다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore(null);

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(seenAuthorization).toEqual([]);
  });

  it('401이 아닌 오류(500)는 갱신하지 않고 그대로 돌려준다', async () => {
    // 500에 갱신을 시도하면 멀쩡한 세션을 회전시켜 태우게 된다.
    addressesReturning(500);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(500);
    expect(refreshCalls).toBe(0);
  });
});
```

`apps/web/test/setup.ts`가 `onUnhandledRequest: 'error'`로 서버를 띄우므로, 위 핸들러에 없는 요청이 나가면 즉시 실패한다 — 의도치 않은 호출이 조용히 통과하지 않는다.

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run --project web apps/web/src/server/api-client.spec.ts`
Expected: FAIL — `api-client.ts`가 없다.

- [ ] **Step 5: `contract-client.ts`를 루트 계약으로 바꾸고 `api-client.ts`를 구현한다**

`src/shared/api/contract-client.ts`:

```ts
import { apiContract } from '@commerce/contracts';
import { type ApiFetcher, initClient } from '@ts-rest/core';

/**
 * `api`를 주지 않으면 ts-rest의 기본 fetch를 쓴다 — 인증이 필요 없는 호출(health)용이다.
 */
export function createContractClient(baseUrl: string, api?: ApiFetcher) {
  return initClient(apiContract, {
    baseUrl,
    baseHeaders: { 'Content-Type': 'application/json' },
    ...(api === undefined ? {} : { api }),
  });
}
```

`src/server/api-client.ts`:

```ts
import 'server-only';
import { sessionTokensSchema } from '@commerce/contracts';
import { type ApiFetcher, type ApiFetcherArgs, tsRestFetchApi } from '@ts-rest/core';
import { createContractClient } from '../shared/api/contract-client';
import type { Tokens, TokenStore } from './token-store';

/**
 * 세션이 없거나 되살릴 수 없다. 호출자(Route Handler, RSC)는 이걸 잡아 로그인으로 보낸다.
 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

function withToken(args: ApiFetcherArgs, accessToken: string): ApiFetcherArgs {
  return { ...args, headers: { ...args.headers, authorization: `Bearer ${accessToken}` } };
}

async function refreshTokens(baseUrl: string, refreshToken: string): Promise<Tokens | null> {
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    return null;
  }
  // 계약 스키마로 파싱한다. 서버가 형태를 바꾸면 여기서 즉시 깨진다 —
  // undefined 토큰을 헤더에 실어 보내는 것보다 낫다.
  const parsed = sessionTokensSchema.safeParse(await response.json());
  if (!parsed.success) {
    return null;
  }
  return { accessToken: parsed.data.accessToken, refreshToken: parsed.data.refreshToken };
}

/**
 * 스펙 §8.5의 두 번째 흐름: 쿠키 → 토큰 주입 → 401이면 갱신 후 **정확히 1회** 재시도.
 *
 * 재시도가 1회인 것이 중요하다. 조건 없이 반복하면 API가 계속 401을 내는 상황에서
 * 무한 루프가 된다. 갱신 후에도 401이면 세션을 버리고 로그인으로 보낸다.
 *
 * 401이 아닌 오류(500 등)에는 갱신하지 않는다. 멀쩡한 리프레시 토큰을 회전시켜
 * 태울 이유가 없다.
 */
export function createAuthenticatedApi(baseUrl: string, store: TokenStore): ApiFetcher {
  return async (args: ApiFetcherArgs) => {
    const tokens = await store.read();
    if (tokens === null) {
      throw new SessionExpiredError('세션이 없습니다.');
    }

    const first = await tsRestFetchApi(withToken(args, tokens.accessToken));
    if (first.status !== 401) {
      return first;
    }

    const refreshed = await refreshTokens(baseUrl, tokens.refreshToken);
    if (refreshed === null) {
      await store.clear();
      throw new SessionExpiredError('세션 갱신에 실패했습니다.');
    }
    await store.write(refreshed);

    const second = await tsRestFetchApi(withToken(args, refreshed.accessToken));
    if (second.status === 401) {
      await store.clear();
      throw new SessionExpiredError('갱신 후에도 인증에 실패했습니다.');
    }
    return second;
  };
}

export function createApiClient(baseUrl: string, store: TokenStore) {
  return createContractClient(baseUrl, createAuthenticatedApi(baseUrl, store));
}

export function apiBaseUrl(): string {
  return process.env['API_BASE_URL'] ?? 'http://localhost:3001';
}
```

**주의:** `import 'server-only'`가 spec 파일에서도 로드된다. Next 밖에서 이 패키지는 아무 일도 하지 않으므로 vitest에서 문제가 없다. 문제가 생기면 `vitest.config.ts`의 `web` 프로젝트에 `resolve.alias`로 빈 모듈을 매핑하지 말고, `api-client.ts`에서 `server-only`를 빼고 대신 `session.ts`에만 남긴다(토큰이 실제로 만져지는 곳은 거기다). 어느 쪽을 택했는지 보고서에 적는다.

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run --project web apps/web/src/server/api-client.spec.ts`
Expected: PASS (8개)

- [ ] **Step 7: 이 검사가 무엇을 잡는지 증명한다**

세 가지를 각각 증명한다.

**(a) 재시도가 실제로 일어나는가**
`createAuthenticatedApi`에서 `if (first.status !== 401) { return first; }`를 `return first;`로 바꾼다.
Expected: FAIL — `'401이면 갱신하고 새 토큰으로 정확히 한 번 재시도한다'`가 실패한다.
되돌린다.

**(b) 재시도가 1회로 제한되는가**
재시도 부분을 `while (response.status === 401) { ... }` 루프로 바꾼다.
Expected: FAIL — `'갱신 후에도 401이면 다시 갱신하지 않는다'`가 무한 루프에 빠지거나 타임아웃으로 실패한다. **테스트가 멈추지 않으면 강제 종료하고 그 사실을 확인한 것으로 친다** — 그것이 정확히 이 단언이 막는 상황이다.
되돌린다.

**(c) 갱신된 토큰이 저장되는가**
`await store.write(refreshed);`를 지운다.
Expected: FAIL — `'갱신에 성공하면 새 토큰을 저장한다'`가 실패한다. 이 회귀는 **매 요청마다 갱신을 시도하게 만들고**, 리프레시 토큰이 회전됐으므로 두 번째 갱신부터는 실패해 사용자가 매 요청마다 로그아웃된다.
되돌린다.

- [ ] **Step 8: `session.ts`(암호화 쿠키)를 만든다**

```ts
import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import type { Tokens, TokenStore } from './token-store';

interface SessionData {
  tokens?: Tokens;
}

function sessionOptions(): SessionOptions {
  const password = process.env['SESSION_PASSWORD'];
  if (!password || password.length < 32) {
    throw new Error('SESSION_PASSWORD가 없거나 32자 미만입니다. apps/web/.env.local을 확인하세요.');
  }
  return {
    password,
    cookieName: 'sid',
    cookieOptions: {
      // 스펙 §8.5: 브라우저 자바스크립트는 토큰을 볼 수 없다. XSS 노출면이 줄어든다.
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  };
}

/**
 * 암호화 쿠키를 `TokenStore`로 노출한다. Redis를 띄우지 않는 이유는 즉시 무효화가
 * 이미 Nest의 `sessions` 테이블에서 해결되기 때문이다 — BFF는 토큰 운반자일 뿐이라
 * 별도 저장소가 필요 없다.
 *
 * **이 파일에는 자동 테스트가 없다.** `cookies()`는 Next의 요청 컨텍스트 안에서만
 * 동작하고, 그걸 흉내내려면 목 라이브러리가 필요하다(금지). 대신 이 파일을 3~4줄로
 * 유지하고 로직 전체를 `api-client.ts`와 `auth-actions.ts`에 두어, 테스트되지 않는
 * 표면을 최소화했다. 실제 동작은 다음 계획의 Playwright E2E가 확인한다.
 */
export async function cookieTokenStore(): Promise<TokenStore> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions());

  return {
    async read(): Promise<Tokens | null> {
      return session.tokens ?? null;
    },
    async write(tokens: Tokens): Promise<void> {
      session.tokens = tokens;
      await session.save();
    },
    async clear(): Promise<void> {
      session.destroy();
    },
  };
}
```

- [ ] **Step 9: `auth-actions.ts`와 그 테스트를 만든다**

테스트는 MSW로 Nest를 흉내내고 `InMemoryTokenStore`를 주입한다.

```ts
import { ErrorCode } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../shared/api/msw/server';
import { signInAction, signOutAction } from './auth-actions';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = 'http://api.test';
const CREDENTIALS = { email: 'user@example.com', password: 'correct horse battery' };

describe('signInAction', () => {
  it('성공하면 토큰을 저장하고 ok를 돌려준다', async () => {
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 },
          { status: 200 },
        ),
      ),
    );
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({ ok: true });
    expect(await store.read()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('토큰을 응답 본문에 실어 돌려주지 않는다', async () => {
    // 이것이 스펙 §8.5의 요점이다. 브라우저는 액세스 토큰을 한 번도 보지 않는다.
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 },
          { status: 200 },
        ),
      ),
    );
    const result = await signInAction(CREDENTIALS, {
      baseUrl: BASE,
      store: new InMemoryTokenStore(null),
    });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('실패하면 에러 코드를 그대로 전달하고 토큰을 저장하지 않는다', async () => {
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          { code: ErrorCode.INVALID_CREDENTIALS, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
          { status: 401 },
        ),
      ),
    );
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INVALID_CREDENTIALS,
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
    });
    expect(await store.read()).toBeNull();
  });

  it('응답이 계약 형태가 아니면 내부 오류로 처리한다', async () => {
    // BFF가 계산하지 않는다는 규칙(§8.1)은 "형태를 확인하지 않는다"와 다르다.
    server.use(http.post(`${BASE}/auth/sign-in`, () => HttpResponse.json({ hi: 1 }, { status: 200 })));
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({ ok: false, code: ErrorCode.INTERNAL_ERROR, message: expect.any(String) });
    expect(await store.read()).toBeNull();
  });
});

describe('signOutAction', () => {
  it('Nest에 알리고 쿠키를 비운다', async () => {
    let seenBody: unknown = null;
    server.use(
      http.post(`${BASE}/auth/sign-out`, async ({ request }) => {
        seenBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const store = new InMemoryTokenStore({ accessToken: 'a', refreshToken: 'r' });

    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
    expect(seenBody).toEqual({ refreshToken: 'r' });
    expect(await store.read()).toBeNull();
  });

  it('세션이 없어도 성공한다', async () => {
    const store = new InMemoryTokenStore(null);
    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
  });

  it('Nest가 실패해도 쿠키는 비운다', async () => {
    // 서버가 죽었는데 브라우저에 세션이 남아 있으면 사용자는 로그아웃했다고 믿는다.
    // 로컬 세션을 지우는 것은 항상 성공해야 한다.
    server.use(http.post(`${BASE}/auth/sign-out`, () => HttpResponse.error()));
    const store = new InMemoryTokenStore({ accessToken: 'a', refreshToken: 'r' });

    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
    expect(await store.read()).toBeNull();
  });
});
```

구현은 `fetch` + `sessionTokensSchema`/`errorDtoSchema`로 응답을 파싱하고, 스키마가 맞지 않으면 `ErrorCode.INTERNAL_ERROR`를 돌려준다. `signOutAction`은 Nest 호출을 `try`로 감싸 실패해도 `store.clear()`에 도달하게 한다.

- [ ] **Step 10: Route Handler 두 개와 MSW 핸들러를 만든다**

`apps/web/app/api/auth/sign-in/route.ts`:

```ts
import { apiBaseUrl } from '@/server/api-client';
import { signInAction } from '@/server/auth-actions';
import { cookieTokenStore } from '@/server/session';

/**
 * 접착제 3줄. 로직은 전부 `signInAction`에 있고 그쪽은 테스트가 있다.
 * 이 파일 자체에는 자동 테스트가 없다 — Route Handler를 vitest에서 부르려면
 * Next의 요청 컨텍스트가 필요하고, 그걸 흉내내려면 목 라이브러리가 든다(금지).
 * 다음 계획의 Playwright E2E가 이 경로를 덮는다.
 */
export async function POST(request: Request): Promise<Response> {
  const result = await signInAction(await request.json(), {
    baseUrl: apiBaseUrl(),
    store: await cookieTokenStore(),
  });
  return Response.json(result, { status: result.ok ? 200 : 401 });
}
```

`sign-out/route.ts`도 같은 모양이며 항상 200을 돌려준다.

`src/shared/api/msw/handlers/auth.ts`는 계약 스키마로 요청과 응답을 검증하는 기본 핸들러를 둔다(스펙 §9.9). `server.ts`의 핸들러 배열에 추가한다.

```ts
import { signInBodySchema, signUpBodySchema } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * 요청 본문을 계약 스키마로 파싱한다 — 계약이 바뀌면 프론트 목이 즉시 깨진다.
 * 손으로 만든 fake는 조용히 드리프트하지만 이 방식은 구조적으로 불가능하다 (스펙 §9.9).
 */
export const authHandlers = [
  http.post(`${BASE}/auth/sign-up`, async ({ request }) => {
    signUpBodySchema.parse(await request.json());
    return HttpResponse.json(
      { accessToken: 'msw-access', refreshToken: 'msw-refresh', expiresInSeconds: 900 },
      { status: 201 },
    );
  }),
  http.post(`${BASE}/auth/sign-in`, async ({ request }) => {
    signInBodySchema.parse(await request.json());
    return HttpResponse.json(
      { accessToken: 'msw-access', refreshToken: 'msw-refresh', expiresInSeconds: 900 },
      { status: 200 },
    );
  }),
];
```

- [ ] **Step 11: 전체 검증**

Run: `pnpm verify`
Expected: exit 0.

`arch:check`가 `no-server-code-in-fsd`를 확인한다 — FSD 레이어가 `src/server`를 import하지 않는다.

- [ ] **Step 12: FSD 경계 규칙이 실제로 발화하는지 증명한다**

`apps/web/src/shared/api/contract-client.ts` 맨 위에
`import type { TokenStore } from '../../server/token-store';`를 추가한다.
Run: `pnpm arch:check`
Expected: FAIL — `no-server-code-in-fsd`가 이 파일을 지목한다. 이 규칙이 없으면 세션·토큰 코드가 FSD 레이어로 새고, 결국 클라이언트 번들에 들어간다.
지우고 다시 통과하는지 확인한다.

- [ ] **Step 13: 커밋**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): BFF 암호화 쿠키 세션과 401 refresh 재시도를 추가한다"
```

---

## 완료 기준

이 계획이 끝났을 때 다음이 참이어야 한다. 스펙 §13의 성공 기준 중 이 계획의 범위에 해당하는 것들이다.

**기능**

- [ ] `POST /auth/sign-up` → `/auth/sign-in` → `/auth/refresh` → `/auth/sign-out`이 실제 Postgres 위에서 동작한다
- [ ] 회전된 리프레시 토큰은 재사용할 수 없다
- [ ] 비밀번호를 바꾸면 그 계정의 모든 세션이 끊긴다
- [ ] 주소록 CRUD와 기본 배송지 지정이 동작하고, 기본은 항상 0개 또는 1개다
- [ ] 다른 사용자의 주소는 404로 보인다 (403이 아니다)
- [ ] 가입이 계정과 고객을 한 트랜잭션에서 만든다
- [ ] BFF가 401을 만나면 조용히 갱신하고 **1회만** 재시도한다

**아키텍처**

- [ ] `pnpm arch:check`가 통과하고, `shared-knows-no-modules`·`domain-imports-no-other-module`·`no-circular`를 일부러 어기면 실패함을 확인했다
- [ ] `apps/api/src/modules/*/domain/**`에 `@nestjs`, `@prisma/client`, contracts, 그 밖의 어떤 npm import도 0건이다
- [ ] identity와 customer 사이에 순환이 없다 — identity → `customer/index.ts` 한 방향뿐이다
- [ ] `InProcessCustomerAdapter` 한 파일만 고쳐 Customer 호출 경로를 바꿀 수 있다
- [ ] 브라우저에 액세스 토큰이 한 번도 내려가지 않는다

**테스트**

- [ ] 같은 계약 테스트가 in-memory와 Prisma 리포지토리 양쪽에서 통과한다 (Account / Session / Customer)
- [ ] 동시 가입 경합에서 정확히 하나만 성공하고, 실패는 409다
- [ ] 부분 인덱스 두 개의 존재와 강제력을 자동 검사가 확인한다 (M8)
- [ ] `modules/*/domain/**` 커버리지 95% / branches 90%, `application/**` 90% / 85%
- [ ] 모든 태스크의 "이 검사가 무엇을 잡는지 증명한다" 스텝이 수행되고, 예상대로 실패하지 않은 것은 보고서에 기록됐다

**이월 처리**

- [ ] M6, M7, M8 해결
- [ ] 이월 1, 2, 7, 23, 24, 25 해결
- [ ] 새로 생긴 이월 항목이 `deferred-minors.md`에 기록됐다

---

## 다음 계획으로 넘어가는 것

- **화면** — 로그인 폼, 주소록 관리 UI, FSD `features/sign-in`·`features/manage-addresses`
- **Playwright E2E** — Route Handler와 `session.ts`를 덮는 유일한 방법
- **`IdentityProvider` 어댑터** — 소셜 로그인. 인터페이스는 이미 자리 잡았다
- **리프레시 토큰 절대 상한** — 현재는 sliding window라 활동 중인 세션이 무기한 산다. `issued_at`이 이미 있으므로 컬럼 추가 없이 넣을 수 있다
- **`OutboxRelay` 스케줄러 배선** — `AccountRegistered`가 outbox에 쌓이지만 아직 발행되지 않는다. 계획 3의 몫이다
- **계정 잠금·2FA·이메일 확인** — 스펙 §1.3의 백로그

---

## 부록 — 최종 리뷰가 계획 3(Ordering)으로 넘긴 것

이 계획의 최종 전체 리뷰(Critical 0, Important 5 — 전부 병합 전 수정)가 남긴 이월 사항이다.
수정된 I1~I5는 여기 없다. 아래는 **다음 계획이 시작할 때 제약으로 삼아야 할 것들**이다.

- **`AddressBook.remove`는 기본 배송지가 없는 상태를 남긴다** (`address-book.ts`, 의도된 동작).
  체크아웃은 "주소는 있는데 기본이 없음"을 1급 상태로 다뤄야 하고, `defaultAddress !== null`을
  가정하면 안 된다. "한 계층이 강제하는 불변식을 다른 계층이 조용히 가정한다"의 전형이라,
  계획 3의 Global Constraints에 명시적으로 적을 것.
- **액세스 토큰은 로그아웃·비밀번호 변경 후에도 TTL(15분)까지 살아 있다.** 무상태 JWT의 본질이고
  이 설계에서는 옳다(`sessions` 테이블이 주는 것은 *리프레시*의 즉시 무효화이며 그게 핵심이다).
  다만 어디에도 적혀 있지 않아, 계획 3에서 "로그아웃했는데 15분간 주문이 되는가"라는 질문이
  반드시 나온다. 스펙이나 `JwtTokenService`에 한 문장 남길 것.
- **`PassthroughTransactionManager`는 롤백하지 않는다.** 사가의 보상 동작 중 롤백에 의존하는
  것은 전부 계약 스위트의 `skipIf(runInTransaction === undefined)` 형태가 필요하다.
  태스크 N에서 발견하지 말고 처음부터 계획에 넣을 것.
- **`OutboxRelay` 배선 시 결정할 세 가지**: `relayOnce()`는 `this.prisma`를 직접 쓰고
  `FOR UPDATE SKIP LOCKED`나 어드바이저리 락이 없어 인스턴스가 둘이면 중복 발송한다 —
  문서화된 at-least-once 계약상 허용이지만, 그래서 **사가의 보상 핸들러가 진짜로 멱등해야 한다는
  것이 선택이 아니라 요구사항이 된다.** `@nestjs/schedule`은 아직 의존성이 아니다.
  `OutboxRelay` 자체는 이미 `SharedModule`에서 export되고 해석되므로 배선은 프로바이더 하나와
  cron 데코레이터다.
- **계약의 응답 맵을 단일 출처로 만드는 검사를 고려할 것.** Ordering은 라우트당 상태 코드가
  훨씬 많아진다(409 `INSUFFICIENT_STOCK`, 422 `ORDER_NOT_CANCELLABLE`, 422 `PAYMENT_DECLINED`).
  "각 라우트의 응답 맵에 선언된 상태 = 그 모듈에 등록된 `DomainError`가 낼 수 있는 상태"를
  단언하는 테스트 하나면, 이번에 두 번 따로 고쳤던 종류의 누락이 구조적으로 막힌다.
- **`toAddressView`가 서비스와 `InMemoryAddressQuery` 양쪽에 중복돼 있다.** 이번엔 무해했지만
  두 `AddressQuery` 구현이 보조 정렬에서 갈라진 기전이 바로 이 중복이다. Ordering이 두 번째
  읽기 모델을 추가할 때 합칠 것.
- **`sign-in.service.ts`가 `node:crypto`를 import한다**(더미 자격증명 생성용). 명시된 경계 규칙
  위반은 아니고 `arch:check`도 통과하지만, 애플리케이션 계층이 암호 원시연산을 아는 형태다.
  어댑터로 옮기거나 상수로 대체할지 재검토할 것.
