import { recordId } from "@/lib/route-params";
import { PurchaseDetailPage } from "@/components/catalog/purchase-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PurchaseDetailPage id={await recordId(params)} />;
}
