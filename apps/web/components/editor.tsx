"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  decimal,
  Item,
  labels,
  validationSummary,
} from "@/lib/api";
import {
  ErrorState,
  Field,
  Loading,
  PageHead,
  FormValidation,
  focusInvalid,
} from "./ui";
import {
  validateFields,
  FieldErrors,
  normalizeDocument,
  blurFieldErrors,
} from "@contracts/validation";
type Values = Record<string, unknown>;
const blankItem = (number: number): Item => ({
  number,
  description: "",
  brand: "",
  model: "",
  unit: "",
  quantity: "0",
  minimumQuantity: "0",
  unitPrice: "0",
  warranty: "",
});
const recordFields = [
  "number",
  "object",
  "uasg",
  "processNumber",
  "purchaseNumber",
  "purchaseYear",
  "modality",
  "startDate",
  "endDate",
  "renewable",
  "organizationName",
  "organizationDocument",
  "organizationStreet",
  "organizationNumber",
  "organizationCity",
  "organizationState",
  "authorityName",
  "authorityRole",
  "authorityRegistration",
  "ordinanceNumber",
  "ordinanceDate",
  "ordinancePublicationDate",
  "supplierName",
  "supplierDocument",
  "supplierRepresentative",
];
const contractFields = [
  "number",
  "object",
  "uasg",
  "unitName",
  "supplierName",
  "supplierDocument",
  "startDate",
  "endDate",
  "initialValue",
  "globalValue",
];
export function Editor({
  id,
  records = false,
}: {
  id?: string;
  records?: boolean;
}) {
  const [values, setValues] = useState<Values>({
      modality: "PREGAO",
      renewable: false,
      initialValue: "0",
      globalValue: "0",
    }),
    [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(!!id),
    [loadedId, setLoadedId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const allErrors = () =>
    validateFields(
      { ...values, ...(records ? { items } : {}) },
      records ? "record" : "contract",
    );
  const router = useRouter();
  const root = records ? "/atas" : "/contratos";
  useEffect(() => {
    if (!id) return;
    const c = new AbortController();
    api<Values>(`/${records ? "records" : "contracts"}/${id}`, {
      signal: c.signal,
    })
      .then((v) => {
        if (c.signal.aborted) return;
        setLoadedId(id);
        setValues(v);
        if (records) setItems(v.items as Item[]);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [id, records, reload]);
  const change = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));
  function field(
    name: string,
    options: { type?: string; wide?: boolean; required?: boolean } = {},
  ) {
    return (
      <Field
        key={name}
        name={name}
        label={labels[name] || name}
        value={values[name]}
        onChange={change}
        {...options}
      />
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (id && loadedId !== id) return;
    setError("");
    const errors = allErrors();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError(validationSummary(errors));
      focusInvalid(errors);
      return;
    }
    setBusy(true);
    try {
      const body: Values = {};
      for (const key of records ? recordFields : contractFields) {
        let value = values[key];
        if (key.endsWith("Date")) value = value || null;
        else if (key === "purchaseYear") value = value ? Number(value) : null;
        else if (key === "renewable") value = !!value;
        else if (key === "globalValue" || key === "initialValue")
          value = decimal(String(value ?? 0));
        else if (key.endsWith("Document")) value = normalizeDocument(value);
        else if (key === "organizationState")
          value = String(value ?? "").toUpperCase();
        else value = value ?? "";
        body[key] = value;
      }
      if (records)
        body.items = items.map(({ id: itemId, ...item }) => ({
          ...item,
          ...(itemId ? { id: itemId } : {}),
          number: Number(item.number),
          quantity: decimal(item.quantity),
          minimumQuantity: decimal(item.minimumQuantity),
          unitPrice: decimal(item.unitPrice),
        }));
      const result = await api<{ id: string }>(
        `/${records ? "records" : "contracts"}${id ? `/${id}` : ""}`,
        { method: id ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      router.push(`${root}/${result.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        focusInvalid(e.fieldErrors);
      }
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? validationSummary(e.fieldErrors)
          : (e as Error).message,
      );
      setBusy(false);
    }
  }
  if (loading || (id && loadedId !== id && !error)) return <Loading />;
  if (id && loadedId !== id)
    return (
      <>
        <PageHead
          title={records ? "Editar ata" : "Editar contrato"}
          back={`${root}/${id}`}
        />
        <ErrorState
          message={error}
          retry={() => {
            setLoadedId(null);
            setError("");
            setLoading(true);
            setReload((n) => n + 1);
          }}
        />
      </>
    );
  return (
    <>
      <PageHead
        title={`${id ? "Editar" : records ? "Nova" : "Novo"} ${records ? "ata" : "contrato"}`}
        description={
          records
            ? "Construa o documento por etapas. Você pode salvar e completar depois."
            : "Registre as informações que acompanham este compromisso."
        }
        back={id ? `${root}/${id}` : root}
      />
      <FormValidation.Provider
        value={{
          errors: fieldErrors,
          onBlur: (name) => {
            const errors = allErrors();
            setFieldErrors((old) => blurFieldErrors(old, errors, name));
          },
        }}
      >
        <form onSubmit={submit} className="editor" noValidate>
          <section className="form-section">
            <div className="form-section-title">
              <span>01</span>
              <div>
                <h2>Identificação</h2>
                <p>
                  {records
                    ? "O contexto da sua ata de registro de preços."
                    : "Os dados essenciais do contrato."}
                </p>
              </div>
            </div>
            <div className="form-grid">
              {field("number", { required: true })}
              {field("uasg", { required: true })}
              {field("object", {
                type: "textarea",
                wide: true,
                required: true,
              })}
              {records ? (
                <>
                  {field("processNumber")}
                  {field("purchaseNumber")}
                  {field("purchaseYear", { type: "number" })}
                  <div className="field">
                    <label htmlFor="modality">Modalidade</label>
                    <select
                      id="modality"
                      name="modality"
                      value={String(values.modality || "PREGAO")}
                      onChange={(e) => change("modality", e.target.value)}
                    >
                      <option value="PREGAO">Pregão</option>
                      <option value="DISPENSA">Dispensa</option>
                    </select>
                  </div>
                </>
              ) : (
                field("unitName")
              )}
              {field("startDate", { type: "date" })}
              {field("endDate", { type: "date" })}
              {records && (
                <label className="checkbox wide">
                  <input
                    type="checkbox"
                    name="renewable"
                    checked={!!values.renewable}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, renewable: e.target.checked }))
                    }
                  />
                  A vigência desta ata pode ser prorrogada
                </label>
              )}
            </div>
          </section>
          {records && (
            <>
              <section className="form-section">
                <div className="form-section-title">
                  <span>02</span>
                  <div>
                    <h2>Organização</h2>
                    <p>Dados da organização responsável pela ata.</p>
                  </div>
                </div>
                <div className="form-grid">
                  {[
                    "organizationName",
                    "organizationDocument",
                    "organizationStreet",
                    "organizationNumber",
                    "organizationCity",
                    "organizationState",
                  ].map((k) => field(k))}
                </div>
              </section>
              <section className="form-section">
                <div className="form-section-title">
                  <span>03</span>
                  <div>
                    <h2>Signatário</h2>
                    <p>Identificação de quem assina pela organização.</p>
                  </div>
                </div>
                <div className="form-grid">
                  {[
                    "authorityName",
                    "authorityRole",
                    "authorityRegistration",
                    "ordinanceNumber",
                  ].map((k) => field(k))}
                  {field("ordinanceDate", { type: "date" })}
                  {field("ordinancePublicationDate", { type: "date" })}
                </div>
              </section>
            </>
          )}
          <section className="form-section">
            <div className="form-section-title">
              <span>{records ? "04" : "02"}</span>
              <div>
                <h2>Fornecedor</h2>
                <p>A pessoa ou empresa contratada.</p>
              </div>
            </div>
            <div className="form-grid">
              {field("supplierName", { required: !records })}
              {field("supplierDocument", { required: !records })}
              {records && field("supplierRepresentative")}
            </div>
          </section>
          {records ? (
            <section className="form-section">
              <div className="form-section-title">
                <span>05</span>
                <div>
                  <h2>Itens da ata</h2>
                  <p>Quantidades e preços que compõem o documento.</p>
                </div>
              </div>
              <div className="item-editor-list">
                {!items.length && (
                  <p className="muted">
                    Adicione os itens agora ou continue este rascunho depois.
                  </p>
                )}
                {items.map((item, index) => (
                  <details className="item-editor" key={index} open>
                    <summary>
                      <span>ITEM {item.number}</span>
                      <strong>{item.description || "Novo item"}</strong>
                    </summary>
                    <div className="form-grid">
                      {(
                        [
                          "number",
                          "description",
                          "brand",
                          "model",
                          "unit",
                          "quantity",
                          "minimumQuantity",
                          "unitPrice",
                          "warranty",
                        ] as const
                      ).map((key) => (
                        <Field
                          key={key}
                          name={`item-${index}-${key}`}
                          label={
                            {
                              number: "Número do item",
                              description: "Descrição",
                              brand: "Marca",
                              model: "Modelo",
                              unit: "Unidade de fornecimento",
                              quantity: "Quantidade",
                              minimumQuantity: "Quantidade mínima",
                              unitPrice: "Preço unitário",
                              warranty: "Garantia",
                            }[key]
                          }
                          value={item[key]}
                          type={
                            key === "description"
                              ? "textarea"
                              : [
                                    "quantity",
                                    "minimumQuantity",
                                    "unitPrice",
                                  ].includes(key)
                                ? "decimal"
                                : key === "number"
                                  ? "number"
                                  : "text"
                          }
                          wide={key === "description"}
                          onChange={(_, value) =>
                            setItems((old) =>
                              old.map((row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      [key]:
                                        key === "number"
                                          ? Number(value)
                                          : value,
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        setItems((old) => old.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 size={14} />
                      Remover item
                    </button>
                  </details>
                ))}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setItems((old) => [
                    ...old,
                    blankItem(Math.max(0, ...old.map((i) => i.number)) + 1),
                  ])
                }
              >
                <Plus size={16} />
                Adicionar item
              </button>
            </section>
          ) : (
            <section className="form-section">
              <div className="form-section-title">
                <span>03</span>
                <div>
                  <h2>Valores</h2>
                  <p>Informe os valores em reais.</p>
                </div>
              </div>
              <div className="form-grid">
                {field("initialValue", { type: "decimal", required: true })}
                {field("globalValue", { type: "decimal", required: true })}
              </div>
            </section>
          )}
          <div aria-live="polite">
            {error && (
              <ErrorState
                message={error}
                retry={
                  id && !values.id
                    ? () => {
                        setLoading(true);
                        setReload((n) => n + 1);
                      }
                    : undefined
                }
              />
            )}
          </div>
          <footer className="editor-actions">
            <span>
              {records
                ? "Salve como rascunho. Exporte quando estiver completo."
                : "Revise os dados antes de salvar."}
            </span>
            <div>
              <Link
                href={id ? `${root}/${id}` : root}
                className="button secondary"
              >
                Cancelar
              </Link>
              <button className="button" type="submit" disabled={busy}>
                <Save size={16} />
                {busy
                  ? "Salvando…"
                  : records
                    ? "Salvar ata"
                    : "Salvar contrato"}
              </button>
            </div>
          </footer>
        </form>
      </FormValidation.Provider>
    </>
  );
}
