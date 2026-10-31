import "./env";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString:
          process.env.DATABASE_URL ||
          "postgresql://contracts:contracts_local@localhost:5540/contracts",
        connectionTimeoutMillis: 10000,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
