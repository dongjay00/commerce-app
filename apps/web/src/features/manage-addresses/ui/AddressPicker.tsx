'use client';

import type { AddressBody, AddressDto } from '@commerce/contracts';
import { type FormEvent, useState } from 'react';
import { AddressLine } from '@/entities/address';
import { useAddAddress } from '../model/use-add-address';

const EMPTY: AddressBody = {
  label: '기본 배송지',
  recipient: '',
  phone: '',
  zip: '',
  line1: '',
};

/**
 * `label`을 폼에서 받지 않는 이유: 계약이 요구하는 필드지만 사용자에게 물을 가치가
 * 없다. 주소록 관리 화면이 생기면 그때 편집 가능하게 만든다(범위 절).
 *
 * 라벨 문자열(`받는 사람`·`연락처`·`우편번호`·`주소`·`배송지 추가`)은
 * 태스크 14의 E2E와의 계약이다 — 바꾸지 않는다.
 */
export function AddressPicker({
  addresses,
  selectedId,
  onSelect,
  onAdded,
}: {
  addresses: AddressDto[];
  selectedId: string | null;
  onSelect: (addressId: string) => void;
  onAdded?: () => void;
}) {
  const { addAddress, pending, error } = useAddAddress();
  const [draft, setDraft] = useState<AddressBody>(EMPTY);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const created = await addAddress(draft);
    if (created === null) {
      return;
    }
    // 방금 만든 주소를 바로 고른다 — 안 그러면 사용자가 주문 버튼을 누를 수 없다.
    onSelect(created.id);
    setDraft(EMPTY);
    onAdded?.();
  }

  const field = (key: keyof Omit<AddressBody, 'label' | 'line2'>, label: string) => (
    <label key={key}>
      {label}
      <input
        name={key}
        required
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <section>
      {addresses.length === 0 ? (
        <p>배송지를 추가해 주세요.</p>
      ) : (
        <ul>
          {addresses.map((address) => (
            <li key={address.id}>
              <label>
                <input
                  type="radio"
                  name="addressId"
                  value={address.id}
                  checked={selectedId === address.id}
                  onChange={() => onSelect(address.id)}
                />
                <AddressLine address={address} />
              </label>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit}>
        {field('recipient', '받는 사람')}
        {field('phone', '연락처')}
        {field('zip', '우편번호')}
        {field('line1', '주소')}
        {error === null ? null : <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? '추가 중…' : '배송지 추가'}
        </button>
      </form>
    </section>
  );
}
