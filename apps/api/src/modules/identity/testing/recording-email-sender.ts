import type { EmailMessage, EmailSender } from '../application/ports/out/email-sender';

export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** 발송이 실패하는 상황을 만든다 — 메일 실패가 가입을 되돌리지 않는지 확인할 때 쓴다. */
export class FailingEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    throw new Error('메일 서버에 연결할 수 없습니다.');
  }
}
