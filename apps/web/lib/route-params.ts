import { notFound } from "next/navigation";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Every record is addressed by UUID; anything else (e.g. a removed /consultar page) is a real 404. */
export async function recordId(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return id;
}
