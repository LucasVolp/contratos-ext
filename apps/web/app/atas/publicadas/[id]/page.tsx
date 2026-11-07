import { recordId } from "@/lib/route-params";
import { PublicRecordDetailPage } from "@/components/catalog/public-record-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PublicRecordDetailPage id={await recordId(params)} />;
}
