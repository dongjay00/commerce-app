import {
  type ProductDto,
  type ProductListDto,
  type RegisterProductBody,
  registerProductBodySchema,
  type SearchProductsQueryParams,
  searchProductsQuerySchema,
  type UpdatePriceBody,
  updatePriceBodySchema,
} from '@commerce/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../../../../shared/infrastructure/http/access-token.guard';
import { ZodValidationPipe } from '../../../../../shared/infrastructure/http/zod-validation.pipe';
import {
  GET_PRODUCT_QUERY,
  type GetProductQuery,
} from '../../../application/ports/in/queries/get-product.query';
import {
  SEARCH_PRODUCTS_QUERY,
  type SearchProductsQuery,
} from '../../../application/ports/in/queries/search-products.query';
import {
  REGISTER_PRODUCT_USECASE,
  type RegisterProductUseCase,
} from '../../../application/ports/in/register-product.usecase';
import {
  UPDATE_PRICE_USECASE,
  type UpdatePriceUseCase,
} from '../../../application/ports/in/update-price.usecase';
import type { ProductView } from '../../../application/ports/out/product.query';

/**
 * `ProductView`(애플리케이션의 읽기 모델) → `ProductDto`(와이어 계약).
 * 지금은 모양이 거의 같지만, 계약이 갈라지는 순간 이 함수만 바뀐다.
 */
function toDto(view: ProductView): ProductDto {
  return {
    id: view.id,
    name: view.name,
    status: view.status as ProductDto['status'],
    skus: view.skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      price: { amount: sku.amount, currency: sku.currency as 'KRW' | 'USD' },
    })),
  };
}

@Controller('products')
export class ProductController {
  constructor(
    @Inject(REGISTER_PRODUCT_USECASE) private readonly registerProduct: RegisterProductUseCase,
    @Inject(UPDATE_PRICE_USECASE) private readonly updatePrice: UpdatePriceUseCase,
    @Inject(GET_PRODUCT_QUERY) private readonly getProduct: GetProductQuery,
    @Inject(SEARCH_PRODUCTS_QUERY) private readonly searchProducts: SearchProductsQuery,
  ) {}

  /**
   * 스펙 §5.5는 "관리자만 상품 등록 가능"을 어댑터 가드의 예로 들지만, 이 프로젝트에는
   * 역할(role) 개념이 없다 — `Principal`은 `accountId`와 `customerId`만 갖는다.
   * **인증만 걸고 인가는 걸지 않는다.** 역할을 지금 만들면 Identity의 계정 모델로
   * 되돌아가야 하고 그것은 계획 3의 범위 밖이다. 역할 기반 인가는 백로그다.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(AccessTokenGuard)
  async register(
    @Body(new ZodValidationPipe(registerProductBodySchema)) body: RegisterProductBody,
  ): Promise<ProductDto> {
    const { productId } = await this.registerProduct.execute(body);
    return toDto(await this.getProduct.execute({ productId }));
  }

  /** 등록과 같은 이유로 인증만 건다. */
  @Put(':productId/skus/:skuId/price')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async changePrice(
    @Param('productId') productId: string,
    @Param('skuId') skuId: string,
    @Body(new ZodValidationPipe(updatePriceBodySchema)) body: UpdatePriceBody,
  ): Promise<void> {
    await this.updatePrice.execute({ productId, skuId, price: body.price });
  }

  /** 조회에는 가드를 걸지 않는다 — 상품 목록은 로그인 없이 볼 수 있어야 한다. */
  @Get(':productId')
  async get(@Param('productId') productId: string): Promise<ProductDto> {
    return toDto(await this.getProduct.execute({ productId }));
  }

  @Get()
  async search(
    @Query(new ZodValidationPipe(searchProductsQuerySchema)) query: SearchProductsQueryParams,
  ): Promise<ProductListDto> {
    const views = await this.searchProducts.execute(query);
    return { products: views.map(toDto) };
  }
}
