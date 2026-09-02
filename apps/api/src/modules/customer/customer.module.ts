import { Module } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 모듈 생성자 주입이 깨진다. (PrismaService는 아래 inject 배열에서 값으로도 쓰여 이미 안전하다)
import { DomainErrorRegistry } from '../../shared/infrastructure/http/domain-error.registry';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { CLOCK, type Clock } from '../../shared/kernel/ports/clock';
import { ID_GENERATOR, type IdGenerator } from '../../shared/kernel/ports/id-generator';
import {
  TRANSACTION_MANAGER,
  type TransactionManager,
} from '../../shared/kernel/ports/transaction-manager';
import { AddressController } from './adapters/in/http/address.controller';
import { registerCustomerDomainErrors } from './adapters/in/http/customer-domain-error-mappings';
import { PrismaAddressQuery } from './adapters/out/persistence/prisma-address.query';
import { PrismaCustomerRepository } from './adapters/out/persistence/prisma-customer.repository';
import { MANAGE_ADDRESSES_USECASE } from './application/ports/in/manage-addresses.usecase';
import { PROVISION_CUSTOMER_USECASE } from './application/ports/in/provision-customer.usecase';
import { FIND_CUSTOMER_BY_ACCOUNT_QUERY } from './application/ports/in/queries/find-customer-by-account.query';
import { GET_ADDRESS_BOOK_QUERY } from './application/ports/in/queries/get-address-book.query';
import { ADDRESS_QUERY, type AddressQuery } from './application/ports/out/address.query';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from './application/ports/out/customer.repository';
import { FindCustomerByAccountService } from './application/services/find-customer-by-account.service';
import { GetAddressBookService } from './application/services/get-address-book.service';
import { ManageAddressesService } from './application/services/manage-addresses.service';
import { ProvisionCustomerService } from './application/services/provision-customer.service';

@Module({
  controllers: [AddressController],
  providers: [
    {
      provide: CUSTOMER_REPOSITORY,
      useFactory: (prisma: PrismaService) => new PrismaCustomerRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: ADDRESS_QUERY,
      useFactory: (prisma: PrismaService) => new PrismaAddressQuery(prisma),
      inject: [PrismaService],
    },
    {
      provide: PROVISION_CUSTOMER_USECASE,
      useFactory: (customers: CustomerRepository, clock: Clock, ids: IdGenerator) =>
        new ProvisionCustomerService(customers, clock, ids),
      inject: [CUSTOMER_REPOSITORY, CLOCK, ID_GENERATOR],
    },
    {
      provide: MANAGE_ADDRESSES_USECASE,
      useFactory: (
        customers: CustomerRepository,
        transactions: TransactionManager,
        ids: IdGenerator,
      ) => new ManageAddressesService(customers, transactions, ids),
      inject: [CUSTOMER_REPOSITORY, TRANSACTION_MANAGER, ID_GENERATOR],
    },
    {
      provide: GET_ADDRESS_BOOK_QUERY,
      useFactory: (addresses: AddressQuery) => new GetAddressBookService(addresses),
      inject: [ADDRESS_QUERY],
    },
    {
      provide: FIND_CUSTOMER_BY_ACCOUNT_QUERY,
      useFactory: (customers: CustomerRepository) => new FindCustomerByAccountService(customers),
      inject: [CUSTOMER_REPOSITORY],
    },
  ],
  // identity가 ACL 어댑터에서 쓴다. 리포지토리는 내보내지 않는다 —
  // 다른 모듈이 우리 애그리거트를 직접 만지면 불변식의 주인이 사라진다.
  exports: [PROVISION_CUSTOMER_USECASE, FIND_CUSTOMER_BY_ACCOUNT_QUERY],
})
export class CustomerModule {
  constructor(registry: DomainErrorRegistry) {
    registerCustomerDomainErrors(registry);
  }
}
