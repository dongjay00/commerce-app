import { describe, expect, it } from 'vitest';
import { MANAGE_ADDRESSES_USECASE } from './in/manage-addresses.usecase';
import { PROVISION_CUSTOMER_USECASE } from './in/provision-customer.usecase';
import { GET_ADDRESS_BOOK_QUERY } from './in/queries/get-address-book.query';
import { ADDRESS_QUERY } from './out/address.query';
import { CUSTOMER_REPOSITORY } from './out/customer.repository';

/**
 * 다섯 개 포트 토큰을 값으로 임포트해 정체성을 고정한다.
 *
 * 이 포트 파일들은 인터페이스 하나와 `Symbol` 하나가 전부라, 이 파일을 쓰는 서비스가
 * 아직 없으면(태스크 13 이전) 아무 spec도 이 파일들을 값으로 로드하지 않는다. Vitest의
 * `coverage.all`이 켜져 있어 로드되지 않은 파일은 0%로 잡히고, 그러면 모듈별
 * application 디렉터리에 걸린 커버리지 임계값(라인 90 / 분기 85)이 실패한다.
 *
 * `.description` 단언이 이 파일의 핵심이다. Nest는 심볼의 **정체성**으로 의존성을
 * 해석하므로, 다른 포트 파일 안에 `Symbol('CustomerRepository')`를 복사-붙여넣기해도
 * DI 배선 자체는 (우연히 별개 심볼이라) 정상 동작한다 — 다만 그 심볼이 해석에 실패할
 * 때 에러 메시지가 엉뚱한 포트 이름을 대게 된다. 디버깅에 한 시간을 태우고 흔적도 안
 * 남기는 함정이라, 설명 문자열이 포트 이름과 정확히 일치하는지를 여기서 못박는다.
 */
describe('Customer 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: CUSTOMER_REPOSITORY, name: 'CustomerRepository' },
    { token: ADDRESS_QUERY, name: 'AddressQuery' },
    { token: PROVISION_CUSTOMER_USECASE, name: 'ProvisionCustomerUseCase' },
    { token: MANAGE_ADDRESSES_USECASE, name: 'ManageAddressesUseCase' },
    { token: GET_ADDRESS_BOOK_QUERY, name: 'GetAddressBookQuery' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('다섯 토큰은 서로 다르다', () => {
    const unique = new Set(tokens.map((t) => t.token));
    expect(unique.size).toBe(tokens.length);
  });
});
