import {
  type AddCartItemBody,
  addCartItemBodySchema,
  type CartDto,
  type ChangeCartItemBody,
  changeCartItemBodySchema,
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
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { CurrentPrincipal } from '../../../../../shared/infrastructure/http/current-principal.decorator';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import {
  ADD_ITEM_TO_CART_USECASE,
  type AddItemToCartUseCase,
} from '../../../application/ports/in/add-item-to-cart.usecase';
import {
  CHANGE_CART_ITEM_QUANTITY_USECASE,
  type ChangeCartItemQuantityUseCase,
} from '../../../application/ports/in/change-cart-item-quantity.usecase';
import type { CartView } from '../../../application/ports/in/queries/get-cart.query';
import {
  GET_CART_QUERY,
  type GetCartQuery,
} from '../../../application/ports/in/queries/get-cart.query';
import {
  REMOVE_ITEM_FROM_CART_USECASE,
  type RemoveItemFromCartUseCase,
} from '../../../application/ports/in/remove-item-from-cart.usecase';

/** `CartView`(애플리케이션의 읽기 모델) → `CartDto`(와이어 계약). */
function toDto(view: CartView): CartDto {
  return {
    cartId: view.cartId,
    lines: view.lines.map((line) => ({
      skuId: line.skuId,
      nameSnapshot: line.nameSnapshot,
      unitPrice: { amount: line.unitPrice.amount, currency: line.unitPrice.currency as 'KRW' },
      quantity: line.quantity,
      subtotal: { amount: line.subtotal.amount, currency: line.subtotal.currency as 'KRW' },
    })),
    total: { amount: view.total.amount, currency: view.total.currency as 'KRW' },
    unavailableSkuIds: view.unavailableSkuIds,
  };
}

@Controller('cart')
@UseGuards(AccessTokenGuard)
export class CartController {
  constructor(
    @Inject(ADD_ITEM_TO_CART_USECASE) private readonly addItem: AddItemToCartUseCase,
    @Inject(REMOVE_ITEM_FROM_CART_USECASE) private readonly removeItem: RemoveItemFromCartUseCase,
    @Inject(CHANGE_CART_ITEM_QUANTITY_USECASE)
    private readonly changeQuantity: ChangeCartItemQuantityUseCase,
    @Inject(GET_CART_QUERY) private readonly getCart: GetCartQuery,
  ) {}

  /** 장바구니가 없어도 200이다 — 빈 장바구니 화면을 그릴 수 있어야 한다. */
  @Get()
  async get(@CurrentPrincipal() principal: Principal): Promise<CartDto> {
    return toDto(await this.getCart.execute({ customerId: principal.customerId }));
  }

  @Post('items')
  @HttpCode(204)
  async add(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(addCartItemBodySchema)) body: AddCartItemBody,
  ): Promise<void> {
    await this.addItem.execute({ customerId: principal.customerId, ...body });
  }

  /** 경로 파라미터의 uuid 검증은 값 객체가 한다 — `InvalidIdError`가 400으로 매핑돼 있다. */
  @Put('items/:skuId')
  @HttpCode(204)
  async change(
    @CurrentPrincipal() principal: Principal,
    @Param('skuId') skuId: string,
    @Body(new ZodValidationPipe(changeCartItemBodySchema)) body: ChangeCartItemBody,
  ): Promise<void> {
    await this.changeQuantity.execute({
      customerId: principal.customerId,
      skuId,
      quantity: body.quantity,
    });
  }

  @Delete('items/:skuId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('skuId') skuId: string,
  ): Promise<void> {
    await this.removeItem.execute({ customerId: principal.customerId, skuId });
  }
}
