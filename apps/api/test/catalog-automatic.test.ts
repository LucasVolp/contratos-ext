import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogClient } from "../src/catalog/client";
import { CatalogService } from "../src/catalog/service";
import {
  CatalogSupplements,
  presentSupplement,
} from "../src/catalog/supplements";

test("source page jobs share a four-slot limit and release rejected jobs", async () => {
  let active = 0,
    peak = 0;
  const client = new CatalogClient({
    pages: async (_path: string, params: any) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (params.numeroItem === "fail") throw new Error("offline");
      return [];
    },
  });
  await Promise.allSettled(
    Array.from({ length: 16 }, (_, i) =>
      client.units("ata", "unit", i === 1 ? "fail" : String(i)),
    ),
  );
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test("automatic purchase stages share flights, use freshness, and retain contextual errors during cooldown", async () => {
  const row: any = {
    id: "p",
    srp: true,
    detailsSyncedAt: null,
    recordsSyncedAt: null,
  };
  const service = new CatalogService({} as any);
  let details = 0,
    records = 0;
  service.purchaseRow = async () => row;
  service.purchase = async () => ({ ...row, items: ["cached"] }) as any;
  service.refreshPurchase = async () => {
    details++;
    await new Promise((r) => setTimeout(r, 5));
    row.detailsSyncedAt = new Date();
    return {} as any;
  };
  service.refreshLinkedRecords = async () => {
    records++;
    throw new Error("offline");
  };
  const [a, b] = await Promise.all([
    service.ensurePurchase("p"),
    service.ensurePurchase("p"),
  ]);
  assert.equal(details, 1);
  assert.equal(records, 1);
  assert.deepEqual(a, b);
  assert.ok(a.errors.records);
  assert.deepEqual(a.data.items, ["cached"]);
  await service.ensurePurchase("p");
  assert.equal(records, 1);
  await service.ensurePurchase("p", { force: true });
  assert.equal(details, 2);
  assert.equal(records, 2);
  row.srp = false;
  await service.ensurePurchase("p", { force: true });
  assert.equal(records, 2);
});

test("automatic record failure returns local snapshot, cooldown, then forced retry", async () => {
  const service = new CatalogService({} as any);
  let calls = 0;
  service.recordRow = async () => ({ detailsSyncedAt: null }) as any;
  service.record = async () => ({ items: ["cached"] }) as any;
  service.refreshRecord = async () => {
    calls++;
    throw new Error("source down");
  };
  const response = await service.ensureRecord("r");
  assert.ok(response.errors.details);
  assert.deepEqual(response.data.items, ["cached"]);
  await service.ensureRecord("r");
  assert.equal(calls, 1);
  await service.ensureRecord("r", { force: true });
  assert.equal(calls, 2);
});

test("bulk supplements deduplicate numeric provider keys, fetch commitments once, preserve failed cached parts", async () => {
  const rows: any[] = [];
  const record: any = {
    number: "ata",
    uasg: "unit",
    detailsSyncedAt: new Date(),
    snapshot: { items: [{ key: "00001" }, { key: "1" }, { key: "2" }] },
  };
  const db: any = {
    publicRecord: { findUnique: async () => record },
    catalogSupplement: {
      findMany: async () => rows,
      upsert: async ({ where, create, update }: any) => {
        const found = rows.find((r) =>
          Object.entries(where.publicRecordId_itemNumber_kind).every(
            ([k, v]) => r[k] === v,
          ),
        );
        if (found) Object.assign(found, update);
        else rows.push(create);
      },
    },
  };
  let units = 0,
    commitments = 0,
    adhesions = 0,
    fail = false;
  const client: any = {
    units: async () => {
      units++;
      return [{ codigoUnidade: "u" }];
    },
    commitments: async () => {
      commitments++;
      return [];
    },
    adhesions: async () => {
      adhesions++;
      if (fail) throw Error("offline");
      return [{ unidadeNaoParticipante: "u" }];
    },
  };
  const supplements = new CatalogSupplements(db, client);
  assert.deepEqual(await supplements.refreshAll("r"), {
    items: 2,
    loaded: 2,
    failed: 0,
  });
  await supplements.refreshAll("r");
  assert.deepEqual([units, commitments, adhesions], [2, 1, 2]);
  fail = true;
  const result = await supplements.refreshAll("r", true);
  assert.deepEqual(result, { items: 2, loaded: 0, failed: 2 });
  assert.equal(commitments, 2);
  const first = presentSupplement(rows, "00001"),
    duplicate = presentSupplement(rows, "1");
  assert.deepEqual(first, duplicate);
  assert.equal(first.adhesions.status, "error");
  assert.equal(first.adhesions.data.length, 1);
  await supplements.refreshAll("r");
  assert.equal(adhesions, 4);
});

test("fresh record details skip source and stale details refresh once", async () => {
  const service = new CatalogService({} as any);
  let calls = 0;
  const row: any = { detailsSyncedAt: new Date() };
  service.recordRow = async () => row;
  service.record = async () => ({ items: [] }) as any;
  service.refreshRecord = async () => {
    calls++;
    row.detailsSyncedAt = new Date();
    return {} as any;
  };
  await service.ensureRecord("r");
  assert.equal(calls, 0);
  row.detailsSyncedAt = new Date(Date.now() - 300001);
  await service.ensureRecord("r");
  assert.equal(calls, 1);
  await service.ensureRecord("r");
  assert.equal(calls, 1);
});

test("unknown SRP never queries linked records even after detail source fails", async () => {
  const service = new CatalogService({} as any);
  let records = 0;
  service.purchaseRow = async () =>
    ({ srp: null, detailsSyncedAt: null }) as any;
  service.purchase = async () => ({ items: [] }) as any;
  service.refreshPurchase = async () => {
    throw Error("offline");
  };
  service.refreshLinkedRecords = async () => {
    records++;
    return {} as any;
  };
  await service.ensurePurchase("p", { force: true });
  assert.equal(records, 0);
});

test("bulk reports useful 422 for items without numeric identities", async () => {
  const supplements = new CatalogSupplements(
    {
      publicRecord: {
        findUnique: async () => ({
          detailsSyncedAt: new Date(),
          snapshot: { items: [{ key: "opaque" }] },
        }),
      },
      catalogSupplement: { findMany: async () => [] },
    } as any,
    {} as any,
  );
  await assert.rejects(
    () => supplements.refreshAll("r"),
    (error: any) => error.getStatus() === 422,
  );
});
