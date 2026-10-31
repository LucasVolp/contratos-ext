import "./env";
import "reflect-metadata";
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpException,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  RequestMethod,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Response } from "express";
import { ApplicationService } from "./service";
import { DocumentService } from "./documents";
import { Database } from "./database";
import { Data, readiness } from "./domain";
import { CatalogClient } from "./catalog/client";
import { CatalogService } from "./catalog/service";
import {
  PurchasesController,
  PublicRecordsController,
} from "./catalog/controller";

@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response
        .status(error.getStatus())
        .json(typeof body === "string" ? { message: body } : body);
      return;
    }
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      const target =
        (error as { meta?: { target?: string[] } }).meta?.target ?? [];
      response
        .status(409)
        .json({
          message: target.includes("supplierDocument")
            ? "Já existe documento com este número, UASG e fornecedor. Abra e edite o cadastro existente."
            : "Já existe um registro com esse número nesta UASG. Edite o registro existente.",
        });
      return;
    }
    if (code === "P2025") {
      response.status(404).json({ message: "Registro não encontrado." });
      return;
    }
    if (code === "P2023") {
      response.status(400).json({ message: "Identificador inválido." });
      return;
    }
    console.error(
      "Falha interna da API:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
    response.status(500).json({
      message:
        "Não foi possível concluir a operação. Verifique o serviço e tente novamente.",
    });
  }
}
@Controller("contracts")
class ContractsController {
  constructor(
    @Inject(ApplicationService) private readonly app: ApplicationService,
  ) {}
  @Get() list(@Query() query: Data) {
    return this.app.contracts(query);
  }
  @Post("import") import(@Body() body: Data) {
    return this.app.importContracts(body);
  }
  @Post() create(@Body() body: Data) {
    return this.app.saveContract(null, body);
  }
  @Get(":id") get(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.app.contract(id);
  }
  @Put(":id") update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Data,
  ) {
    return this.app.saveContract(id, body);
  }
  @Delete(":id") delete(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.app.deleteContract(id);
  }
}
@Controller("records")
class RecordsController {
  constructor(
    @Inject(ApplicationService) private readonly app: ApplicationService,
    @Inject(DocumentService) private readonly documents: DocumentService,
  ) {}
  @Get() list(@Query() query: Data) {
    return this.app.records(query);
  }
  @Post("import") import(@Body() body: Data) {
    return this.app.importRecord(body);
  }
  @Post() create(@Body() body: Data) {
    return this.app.saveRecord(null, body);
  }
  @Get(":id/readiness") async ready(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query("itemId") itemId?: string,
  ) {
    return readiness(await this.app.record(id), itemId);
  }
  @Get(":id/exports") exports(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.app.exports(id);
  }
  @Get(":id/document") async document(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query("format") format: string = "docx",
    @Query("itemId") itemId: string | undefined,
    @Res() response: Response,
  ) {
    const result = await this.documents.generate(id, format, itemId);
    response.set({
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.buffer.length),
      "Cache-Control": "no-store",
    });
    response.end(result.buffer);
  }
  @Get(":id") get(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.app.record(id);
  }
  @Put(":id") update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: Data,
  ) {
    return this.app.saveRecord(id, body);
  }
  @Delete(":id") delete(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.app.deleteRecord(id);
  }
}
@Controller()
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("health") async health() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException(
        "Banco de dados indisponível. Verifique PostgreSQL e DATABASE_URL.",
      );
    }
  }
}
@Module({
  controllers: [
    ContractsController,
    RecordsController,
    HealthController,
    PurchasesController,
    PublicRecordsController,
  ],
  providers: [
    Database,
    { provide: CatalogClient, useFactory: () => new CatalogClient() },
    {
      provide: CatalogService,
      useFactory: (db: Database, client: CatalogClient) =>
        new CatalogService(db, client),
      inject: [Database, CatalogClient],
    },
    {
      provide: ApplicationService,
      useFactory: (db: Database) => new ApplicationService(db),
      inject: [Database],
    },
    {
      provide: DocumentService,
      useFactory: (db: Database, app: ApplicationService) =>
        new DocumentService(db, app),
      inject: [Database, ApplicationService],
    },
  ],
})
class AppModule {}
export async function createApplication() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  return app;
}
