import { PublicRecordDetailPage } from "@/components/catalog/public-record-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PublicRecordDetailPage id={(await params).id} />;
}
