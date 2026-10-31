import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { CatalogService } from "./service";
import { Raw } from "./types";
import { CurrentScope } from "../auth/guard";
import type { Scope } from "../auth/access";
@Controller("purchases")
export class PurchasesController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() list(@Query() query: Raw, @CurrentScope() scope: Scope) {
    return this.catalog.purchases(query, scope);
  }
  @Post("sync") sync(@Body() body: Raw, @CurrentScope() scope: Scope) {
    return this.catalog.syncPurchases(body, scope);
  }
  @Post("sync-reach") syncReach(
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    return this.catalog.syncReach("purchases", body, scope);
  }
  @Get(":id") async detail(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizePurchase(id, scope);
    return this.catalog.purchase(id);
  }
  @Post(":id/ensure-details") async ensure(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizePurchase(id, scope);
    return this.catalog.ensurePurchase(id, body ?? {});
  }
  @Post(":id/refresh") async refresh(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizePurchase(id, scope);
    return this.catalog.refreshPurchase(id);
  }
  @Post(":id/records/refresh") async records(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizePurchase(id, scope);
    return this.catalog.refreshLinkedRecords(id, body ?? {});
  }
}
@Controller("public-records")
export class PublicRecordsController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() list(@Query() query: Raw, @CurrentScope() scope: Scope) {
    return this.catalog.records(query, scope);
  }
  @Post("sync") sync(@Body() body: Raw, @CurrentScope() scope: Scope) {
    return this.catalog.syncRecords(body, scope);
  }
  @Post("sync-reach") syncReach(
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    return this.catalog.syncReach("records", body, scope);
  }
  @Get(":id") async detail(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.record(id);
  }
  @Post(":id/ensure-details") async ensure(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.ensureRecord(id, body ?? {});
  }
  @Post(":id/supplements/refresh") async supplements(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.refreshSupplements(id, body ?? {});
  }
  @Post(":id/refresh") async refresh(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.refreshRecord(id);
  }
  @Post(":id/items/:itemKey/refresh") async item(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("itemKey") item: string,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.refreshSupplement(id, item);
  }
  @Post(":id/draft") async draft(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
    @CurrentScope() scope: Scope,
  ) {
    await this.catalog.authorizeRecord(id, scope);
    return this.catalog.draft(id, body);
  }
}
