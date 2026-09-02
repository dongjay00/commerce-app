import { describe, expect, it } from 'vitest';
import { ConsoleEmailSender } from './console-email.sender';

describe('ConsoleEmailSender', () => {
  it('수신자와 제목을 로그에 남긴다', async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((line) => lines.push(line));

    await sender.send({ to: 'user@example.com', subject: '가입을 환영합니다', body: '본문' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('user@example.com');
    expect(lines[0]).toContain('가입을 환영합니다');
  });

  it('본문도 남긴다', async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((line) => lines.push(line));
    await sender.send({ to: 'a@b.com', subject: '제목', body: '확인 링크: https://example.com/x' });
    expect(lines[0]).toContain('https://example.com/x');
  });
});
