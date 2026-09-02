import { describe, expect, it } from 'vitest';
import { ACCOUNT_REPOSITORY } from './account.repository';
import { IDENTITY_PROVIDER } from './identity-provider';

describe('IdentityProvider 포트', () => {
  it('토큰이 존재하고 다른 포트 토큰과 겹치지 않는다', () => {
    // 이 포트에는 어댑터가 없다(스펙 §7.6). 그래도 토큰을 고정해 두는 이유는
    // 소셜 로그인을 붙일 때 이 파일이 이미 자리를 잡고 있다는 것을 문서화하기 위해서다.
    expect(typeof IDENTITY_PROVIDER).toBe('symbol');
    expect(IDENTITY_PROVIDER).not.toBe(ACCOUNT_REPOSITORY);
    expect(IDENTITY_PROVIDER.description).toBe('IdentityProvider');
  });
});
