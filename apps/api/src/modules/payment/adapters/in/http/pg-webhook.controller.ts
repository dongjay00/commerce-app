import {
  type PgCallbackBody,
  type PgCallbackResult,
  pgCallbackBodySchema,
} from '@commerce/contracts';
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
