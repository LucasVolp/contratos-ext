import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";

test("PostgreSQL-backed HTTP CRUD, conflicts, decimals, atomic replacement and immutable exports", async () => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const req = async (path: string, method = "GET", body?: any) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let contractId: string | undefined, recordId: string | undefined;
  try {
    assert.equal((await req("/health")).status, 200);
    const contract = {
      number: `TEST-${Date.now()}`,
      uasg: "999999",
      object: "Integração API",
      supplierName: "Empresa Teste",
      supplierDocument: "11222333000181",
      initialValue: "0.1",
      globalValue: "0.2",
      startDate: "2026-01-01",
      endDate: "2099-01-01",
      ignored: "must-not-persist",
    };
    let response = await req("/api/contracts", "POST", contract);
    assert.equal(response.status, 201);
    const saved = await response.json();
    contractId = saved.id;
    assert.equal(saved.globalValue, "0.2");
    assert.equal("ignored" in saved, false);
    assert.equal((await req("/api/contracts", "POST", contract)).status, 409);
    assert.equal(
      (
        await req("/api/contracts", "POST", {
          ...contract,
          number: "invalid",
          startDate: "2026-02-30",
        })
      ).status,
      400,
    );
    response = await req(
      `/api/contracts?search=${contract.number}&page=1&limit=1`,
    );
    const list = await response.json();
    assert.equal(list.total, 1);
    assert.equal(list.stats.totalValue, "0.2");
    assert.equal(
      (
        await req(
          `/api/contracts?search=${contract.number}&from=2099-01-01&to=2099-02-01`,
        )
      ).status,
      200,
    );
    const record = {
      number: `TEST-${Date.now()}`,
      uasg: "999999",
      object: "Itens exatos",
      processNumber: "Proc1",
      purchaseNumber: "1/2026",
      organizationName: "Órgão Exemplo",
      organizationDocument: "11222333000181",
      organizationStreet: "Rua A",
      organizationCity: "Brasília",
      organizationState: "DF",
      authorityName: "Ana",
      authorityRole: "Diretora",
      supplierName: "Empresa",
      supplierDocument: "11222333000181",
      items: [
        {
          number: 1,
          description: "Item A",
          unit: "UN",
          quantity: "0.1",
          minimumQuantity: "0",
          unitPrice: "0.2",
        },
      ],
    };
    response = await req("/api/records", "POST", record);
    assert.equal(response.status, 201);
    const ata = await response.json();
    recordId = ata.id;
    assert.equal(ata.totalValue, "0.02");
    assert.deepEqual(
      await (await req(`/api/records/${recordId}/readiness`)).json(),
      { ready: true, missingFields: [] },
    );
    response = await req(
      `/api/records/${recordId}/document?format=docx&itemId=${ata.items[0].id}`,
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-disposition")?.includes(".docx"));
    assert.ok((await response.arrayBuffer()).byteLength > 10000);
    assert.equal(
      (await (await req(`/api/records/${recordId}/exports`)).json()).length,
      1,
    );
    response = await req(`/api/records/${recordId}`, "PUT", {
      ...record,
      items: [{ ...record.items[0], quantity: "3" }],
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).totalValue, "0.6");
    assert.equal(
      (await (await req(`/api/records/${recordId}/exports`)).json()).length,
      1,
    );
    response = await req(`/api/records?search=${record.number}`);
    const recordList = await response.json();
    assert.equal(recordList.stats.totalValue, "0.6");
    assert.equal(recordList.stats.exportsCount, 1);
  } finally {
    if (contractId) await req(`/api/contracts/${contractId}`, "DELETE");
    if (recordId) await req(`/api/records/${recordId}`, "DELETE");
    await app.close();
  }
});
