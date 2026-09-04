import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aCartDto } from '@/shared/api/msw/fixtures';
import { CartLineRow } from './CartLineRow';

describe('CartLineRow', () => {
  it('이름·단가·수량·소계를 보여준다', () => {
    const [line] = aCartDto().lines;
    if (line === undefined) throw new Error('fixture must have a line');

    render(
      <table>
        <tbody>
          <CartLineRow line={line} />
        </tbody>
      </table>,
    );

    expect(screen.getByText(line.nameSnapshot)).toBeInTheDocument();
    expect(screen.getByText('12,000원')).toBeInTheDocument();
    expect(screen.getByText('2개')).toBeInTheDocument();
    expect(screen.getByText('24,000원')).toBeInTheDocument();
  });

  it('action을 주면 그 노드를 렌더한다', () => {
    const [line] = aCartDto().lines;
    if (line === undefined) throw new Error('fixture must have a line');

    render(
      <table>
        <tbody>
          <CartLineRow line={line} action={<button type="button">빼기</button>} />
        </tbody>
      </table>,
    );

    expect(screen.getByRole('button', { name: '빼기' })).toBeInTheDocument();
  });

  it('action을 주지 않으면 액션 셀이 없다', () => {
    const [line] = aCartDto().lines;
    if (line === undefined) throw new Error('fixture must have a line');

    render(
      <table>
        <tbody>
          <CartLineRow line={line} />
        </tbody>
      </table>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
