import { Suspense } from "react";
import { BudgetPanel } from "@/components/finance/budget-panel";
import { Loading } from "@/components/ui";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <BudgetPanel />
    </Suspense>
  );
}
