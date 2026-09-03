import { notFound } from 'next/navigation';
import { apiBaseUrl } from '@/server/api-client';
import { createContractClient } from '@/shared/api/contract-client';
import { ProductDetailClient } from './product-detail-client';

/** 상세도 인증이 필요 없다 — `app/page.tsx`와 같은 이유로 비인증 클라이언트를 쓴다. */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const client = createContractClient(apiBaseUrl());
  const result = await client.product.get({ params: { productId } });
  if (result.status !== 200) {
    notFound();
  }
  return <ProductDetailClient product={result.body} />;
}
