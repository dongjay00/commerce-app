import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { anAddressDto } from '@/shared/api/msw/fixtures';
import { AddressLine } from './AddressLine';

describe('AddressLine', () => {
  it('line2가 없으면 한 줄에 recipient·phone·zip·line1만 나온다', () => {
    const address = anAddressDto();
    render(<AddressLine address={address} />);

    expect(
      screen.getByText(
        `${address.recipient} · ${address.phone} · [${address.zip}] ${address.line1}`,
      ),
    ).toBeInTheDocument();
  });

  it('line2가 있으면 뒤에 이어붙인다', () => {
    const address = anAddressDto({ line2: '101동 202호' });
    render(<AddressLine address={address} />);

    expect(
      screen.getByText(
        `${address.recipient} · ${address.phone} · [${address.zip}] ${address.line1} 101동 202호`,
      ),
    ).toBeInTheDocument();
  });
});
