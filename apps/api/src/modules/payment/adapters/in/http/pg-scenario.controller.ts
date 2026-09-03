import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  type SchemaParser,
  ValidationFailedError,
  ZodValidationPipe,
} from '../../../../../shared/infrastructure/http/zod-validation.pipe';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 생성자 주입이 깨진다.
import { FakePgAdapter, type PgScenario } from '../../out/pg/fake-pg.adapter';

const SCENARIOS: readonly PgScenario[] = ['APPROVE', 'DECLINE', 'TIMEOUT'];

interface ScenarioBody {
  scenario: PgScenario;
}

/**
 * 손으로 쓴 파서다. `zod`를 쓰지 않는 이유는 `zod-validation.pipe.ts`가 이미 적어둔
 * 것과 같다 — `apps/api`의 package.json에 `zod`가 없어 값으로건 타입으로건 import하면
 * dependency-cruiser의 `not-to-unresolvable`에 걸린다(실제로 확인했다). 파이프가
 * 요구하는 것은 `parse` 하나뿐이므로 구조적 타입으로 충분하다.
 *
 * `ValidationFailedError`를 직접 던진다: 파이프는 zod 모양이 아닌 오류(`issues` 배열이
 * 없는 것)를 그대로 다시 던지고, `DomainExceptionFilter`가 그것을 400
 * `VALIDATION_FAILED`로 옮긴다.
 */
const scenarioBodySchema: SchemaParser<ScenarioBody> = {
  parse: (input: unknown): ScenarioBody => {
    if (typeof input !== 'object' || input === null) {
      throw new ValidationFailedError('요청 본문이 객체가 아닙니다.');
    }
    const keys = Object.keys(input);
    // strict: 모르는 키를 조용히 버리지 않는다. E2E가 키 이름을 잘못 쓰면
    // 시나리오가 바뀌지 않은 채 204가 나가고, 테스트는 엉뚱한 경로를 돈다.
    const unknownKey = keys.find((key) => key !== 'scenario');
    if (unknownKey !== undefined) {
      throw new ValidationFailedError(`알 수 없는 필드입니다: ${unknownKey}`);
    }
    const { scenario } = input as { scenario?: unknown };
    if (!SCENARIOS.includes(scenario as PgScenario)) {
      throw new ValidationFailedError(`scenario: ${SCENARIOS.join(' | ')} 중 하나여야 합니다.`);
    }
    return { scenario: scenario as PgScenario };
  },
};

/**
 * **테스트 전용이다.** `ENABLE_TEST_ENDPOINTS === 'true'`일 때만 모듈에 등록된다 —
 * `payment.module.ts`의 조건부 `controllers` 배열이 그것을 정한다.
 *
 * 존재 이유: 브라우저 E2E가 결제 거절 보상 경로를 밟으려면 PG 시나리오를 바꿔야
 * 하는데, `FakePgAdapter.scenario`는 Nest 프로세스 안의 상태라 HTTP 밖에서
 * 건드릴 방법이 없다(스펙 §9.10이 `api.fakePg.setScenario`를 요구한다).
 *
 * 버린 대안: 매직 금액(999원이면 거절). 프로덕션 경로의 입력값에 테스트용 의미를
 * 심으면 실서비스에서 그 금액을 결제하는 고객이 거절당한다.
 *
 * `shared/infrastructure/testing/`이 아니라 여기 있는 이유: dependency-cruiser의
 * `shared-knows-no-modules`가 `shared/*`에서 `modules/*`로 가는 import를 금지한다.
 * 이 컨트롤러는 `FakePgAdapter`를 주입받아야 하므로 payment 모듈의 인바운드 어댑터로
 * 두는 것이 유일하게 규칙을 지키는 위치이고, 실제로 하는 일(결제 어댑터의 상태를
 * 바꾼다)과도 맞는다. `PgWebhookController` 바로 옆이다.
 *
 * **위험**: 운영 환경에 `ENABLE_TEST_ENDPOINTS=true`가 실수로 켜지면 누구나 결제
 * 시나리오를 바꿀 수 있다. 그래서 `.env.example`에 이 변수를 넣지 않는다 —
 * 값을 아는 사람만 켤 수 있게 하는 것이 아니라, **그런 변수가 있다는 사실 자체를
 * 배포 설정에서 감춘다.** 진짜 방어는 배포 파이프라인이 이 변수를 금지하는 것이고,
 * 그것은 CI가 붙는 시점의 일이다.
 */
@Controller('testing')
export class PgScenarioController {
  constructor(private readonly pg: FakePgAdapter) {}

  /** **가드가 없다.** E2E가 토큰 없이 부른다. 위 주석의 플래그가 유일한 방어선이다. */
  @Post('pg-scenario')
  @HttpCode(204)
  setScenario(@Body(new ZodValidationPipe(scenarioBodySchema)) body: ScenarioBody): void {
    this.pg.scenario = body.scenario;
  }
}
