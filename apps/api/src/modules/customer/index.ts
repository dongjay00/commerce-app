/**
 * customer 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다
 * (`no-cross-module-internals`가 강제한다).
 *
 * 리포지토리도, 애그리거트도, 도메인 예외도 내보내지 않는다. 밖에서 필요한 것은
 * "계정에 고객을 붙여라"와 "계정에 대응하는 고객을 찾아라" 둘뿐이다.
 */

export {
  PROVISION_CUSTOMER_USECASE,
  type ProvisionCustomerCommand,
  type ProvisionCustomerUseCase,
} from './application/ports/in/provision-customer.usecase';
export {
  FIND_CUSTOMER_BY_ACCOUNT_QUERY,
  type FindCustomerByAccountCommand,
  type FindCustomerByAccountQuery,
} from './application/ports/in/queries/find-customer-by-account.query';
export { CustomerModule } from './customer.module';
