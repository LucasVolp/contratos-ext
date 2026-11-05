import { Database } from "../database";
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
  constructor(private readonly db: Database) {
    this.contracts = new ContractRepository(db);
    this.records = new RecordRepository(db);
    this.exports = new ExportRepository(db);
    this.purchases = new PurchaseRepository(db);
    this.publicRecords = new PublicRecordRepository(db);
    this.supplements = new SupplementRepository(db);
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
