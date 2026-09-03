import type { AddressDto } from '@commerce/contracts';

export function AddressLine({ address }: { address: AddressDto }) {
  return (
    <span>
      {address.recipient} · {address.phone} · [{address.zip}] {address.line1}
      {address.line2 === undefined ? '' : ` ${address.line2}`}
    </span>
  );
}
