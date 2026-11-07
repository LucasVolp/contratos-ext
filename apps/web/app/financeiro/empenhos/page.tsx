import { Suspense } from "react";
import { FinancePage } from "@/components/finance/finance-page";
import { Loading } from "@/components/ui";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <FinancePage mode="commitments" />
    </Suspense>
  );
}
