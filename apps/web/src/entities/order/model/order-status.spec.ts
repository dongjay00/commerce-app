import { orderStatusSchema } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { isOrderCancellable, ORDER_STATUS_LABELS, orderStatusLabel } from './order-status';

describe('orderStatusLabel', () => {
  it('상태를 한국어로 옮긴다', () => {
    expect(orderStatusLabel('PENDING_PAYMENT')).toBe('결제 대기');
    expect(orderStatusLabel('PAID')).toBe('결제 완료');
    expect(orderStatusLabel('PAYMENT_FAILED')).toBe('결제 실패');
    expect(orderStatusLabel('CANCELLED')).toBe('취소됨');
    expect(orderStatusLabel('REFUND_PENDING')).toBe('환불 처리 중');
    expect(orderStatusLabel('REFUNDED')).toBe('환불 완료');
  });

  it('모든 상태에 라벨이 있다', () => {
    // 하나라도 빠지면 그 상태의 주문 화면에 `undefined`가 나간다.
    // 계약의 열거값을 출처로 삼아 화면이 뒤처지지 않게 한다.
    for (const status of orderStatusSchema.options) {
      expect(ORDER_STATUS_LABELS[status], status).toBeTruthy();
    }
  });
});

describe('isOrderCancellable', () => {
  it('결제 전과 결제 후에는 취소할 수 있다', () => {
    expect(isOrderCancellable('PENDING_PAYMENT')).toBe(true);
    expect(isOrderCancellable('PAID')).toBe(true);
  });

  it('이미 결말이 난 주문은 취소할 수 없다', () => {
    // 서버의 Order.cancelBy가 같은 규칙을 지킨다 — 여기는 버튼을 그릴지 말지의
    // 표현 판단이고, 프론트가 틀리면 서버가 409로 거절한다.
    expect(isOrderCancellable('PAYMENT_FAILED')).toBe(false);
    expect(isOrderCancellable('CANCELLED')).toBe(false);
    expect(isOrderCancellable('REFUNDED')).toBe(false);
  });

  it('환불 처리 중에는 취소 버튼을 다시 보여주지 않는다', () => {
    // 서버는 false를 돌려주는 멱등 연산이라 눌러도 안전하지만, 사용자에게
    // "취소" 버튼을 다시 보여주면 이미 취소했다는 사실이 전달되지 않는다.
    expect(isOrderCancellable('REFUND_PENDING')).toBe(false);
  });
});
