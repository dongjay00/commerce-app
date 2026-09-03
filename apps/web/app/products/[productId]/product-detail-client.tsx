'use client';

import type { ProductDto } from '@commerce/contracts';
import { useRouter } from 'next/navigation';
import { ProductDetailView } from '@/views/product-detail';

/**
 * 서버 컴포넌트는 함수를 클라이언트로 내려보낼 수 없다. `onAdded`가 `router.refresh()`를
 * 불러야 하므로 이 얇은 `'use client'` 래퍼가 라우터를 잡아 넘긴다 —
 * 라우팅 결정은 `app/`에 있고 `views`는 콜백만 받는다.
 */
export function ProductDetailClient({ product }: { product: ProductDto }) {
  const router = useRouter();
  return <ProductDetailView product={product} onAdded={() => router.refresh()} />;
}
