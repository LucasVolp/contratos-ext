import { testAuth } from "./helpers/viewer";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app";
import { Database } from "../src/database";
test("Fastify preserves validation errors, UUID checks, JSON errors, health status and connection cleanup", async () => {
  let closed = 0,
    offline = false,
    queries = 0;
  const db = {
    query: async () => {
      queries++;
      if (offline) throw Error("offline");
      return [];
    },
    close: async () => {
      closed++;
    },
  } as unknown as Database;
  const app = await createApplication({ db,auth:testAuth });
  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.deepEqual(health.json(), { status: "ok", database: "ok" });
    assert.equal(health.statusCode, 200);
    offline = true;
    assert.equal(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
      503,
    );
    offline = false;
    const before = queries;
    for (const url of [
      "/api/records/invalid",
      "/api/records/invalid/document",
      "/api/purchases/invalid/refresh",
      "/api/public-records/invalid/draft",
    ]) {
      const result = await app.inject({
        method:
          url.endsWith("refresh") || url.endsWith("draft") ? "POST" : "GET",
        url,
      });
      assert.equal(result.statusCode, 400);
    }
    assert.equal(queries, before);
    for (const payload of ["{", "[]", "null"]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/records",
            headers: { "content-type": "application/json" },
            payload,
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/contracts?uasg=999999&uasg=888888",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/unknown" })).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
  assert.equal(closed, 1);
});
