import { Suspense } from "react";
import { ExecutionPanel } from "@/components/finance/execution-panel";
import { Loading } from "@/components/ui";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ExecutionPanel />
    </Suspense>
  );
}
