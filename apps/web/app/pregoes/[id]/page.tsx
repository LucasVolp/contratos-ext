import { PurchaseDetailPage } from "@/components/catalog/purchase-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PurchaseDetailPage id={(await params).id} />;
}
