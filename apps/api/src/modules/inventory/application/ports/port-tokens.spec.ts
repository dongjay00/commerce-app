import { describe, expect, it } from 'vitest';
import { CONFIRM_RESERVATION_USECASE } from './in/confirm-reservation.usecase';
import { EXPIRE_RESERVATIONS_USECASE } from './in/expire-reservations.usecase';
import { RELEASE_RESERVATION_USECASE } from './in/release-reservation.usecase';
import { RESERVE_STOCK_USECASE } from './in/reserve-stock.usecase';
import { RESERVATION_REPOSITORY } from './out/reservation.repository';
import { STOCK_REPOSITORY } from './out/stock.repository';

/**
 * 포트 토큰의 정체성을 고정한다.
 *
 * 커버리지: 포트 파일은 인터페이스와 `Symbol` 하나가 전부라 `import type`으로만
 * 쓰이면 런타임에 로드되지 않고, Vitest의 `coverage.all`이 켜져 있어 0%로 잡혀
 * application 임계값(90/85)을 실패시킨다.
 *
 * 본론: Nest는 심볼의 **정체성**으로 해석하므로 다른 포트 파일에
 * `Symbol('StockRepository')`를 복붙해도 배선은 동작한다 — 다만 해석 실패 메시지가
 * 엉뚱한 포트 이름을 댄다. 한 시간을 태우고 흔적도 안 남기는 함정이다.
 *
 * 태스크 8·9·14가 인바운드 토큰을 더할 때마다 이 목록을 확장한다.
 */
describe('Inventory 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: STOCK_REPOSITORY, name: 'StockRepository' },
    { token: RESERVATION_REPOSITORY, name: 'ReservationRepository' },
    { token: RESERVE_STOCK_USECASE, name: 'ReserveStockUseCase' },
    { token: CONFIRM_RESERVATION_USECASE, name: 'ConfirmReservationUseCase' },
    { token: RELEASE_RESERVATION_USECASE, name: 'ReleaseReservationUseCase' },
    { token: EXPIRE_RESERVATIONS_USECASE, name: 'ExpireReservationsUseCase' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('토큰들은 서로 다르다', () => {
    expect(new Set(tokens.map((t) => t.token)).size).toBe(tokens.length);
  });
});
