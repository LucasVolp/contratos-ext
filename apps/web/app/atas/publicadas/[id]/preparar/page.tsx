import { recordId } from "@/lib/route-params";
import { PrepareDocument } from "@/components/catalog/prepare-document";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PrepareDocument id={await recordId(params)} />;
}
