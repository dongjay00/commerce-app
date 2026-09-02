import { describe, expect, it } from 'vitest';
import { ACCOUNT_REPOSITORY } from './out/account.repository';
import { CUSTOMER_DIRECTORY } from './out/customer-directory';
import { EMAIL_SENDER } from './out/email-sender';
import { IDENTITY_PROVIDER } from './out/identity-provider';
import { PASSWORD_HASHER } from './out/password-hasher';
import { SESSION_REPOSITORY } from './out/session.repository';
import { TOKEN_ISSUER } from './out/token-issuer';

/**
 * 일곱 개 포트 토큰을 값으로 임포트해 정체성을 고정한다.
 *
 * 이 포트 파일들은 인터페이스 하나와 `Symbol` 하나가 전부라, 이 파일을 쓰는 서비스가
 * 아직 없으면(태스크 7 이전) 아무 spec도 이 파일들을 값으로 로드하지 않는다. Vitest의
 * `coverage.all`이 켜져 있어 로드되지 않은 파일은 0%로 잡히고, 그러면 모듈별
 * application 디렉터리에 걸린 커버리지 임계값(라인 90 / 분기 85)이 실패한다.
 *
 * `.description` 단언이 이 파일의 핵심이다. Nest는 심볼의 **정체성**으로 의존성을
 * 해석하므로, `session.repository.ts` 안에 `Symbol('AccountRepository')`를
 * 복사-붙여넣기해도 DI 배선 자체는 (우연히 별개 심볼이라) 정상 동작한다 — 다만 그
 * 심볼이 해석에 실패할 때 에러 메시지가 엉뚱한 포트 이름을 대게 된다. 디버깅에
 * 한 시간을 태우고 흔적도 안 남기는 함정이라, 설명 문자열이 포트 이름과 정확히
 * 일치하는지를 여기서 못박는다.
 */
describe('Identity 아웃바운드 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: ACCOUNT_REPOSITORY, name: 'AccountRepository' },
    { token: SESSION_REPOSITORY, name: 'SessionRepository' },
    { token: PASSWORD_HASHER, name: 'PasswordHasher' },
    { token: TOKEN_ISSUER, name: 'TokenIssuer' },
    { token: EMAIL_SENDER, name: 'EmailSender' },
    { token: CUSTOMER_DIRECTORY, name: 'CustomerDirectory' },
    { token: IDENTITY_PROVIDER, name: 'IdentityProvider' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('일곱 토큰은 서로 다르다', () => {
    const unique = new Set(tokens.map((t) => t.token));
    expect(unique.size).toBe(tokens.length);
  });
});
