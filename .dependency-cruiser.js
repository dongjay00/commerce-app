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
        // shared/infrastructure를 반드시 포함할 것. 없으면 도메인이 '@prisma/client'라는
        // 이름을 한 번도 쓰지 않고 shared/infrastructure/prisma/prisma.service를 통해
        // ORM에 도달할 수 있다. kernel-is-pure는 이미 이 경로를 막고 있다.
        path: '(node_modules/@nestjs|node_modules/@prisma|apps/api/src/shared/infrastructure|/application/|/adapters/)',
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
      to: { path: '(/adapters/|node_modules/@prisma|apps/api/src/shared/infrastructure)' },
    },
    {
      name: 'no-cross-module-internals',
      comment: '모듈 간 참조는 공개 API(index.ts)로만',
      severity: 'error',
      from: { path: 'apps/api/src/modules/([^/]+)/' },
      // (?!$1/) 의 슬래시가 필수다 — 없으면 `order` 모듈이 `orders` 모듈 내부를
      // import해도 접두사가 일치해 통과한다.
      to: { path: 'apps/api/src/modules/(?!$1/)[^/]+/(domain|application|adapters)' },
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
      name: 'fsd-widgets-layer-direction',
      severity: 'error',
      from: { path: 'apps/web/src/widgets' },
      to: { path: 'apps/web/src/views' },
    },
    {
      // $1 = 레이어, $2 = 슬라이스. features뿐 아니라 슬라이스를 갖는 네 레이어를 모두 덮는다.
      name: 'fsd-no-cross-slice-internals',
      severity: 'error',
      from: { path: 'apps/web/src/(entities|features|widgets|views)/([^/]+)/' },
      to: { path: 'apps/web/src/$1/(?!$2/)[^/]+/(ui|model|api)' },
    },
    {
      name: 'no-server-code-in-fsd',
      comment: 'BFF 전용 코드(토큰·세션)가 FSD 레이어로 새면 안 된다',
      severity: 'error',
      from: { path: 'apps/web/src/(entities|features|widgets|views|shared)' },
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
      // 대칭 규칙이 반드시 있어야 한다. tsconfig.base.json이 `@/*`를 apps/web/src로
      // 매핑하고 apps/api가 자기 paths를 선언하지 않아 그것을 상속하므로,
      // api의 파일이 `@/shared/lib/x`를 쓰면 web으로 **해석에 성공한다**.
      // 즉 not-to-unresolvable도 잡지 못한다 — 미해결이 아니라 정상 해석이기 때문이다.
      // 반대 방향 규칙만 두면 이 경로가 통째로 무방비다.
      name: 'api-must-not-import-web',
      severity: 'error',
      from: { path: '^apps/api' },
      to: { path: '^apps/web' },
    },
    {
      name: 'contracts-is-a-leaf',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^apps/' },
    },
    {
      // 해석되지 않은 import는 그래프에 엣지를 만들지 않아 위의 모든 금지 규칙을
      // 조용히 빠져나간다 — node_modules를 exclude에 넣었을 때와 같은 무력화다.
      // 이 규칙이 그 구멍을 소리 나게 만든다.
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
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
    // `exclude`에 node_modules를 넣지 말 것. exclude는 그래프에서 해당 모듈로 향하는
    // **엣지 자체를 제거**하므로, `domain/**`이 `@nestjs/*`를 import해도 그 의존성이
    // 그래프에 존재하지 않게 되어 kernel-is-pure 규칙이 영원히 발화하지 않는다.
    // arch:check가 위반이 있는 코드베이스에서 exit 0으로 통과한다 — 아무것도 검사하지 않으면서.
    // 재귀만 멈추면 충분하고, 그건 위의 doNotFollow가 이미 한다.
    //
    // 같은 이유로 'dist'도 문자열 그대로 넣지 않는다 — enhancedResolveOptions로 exports map을
    // 읽게 하면 npm 패키지들이 흔히 'dist/'나 'dist-node/' 아래로 배포되는데(uuid가 그렇다),
    // 앵커 없는 'dist'는 node_modules 안의 그 경로까지 지워 같은 종류로 무력화한다.
    // 우리가 실제로 지우고 싶은 건 이 저장소 자신의 빌드 산출물(apps/api/dist)뿐이므로
    // 프로젝트 상대 경로 앞에만 고정한다.
    exclude: { path: '(^|/)(\\.next|coverage)(/|$)|^apps/api/dist(/|$)' },
    // dependency-cruiser는 기본적으로 package.json의 'exports' 맵을 읽지 않는다
    // (exportsFields 기본값이 []). uuid처럼 'main' 없이 'exports'만 선언한 패키지는
    // 이 옵션 없이는 couldNotResolve가 되어 not-to-unresolvable에 걸리기 전에
    // 아예 그래프에서 조용히 사라진다 — 결과적으로 모든 규칙을 우회한다.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
