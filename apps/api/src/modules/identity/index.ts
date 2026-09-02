/**
 * identity 컨텍스트의 공개 API. `IdentityModule`만 내보낸다 — identity의 유스케이스를
 * 다른 모듈이 부를 일이 없다. 인증은 `shared/infrastructure/http`의 가드가 담당하고,
 * 그 가드는 커널 포트에만 의존한다.
 */
export { IdentityModule } from './identity.module';
