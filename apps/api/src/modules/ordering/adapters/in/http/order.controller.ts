import {
  type CancelOrderResultDto,
  type ListMyOrdersQueryParams,
  listMyOrdersQuerySchema,
  type OrderDto,
  type OrderListDto,
  type PlaceOrderBody,
  type PlaceOrderResultDto,
  placeOrderBodySchema,
} from '@commerce/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import {
  CANCEL_ORDER_USECASE,
  type CancelOrderUseCase,
} from '../../../application/ports/in/cancel-order.usecase';
import {
  PLACE_ORDER_USECASE,
  type PlaceOrderUseCase,
} from '../../../application/ports/in/place-order.usecase';
import {
  GET_ORDER_QUERY,
  type GetOrderQuery,
} from '../../../application/ports/in/queries/get-order.query';
import {
  LIST_MY_ORDERS_QUERY,
  type ListMyOrdersQuery,
} from '../../../application/ports/in/queries/list-my-orders.query';
import type { OrderView } from '../../../application/ports/out/order.query';

/**
 * `OrderView` → `OrderDto`. **`customerId`를 떨어뜨린다** — 뷰에는 인가 비교용으로
 * 있지만 와이어에는 나가지 않는다.
 */
function toDto(view: OrderView): OrderDto {
  return {
    id: view.id,
    status: view.status as OrderDto['status'],
    total: { amount: view.total.amount, currency: view.total.currency as 'KRW' },
    placedAt: view.placedAt,
    shippingAddress: view.shippingAddress,
    lines: view.lines.map((line) => ({
      skuId: line.skuId,
      nameSnapshot: line.nameSnapshot,
      unitPrice: { amount: line.unitPrice.amount, currency: line.unitPrice.currency as 'KRW' },
      quantity: line.quantity,
      subtotal: { amount: line.subtotal.amount, currency: line.subtotal.currency as 'KRW' },
    })),
  };
}

@Controller('orders')
@UseGuards(AccessTokenGuard)
export class OrderController {
  constructor(
    @Inject(PLACE_ORDER_USECASE) private readonly placeOrder: PlaceOrderUseCase,
    @Inject(CANCEL_ORDER_USECASE) private readonly cancelOrder: CancelOrderUseCase,
    @Inject(GET_ORDER_QUERY) private readonly getOrder: GetOrderQuery,
    @Inject(LIST_MY_ORDERS_QUERY) private readonly listMyOrders: ListMyOrdersQuery,
  ) {}

  /**
   * 주문 생성이 곧 사가다. 결제 거절이어도 **201이다** — 주문은 만들어졌고 주문
   * 번호가 있다. 4xx로 만들면 클라이언트가 번호를 받지 못해 "다시 시도" 화면을
   * 그릴 수 없다. 본문의 `status`가 결과를 말한다.
   */
  @Post()
  @HttpCode(201)
  async place(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(placeOrderBodySchema)) body: PlaceOrderBody,
  ): Promise<PlaceOrderResultDto> {
    const result = await this.placeOrder.execute({
      customerId: principal.customerId,
      addressId: body.addressId,
    });
    return { orderId: result.orderId, status: result.status };
  }

  @Get(':orderId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('orderId') orderId: string,
  ): Promise<OrderDto> {
    return toDto(await this.getOrder.execute({ orderId, customerId: principal.customerId }));
  }

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listMyOrdersQuerySchema)) query: ListMyOrdersQueryParams,
  ): Promise<OrderListDto> {
    const orders = await this.listMyOrders.execute({
      customerId: principal.customerId,
      ...query,
    });
    return {
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status as OrderDto['status'],
        total: { amount: order.total.amount, currency: order.total.currency as 'KRW' },
        placedAt: order.placedAt,
        lineCount: order.lineCount,
      })),
    };
  }

  /**
   * 204가 아니라 200인 이유: 취소 결과가 `CANCELLED`인지 `REFUND_PENDING`인지를
   * 본문으로 돌려줘야 클라이언트가 "취소되었습니다"와 "환불 처리 중입니다"를
   * 구분해 보여줄 수 있다.
   */
  @Post(':orderId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('orderId') orderId: string,
  ): Promise<CancelOrderResultDto> {
    const result = await this.cancelOrder.execute({
      orderId,
      customerId: principal.customerId,
    });
    return { status: result.status as CancelOrderResultDto['status'] };
  }
}
