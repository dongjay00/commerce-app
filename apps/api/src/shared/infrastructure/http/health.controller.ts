import type { healthContract } from '@commerce/contracts';
import { Controller, Get } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { PrismaService } from '../prisma/prisma.service';

// 컨트롤러의 응답 타입을 계약에서 뽑아 쓴다 — 계약이 바뀌면 손으로 쓴 타입이 아니라
// 여기가 타입체크 단계에서 먼저 깨진다. 와이어 상의 실제 응답은
// health.controller.integration.spec.ts가 계약 스키마로 파싱해 별도로 검증한다.
// (ReturnType<...['parse']>로 뽑아 쓰는 이유: apps/api는 zod에 직접 의존하지 않는다 —
//  'zod'를 값으로건 타입으로건 직접 import하면 not-to-unresolvable이 걸린다.)
type HealthResponse = ReturnType<(typeof healthContract.check.responses)[200]['parse']>;

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'ok', database: 'down' };
    }
  }
}
