import { recordId } from "@/lib/route-params";
import { DetailPage } from "@/components/detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <DetailPage id={await recordId(params)} records />;
}
