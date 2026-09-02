import { describe, expect, it } from 'vitest';
import {
  changePasswordBodySchema,
  refreshBodySchema,
  sessionTokensSchema,
  signInBodySchema,
  signUpBodySchema,
} from './auth.contract';

describe('sessionTokensSchema', () => {
  const valid = { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 };

  it('정상 응답을 파싱한다', () => {
    expect(sessionTokensSchema.parse(valid)).toEqual(valid);
  });

  it('계약에 없는 필드를 거부한다', () => {
    // 이것이 이 테스트의 이유다. non-strict 스키마는 서버가 계약에 없는 필드를
    // 흘려보내도 조용히 통과시킨다 — 드리프트가 한 방향으로만 잡힌다.
    // 특히 accessToken 옆에 refreshToken 같은 비밀이 실수로 추가되는 경우를 막는다.
    expect(() => sessionTokensSchema.parse({ ...valid, accountId: 'leaked' })).toThrow();
  });

  it('expiresInSeconds는 양의 정수여야 한다', () => {
    expect(() => sessionTokensSchema.parse({ ...valid, expiresInSeconds: 900.5 })).toThrow();
    expect(() => sessionTokensSchema.parse({ ...valid, expiresInSeconds: 0 })).toThrow();
  });
});

describe('signUpBodySchema', () => {
  it('이메일 형식을 강제한다', () => {
    expect(() =>
      signUpBodySchema.parse({ email: 'not-an-email', password: 'x'.repeat(12) }),
    ).toThrow();
  });

  it('비밀번호 길이 정책은 강제하지 않는다 — 도메인의 몫이다', () => {
    // 스펙 §8.4: Zod에 .min(10)을 붙이는 순간 "10자 이상"이라는 규칙이 도메인 밖으로 샌다.
    // Zod는 형식(문자열인가, 전송 상한을 넘지 않는가)만 본다.
    expect(() => signUpBodySchema.parse({ email: 'a@b.com', password: 'short' })).not.toThrow();
  });

  it('전송 상한(1024자)은 막는다 — 이건 형식이지 정책이 아니다', () => {
    expect(() =>
      signUpBodySchema.parse({ email: 'a@b.com', password: 'x'.repeat(1025) }),
    ).toThrow();
  });

  it('추가 필드를 거부한다', () => {
    expect(() =>
      signUpBodySchema.parse({ email: 'a@b.com', password: 'x'.repeat(12), role: 'admin' }),
    ).toThrow();
  });
});

describe('signInBodySchema / refreshBodySchema / changePasswordBodySchema', () => {
  it('signIn은 이메일과 비밀번호를 요구한다', () => {
    expect(signInBodySchema.parse({ email: 'a@b.com', password: 'p' })).toEqual({
      email: 'a@b.com',
      password: 'p',
    });
  });

  it('refresh는 빈 리프레시 토큰을 거부한다', () => {
    expect(() => refreshBodySchema.parse({ refreshToken: '' })).toThrow();
  });

  it('changePassword는 현재/새 비밀번호를 모두 요구한다', () => {
    expect(() => changePasswordBodySchema.parse({ newPassword: 'x'.repeat(12) })).toThrow();
  });
});
