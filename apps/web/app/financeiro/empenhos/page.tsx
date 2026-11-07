import { Suspense } from "react";
import { CommitmentList } from "@/components/finance/commitment-list";
import { Loading } from "@/components/ui";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CommitmentList />
    </Suspense>
  );
}
