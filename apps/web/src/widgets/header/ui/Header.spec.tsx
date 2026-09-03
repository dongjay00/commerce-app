import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WithAppRouter } from '../../../../test/app-router';
import { Header } from './Header';

describe('Header', () => {
  it('로그아웃 상태면 로그인 링크가 보이고 로그아웃 버튼은 없다', () => {
    render(
      <WithAppRouter>
        <Header signedIn={false} />
      </WithAppRouter>,
    );

    expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('로그인 상태면 로그아웃 버튼이 보이고 로그인 링크는 없다', () => {
    render(
      <WithAppRouter>
        <Header signedIn={true} />
      </WithAppRouter>,
    );

    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '로그인' })).not.toBeInTheDocument();
  });

  it('상품·장바구니 링크는 로그인 여부와 무관하게 항상 있다', () => {
    for (const signedIn of [false, true]) {
      const { unmount } = render(
        <WithAppRouter>
          <Header signedIn={signedIn} />
        </WithAppRouter>,
      );

      expect(screen.getByRole('link', { name: '상품' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: '장바구니' })).toHaveAttribute('href', '/cart');
      unmount();
    }
  });
});
