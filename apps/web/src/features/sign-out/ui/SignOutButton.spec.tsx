import { ErrorCode } from '@commerce/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/shared/api/msw/server';
import { stubRouter, WithAppRouter } from '../../../../test/app-router';
import { SignOutButton } from './SignOutButton';

describe('SignOutButton', () => {
  it('누르면 onSignedOut이 불린다', async () => {
    const onSignedOut = vi.fn();
    render(
      <WithAppRouter>
        <SignOutButton onSignedOut={onSignedOut} />
      </WithAppRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it('실패해도 onSignedOut이 불리고 경고 문구는 없다', async () => {
    // 실패를 알려도 사용자가 할 수 있는 일이 없다 — 로그아웃된 화면으로 보내는 것이 맞다.
    server.use(
      http.post('/api/auth/sign-out', () =>
        HttpResponse.json({ code: ErrorCode.UNAUTHENTICATED, message: 'x' }, { status: 401 }),
      ),
    );
    const onSignedOut = vi.fn();
    render(
      <WithAppRouter>
        <SignOutButton onSignedOut={onSignedOut} />
      </WithAppRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('서버가 만든 signedIn을 다시 읽도록 refresh를 부른다', async () => {
    // 이것이 없으면 로그아웃한 뒤에도 헤더에 "로그아웃"이 남는다.
    const refresh = vi.fn();
    render(
      <WithAppRouter router={stubRouter({ refresh })}>
        <SignOutButton />
      </WithAppRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
