/**
 * 모든 도메인 예외의 기반 클래스.
 * HTTP 상태 코드를 절대 담지 않는다 — 그러면 HTTP가 아닌 경로(배치, 이벤트 핸들러)에서
 * 의미를 잃는다. 상태 코드 매핑은 인바운드 어댑터의 예외 필터가 담당한다.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
