import { contractId } from "@/lib/route-params";
import { ContractDetail } from "@/components/contracts/contract-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ContractDetail externalId={await contractId(params)} />;
}
