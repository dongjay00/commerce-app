import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다.
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import { registerCatalogDomainErrors } from './adapters/in/http/catalog-domain-error-mappings';
import { ProductController } from './adapters/in/http/product.controller';
import { PrismaProductQuery } from './adapters/out/persistence/prisma-product.query';
import { PrismaProductRepository } from './adapters/out/persistence/prisma-product.repository';
import { FIND_SKU_PRICES_QUERY } from './application/ports/in/queries/find-sku-prices.query';
import { GET_PRODUCT_QUERY } from './application/ports/in/queries/get-product.query';
import { SEARCH_PRODUCTS_QUERY } from './application/ports/in/queries/search-products.query';
import { REGISTER_PRODUCT_USECASE } from './application/ports/in/register-product.usecase';
import { UPDATE_PRICE_USECASE } from './application/ports/in/update-price.usecase';
import { PRODUCT_QUERY, type ProductQuery } from './application/ports/out/product.query';
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from './application/ports/out/product.repository';
import { FindSkuPricesService } from './application/services/find-sku-prices.service';
import { GetProductService } from './application/services/get-product.service';
import { RegisterProductService } from './application/services/register-product.service';
import { SearchProductsService } from './application/services/search-products.service';
import { UpdatePriceService } from './application/services/update-price.service';

@Module({
  controllers: [ProductController],
  providers: [
    {
      provide: PRODUCT_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaProductRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: PRODUCT_QUERY,
      useFactory: (prisma: PrismaService) => new PrismaProductQuery(prisma),
      inject: [PrismaService],
    },
    {
      // 생성자: RegisterProductService(products, transactions, clock, ids)
      provide: REGISTER_PRODUCT_USECASE,
      useFactory: (
        products: ProductRepository,
        transactions: TransactionManager,
        clock: Clock,
        ids: IdGenerator,
      ) => new RegisterProductService(products, transactions, clock, ids),
      inject: [PRODUCT_REPOSITORY, TRANSACTION_MANAGER, CLOCK, ID_GENERATOR],
    },
    {
      // 생성자: UpdatePriceService(products, transactions)
      provide: UPDATE_PRICE_USECASE,
      useFactory: (products: ProductRepository, transactions: TransactionManager) =>
        new UpdatePriceService(products, transactions),
      inject: [PRODUCT_REPOSITORY, TRANSACTION_MANAGER],
    },
    {
      provide: GET_PRODUCT_QUERY,
      useFactory: (query: ProductQuery) => new GetProductService(query),
      inject: [PRODUCT_QUERY],
    },
    {
      provide: FIND_SKU_PRICES_QUERY,
      useFactory: (query: ProductQuery) => new FindSkuPricesService(query),
      inject: [PRODUCT_QUERY],
    },
    {
      provide: SEARCH_PRODUCTS_QUERY,
      useFactory: (query: ProductQuery) => new SearchProductsService(query),
      inject: [PRODUCT_QUERY],
    },
  ],
  exports: [FIND_SKU_PRICES_QUERY],
})
export class CatalogModule {
  constructor(registry: DomainErrorRegistry) {
    registerCatalogDomainErrors(registry);
  }
}
