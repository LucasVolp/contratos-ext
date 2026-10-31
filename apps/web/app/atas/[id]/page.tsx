import { DetailPage } from "@/components/detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <DetailPage id={(await params).id} records />;
}
