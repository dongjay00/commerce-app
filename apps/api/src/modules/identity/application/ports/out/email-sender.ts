export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * 메일 발송 포트. 스펙 §1.3대로 실제 발송은 범위 밖이고 `ConsoleEmailSender`만 만든다.
 * 포트를 지금 두는 이유는 유스케이스가 "가입하면 메일을 보낸다"는 사실을 기록해야
 * 나중에 어댑터 하나로 붙기 때문이다.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSender');
