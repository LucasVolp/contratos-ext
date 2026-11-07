import { Suspense } from "react";
import { CommitmentPage } from "@/components/finance/commitment-page";
import { Loading } from "@/components/ui";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <CommitmentPage id={(await params).id} />
    </Suspense>
  );
}
