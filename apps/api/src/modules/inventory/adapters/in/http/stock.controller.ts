import {
  type RegisterStockBody,
  type RestockBody,
  registerStockBodySchema,
  restockBodySchema,
  type StockDto,
} from '@commerce/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import {
  GET_STOCK_QUERY,
  type GetStockQuery,
  type StockView,
} from '../../../application/ports/in/queries/get-stock.query';
import {
  REGISTER_STOCK_USECASE,
  type RegisterStockUseCase,
} from '../../../application/ports/in/register-stock.usecase';
import {
  RESTOCK_USECASE,
  type RestockUseCase,
} from '../../../application/ports/in/restock.usecase';

/** `StockView`(애플리케이션의 읽기 모델) → `StockDto`(와이어 계약). */
function toDto(view: StockView): StockDto {
  return {
    skuId: view.skuId,
    onHand: view.onHand,
    reserved: view.reserved,
    available: view.available,
  };
}

@Controller('stock')
export class StockController {
  constructor(
    @Inject(REGISTER_STOCK_USECASE) private readonly registerStock: RegisterStockUseCase,
    @Inject(RESTOCK_USECASE) private readonly restock: RestockUseCase,
    @Inject(GET_STOCK_QUERY) private readonly getStock: GetStockQuery,
  ) {}

  /**
   * 재고 행이 없으면 `ReserveStock`이 `StockNotFoundError`를 낸다. 계획 4의 E2E가
   * "상품 등록 → 재고 등록 → 주문"을 밟으려면 이 엔드포인트가 필요하다.
   *
   * 상품 등록과 같은 이유로 **인증만 걸고 인가는 걸지 않는다** — 이 프로젝트에는
   * 역할(role) 개념이 없다(편차 3). 역할 기반 인가는 백로그다.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(AccessTokenGuard)
  async register(
    @Body(new ZodValidationPipe(registerStockBodySchema)) body: RegisterStockBody,
  ): Promise<StockDto> {
    await this.registerStock.execute(body);
    return toDto(await this.getStock.execute({ skuId: body.skuId }));
  }

  /** 등록과 같은 이유로 인증만 건다. */
  @Post(':skuId/restock')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async addStock(
    @Param('skuId') skuId: string,
    @Body(new ZodValidationPipe(restockBodySchema)) body: RestockBody,
  ): Promise<void> {
    await this.restock.execute({ skuId, quantity: body.quantity });
  }

  /**
   * 조회에도 가드를 건다 — 상품 목록과 달리 재고 수량은 영업 정보다.
   * 계약의 응답 맵에 401이 들어 있는 것이 그 결정의 기록이다.
   */
  @Get(':skuId')
  @UseGuards(AccessTokenGuard)
  async get(@Param('skuId') skuId: string): Promise<StockDto> {
    return toDto(await this.getStock.execute({ skuId }));
  }
}
