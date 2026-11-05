import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "../errors";
import { isCPF, isCNPJ, normalizeDocument } from "@contracts/validation";
import { Repositories } from "../repositories";
import { validateRecord } from "../domain";
import { itemNumberIdentity } from "./mappers";
import {
  linkedPurchaseCache,
  purchaseResultEvidence,
} from "./purchase-evidence";
import { Raw, RecordSnapshot } from "./types";
export class CatalogDrafts {
  constructor(private readonly db: Repositories) {}
  async create(id: string, body: Raw) {
    const supplierDocument = normalizeDocument(body?.supplierDocument);
    if (!isCPF(supplierDocument) && !isCNPJ(supplierDocument))
      throw new BadRequestException({
        message: "Informe CPF ou CNPJ válido do fornecedor.",
        fieldErrors: { supplierDocument: "CPF ou CNPJ inválido." },
      });
    const source = await this.db.publicRecords.get(id);
    if (!source) throw new NotFoundException("Ata publicada não encontrada.");
    const identity = {
      sourcePublicRecordId: id,
      sourceSupplierDocument: supplierDocument,
    };
    const existing = await this.db.records.bySource(id, supplierDocument);
    if (existing) return { id: existing.id, created: false };
    if (!source.detailsSyncedAt)
      throw new UnprocessableEntityException(
        "Atualize o detalhe da ata para selecionar o fornecedor e preparar o documento.",
      );
    const snapshot = source.snapshot as unknown as RecordSnapshot;
    if (snapshot.purchaseSrp === false)
      throw new UnprocessableEntityException(
        "A contratação vinculada não foi identificada como registro de preços (SRP). Confira os dados oficiais antes de preparar o documento.",
      );
    if (!snapshot.modality)
      throw new UnprocessableEntityException(
        "A modalidade da ata não está confirmada como pregão ou dispensa. Confira os dados oficiais antes de preparar o documento.",
      );
    const cached = await linkedPurchaseCache(this.db, source);
    const evidence = purchaseResultEvidence(
      snapshot,
      source.detailsSyncedAt,
      cached,
    );
    const items = (snapshot.items ?? []).filter(
      (item, index) =>
        item.supplierDocument === supplierDocument &&
        !snapshot.rawItems[index]?.itemExcluido &&
        !snapshot.rawItems[index]?.dataHoraExclusao &&
        !snapshot.rawItems[index]?.dataCancelamentoPncp &&
        !evidence.states.some(
          (state) =>
            itemNumberIdentity(state.itemNumber) ===
              itemNumberIdentity(item.number) &&
            normalizeDocument(state.supplierDocument) === supplierDocument &&
            state.cancelled,
        ),
    );
    if (!items.length)
      throw new UnprocessableEntityException(
        "Este fornecedor não possui itens ativos confirmados nesta ata.",
      );
    const numbers = new Set<string>();
    for (const item of items) {
      if (numbers.has(item.number))
        throw new UnprocessableEntityException(
          `O item ${item.number} tem mais de uma linha para este fornecedor. Confira a ata antes de preparar o documento.`,
        );
      numbers.add(item.number);
      if (
        !/^\d+$/.test(item.number) ||
        !Number.isSafeInteger(Number(item.number)) ||
        Number(item.number) < 1
      )
        throw new UnprocessableEntityException(
          "A numeração pública dos itens não é compatível com o editor. Confira a ata antes de preparar o documento.",
        );
    }
    const { items: validatedItems, ...fields } = validateRecord({
      number: source.number,
      object: source.object,
      uasg: source.uasg,
      processNumber: snapshot.processNumber ?? "",
      purchaseNumber: source.purchaseNumber,
      purchaseYear: source.purchaseYear,
      modality: snapshot.modality,
      startDate: source.startDate,
      endDate: source.endDate,
      organizationName: source.organizationName || source.unitName,
      organizationDocument: snapshot.organizationDocument ?? "",
      organizationCity: snapshot.city ?? "",
      organizationState: snapshot.state ?? "",
      supplierDocument,
      supplierName: items[0].supplierName,
      items: items.map((item) => ({
        number: Number(item.number),
        description: item.description,
        brand: item.brand,
        model: item.model,
        unit: item.unit,
        quantity: item.quantity ?? "0",
        minimumQuantity: "0",
        unitPrice: item.unitPrice ?? "0",
        warranty: "",
      })),
    });
    try {
      return await this.db.transaction(
        async (tx: Repositories) => {
          const repeated = await tx.records.bySource(id, supplierDocument);
          if (repeated) return { id: repeated.id, created: false };
          // Old records can contain masked documents. Compare canonical values without rewriting them.
          const collisions = await tx.records.byIdentity(
            source.number,
            source.uasg,
          );
          const collision = collisions.find(
            (row) =>
              normalizeDocument(row.supplierDocument) === supplierDocument,
          );
          if (collision)
            throw new ConflictException(
              `Já existe documento local desta ata para o fornecedor selecionado (${collision.id}). Abra e edite o cadastro existente; seus dados foram preservados.`,
            );
          const record = await tx.records.save(
            null,
            { ...fields, ...identity },
            validatedItems,
          );
          return { id: record.id, created: true };
        },
        { serializable: true },
      );
    } catch (error) {
      if (
        (
          error as {
            code?: string;
          }
        ).code === "23505" ||
        (
          error as {
            code?: string;
          }
        ).code === "40001"
      ) {
        const repeated = await this.db.records.bySource(id, supplierDocument);
        if (repeated) return { id: repeated.id, created: false };
        throw new ConflictException(
          "Já existe um documento desta ata para o fornecedor. Abra o cadastro existente.",
        );
      }
      throw error;
    }
  }
}
