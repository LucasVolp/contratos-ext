import { PrepareDocument } from "@/components/catalog/prepare-document";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PrepareDocument id={(await params).id} />;
}
