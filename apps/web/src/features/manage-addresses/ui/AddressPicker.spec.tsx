import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { anAddressDto } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { AddressPicker } from './AddressPicker';

describe('AddressPicker', () => {
  it('주소 목록이 라디오로 보인다', () => {
    const addresses = [
      anAddressDto(),
      anAddressDto({ id: '018f2b1c-4a5d-7e6f-8a9b-0f1e00000002' }),
    ];
    render(<AddressPicker addresses={addresses} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('고르면 onSelect가 그 id로 불린다', () => {
    const address = anAddressDto();
    const onSelect = vi.fn();
    render(<AddressPicker addresses={[address]} selectedId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('radio'));

    expect(onSelect).toHaveBeenCalledWith(address.id);
  });

  it('주소가 없으면 안내와 폼만 보인다', () => {
    render(<AddressPicker addresses={[]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('배송지를 추가해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('받는 사람')).toBeInTheDocument();
  });

  it('폼을 제출하면 새 주소가 만들어지고 onSelect와 onAdded가 불린다', async () => {
    const created = anAddressDto({ id: '018f2b1c-4a5d-7e6f-8a9b-0f1e00000003' });
    server.use(http.post('/api/addresses', () => HttpResponse.json(created, { status: 200 })));
    const onSelect = vi.fn();
    const onAdded = vi.fn();
    render(
      <AddressPicker addresses={[]} selectedId={null} onSelect={onSelect} onAdded={onAdded} />,
    );

    fireEvent.change(screen.getByLabelText('받는 사람'), { target: { value: '홍길동' } });
    fireEvent.change(screen.getByLabelText('연락처'), { target: { value: '010-1234-5678' } });
    fireEvent.change(screen.getByLabelText('우편번호'), { target: { value: '06236' } });
    fireEvent.change(screen.getByLabelText('주소'), {
      target: { value: '서울시 강남구 테헤란로 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '배송지 추가' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(created.id));
    expect(onAdded).toHaveBeenCalledTimes(1);
  });
});
