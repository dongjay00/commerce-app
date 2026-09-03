/**
 * payment 컨텍스트의 공개 API. 다른 모듈은 **이 파일만** import할 수 있다
 * (`no-cross-module-internals`가 강제한다).
 *
 * Ordering의 `InProcessPaymentAdapter`가 부를 것은 `AuthorizePaymentUseCase` 하나다.
 * `RefundPaymentUseCase`는 같은 모듈의 이벤트 구독 어댑터가 쓰지만, 계획 5 이후
 * 관리자 환불 화면이 붙을 자리이므로 함께 내보낸다.
 *
 * `PaymentRepository`도 `Payment` 애그리거트도 내보내지 않는다 — 다른 모듈이 결제
 * 상태를 직접 만지면 상태 머신의 주인이 사라진다.
 *
 * `FakePgAdapter`는 내보내지 않는다. E2E는 Nest DI 컨테이너에서 클래스 토큰으로
 * 꺼내므로 모듈 경계를 넘는 import가 필요 없다.
 */
export {
  AUTHORIZE_PAYMENT_USECASE,
  type AuthorizePaymentCommand,
  type AuthorizePaymentResult,
  type AuthorizePaymentUseCase,
} from './application/ports/in/authorize-payment.usecase';
export {
  REFUND_PAYMENT_USECASE,
  type RefundPaymentCommand,
  type RefundPaymentUseCase,
} from './application/ports/in/refund-payment.usecase';
export { PaymentModule } from './payment.module';
