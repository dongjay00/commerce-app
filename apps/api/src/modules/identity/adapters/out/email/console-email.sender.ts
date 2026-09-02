import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from '../../../application/ports/out/email-sender';

/**
 * 개발용 메일 발송기. 스펙 §1.3대로 실제 발송은 범위 밖이다.
 *
 * 출력 함수를 생성자로 받는 이유는 테스트가 `console.log`를 스파이하지 않고도 로그
 * 내용을 검증하기 위해서다 — 목 라이브러리 금지 규칙을 지키는 형태다.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private static readonly logger = new Logger('ConsoleEmailSender');

  constructor(
    private readonly write: (line: string) => void = (line) => ConsoleEmailSender.logger.log(line),
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.write(`[메일] to=${message.to} subject=${message.subject}\n${message.body}`);
  }
}
