import { Database } from "../database";
import { FinanceRepository } from "../finance/repository";
import { FinanceReportsRepository } from "../finance/reports";
import { ContractRepository } from "./contracts";
import { RecordRepository, ExportRepository } from "./records";
import {
  PurchaseRepository,
  PublicRecordRepository,
  SupplementRepository,
} from "./catalog";
export class Repositories {
  readonly contracts;
  readonly records;
  readonly exports;
  readonly purchases;
  readonly publicRecords;
  readonly supplements;
  readonly finance;
  readonly financeReports;
  constructor(private readonly db: Database) {
    this.contracts = new ContractRepository(db);
    this.records = new RecordRepository(db);
    this.exports = new ExportRepository(db);
    this.purchases = new PurchaseRepository(db);
    this.publicRecords = new PublicRecordRepository(db);
    this.supplements = new SupplementRepository(db);
    this.finance = new FinanceRepository(db);
    this.financeReports = new FinanceReportsRepository(db);
  }
  institutions(scope: string[] | null) {
    return this.db.query<{ uasg: string; name: string }>(
      `SELECT uasg,name FROM "Institution" ${scope === null ? "" : "WHERE uasg=ANY($1::text[])"} ORDER BY name`,
      scope === null ? [] : [scope],
    );
  }
  transaction<T>(
    run: (repos: Repositories) => Promise<T>,
    options?: {
      serializable?: boolean;
      timeout?: number;
    },
  ) {
    return this.db.transaction((db) => run(new Repositories(db)), options);
  }
}
