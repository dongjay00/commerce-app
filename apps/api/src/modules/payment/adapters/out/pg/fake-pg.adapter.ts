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
    return [...this.refunded];
  }
}
