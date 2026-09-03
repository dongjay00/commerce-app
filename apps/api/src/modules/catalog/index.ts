/**
 * catalog 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다
 * (`no-cross-module-internals`가 강제한다).
 *
 * 지금은 모듈만 내보낸다. 계획 4의 Ordering이 가격 ACL(`CatalogPriceProvider`)을
 * 붙일 때 SKU 가격 조회 포트를 여기에 더한다 — 호출자가 없는 조회 메서드를 미리
 * 만들지 않는다.
 */
export { CatalogModule } from './catalog.module';
