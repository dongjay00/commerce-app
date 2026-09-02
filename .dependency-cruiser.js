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
    exclude: { path: '(\\.next|dist|coverage)' },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
