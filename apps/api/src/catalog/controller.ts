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
@Controller("purchases")
export class PurchasesController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() list(@Query() query: Raw) {
    return this.catalog.purchases(query);
  }
  @Post("sync") sync(@Body() body: Raw) {
    return this.catalog.syncPurchases(body);
  }
  @Get(":id") detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.catalog.purchase(id);
  }
  @Post(":id/ensure-details") ensure(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
  ) {
    return this.catalog.ensurePurchase(id, body ?? {});
  }
  @Post(":id/refresh") refresh(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.catalog.refreshPurchase(id);
  }
  @Post(":id/records/refresh") records(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
  ) {
    return this.catalog.refreshLinkedRecords(id, body ?? {});
  }
}
@Controller("public-records")
export class PublicRecordsController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() list(@Query() query: Raw) {
    return this.catalog.records(query);
  }
  @Post("sync") sync(@Body() body: Raw) {
    return this.catalog.syncRecords(body);
  }
  @Get(":id") detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.catalog.record(id);
  }
  @Post(":id/ensure-details") ensure(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
  ) {
    return this.catalog.ensureRecord(id, body ?? {});
  }
  @Post(":id/supplements/refresh") supplements(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
  ) {
    return this.catalog.refreshSupplements(id, body ?? {});
  }
  @Post(":id/refresh") refresh(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.catalog.refreshRecord(id);
  }
  @Post(":id/items/:itemKey/refresh") item(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("itemKey") item: string,
  ) {
    return this.catalog.refreshSupplement(id, item);
  }
  @Post(":id/draft") draft(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Raw,
  ) {
    return this.catalog.draft(id, body);
  }
}
