import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { Principal } from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from '../http/unauthenticated.error';
import { JwtTokenService } from './jwt-token.service';

const SECRET = 'test-secret-that-is-long-enough!!';
const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fd001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fd002'),
};

function service(ttl = 900): JwtTokenService {
  return new JwtTokenService({ secret: SECRET, accessTokenTtlSeconds: ttl });
}

describe('JwtTokenService', () => {
  it('발급한 토큰을 스스로 검증해 같은 principal을 되돌린다', async () => {
    // 발급과 검증이 한 클래스에 있는 이유가 이 테스트다. 두 클래스로 갈리면 비밀키나
    // 클레임 이름이 어긋나도 각자의 단위 테스트는 통과하고 통합에서만 깨진다.
    const sut = service();
    const issued = sut.issue(PRINCIPAL);

    await expect(sut.verify(issued.token)).resolves.toEqual(PRINCIPAL);
  });

  it('설정된 TTL을 그대로 알려준다', () => {
    expect(service(60).issue(PRINCIPAL).expiresInSeconds).toBe(60);
  });

  it('다른 비밀키로 서명된 토큰을 거부한다', async () => {
    const other = new JwtTokenService({
      secret: 'another-secret-long-enough-here!',
      accessTokenTtlSeconds: 900,
    });
    const token = other.issue(PRINCIPAL).token;

    await expect(service().verify(token)).rejects.toThrow(UnauthenticatedError);
  });

  it('만료된 토큰을 거부한다', async () => {
    const expired = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS256',
      expiresIn: -10,
    });

    await expect(service().verify(expired)).rejects.toThrow(UnauthenticatedError);
  });

  it('HS256이 아닌 알고리즘으로 서명된 토큰을 거부한다', async () => {
    // 알고리즘을 명시하지 않으면 라이브러리가 헤더의 alg를 믿는다.
    const hs512 = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS512',
      expiresIn: 900,
    });

    await expect(service().verify(hs512)).rejects.toThrow(UnauthenticatedError);
  });

  it('sub가 UUID가 아니면 400이 아니라 401이다', async () => {
    // AccountId.of는 InvalidIdError(400)를 던진다. 그대로 새어 나가면 "당신의 요청
    // 형식이 틀렸다"가 되는데, 실제로는 토큰이 조작된 것이므로 401이 맞다.
    const forged = jwt.sign({ cid: PRINCIPAL.customerId }, SECRET, {
      subject: 'not-a-uuid',
      algorithm: 'HS256',
      expiresIn: 900,
    });

    await expect(service().verify(forged)).rejects.toThrow(UnauthenticatedError);
  });

  it('cid 클레임이 없으면 거부한다', async () => {
    const noCid = jwt.sign({}, SECRET, {
      subject: PRINCIPAL.accountId,
      algorithm: 'HS256',
      expiresIn: 900,
    });

    await expect(service().verify(noCid)).rejects.toThrow(UnauthenticatedError);
  });

  it('토큰이 아닌 문자열을 거부한다', async () => {
    await expect(service().verify('garbage')).rejects.toThrow(UnauthenticatedError);
  });
});
