"use client";
import { useRef, useState } from "react";
import { Save } from "lucide-react";
import {
  dateTime,
  NOTES_TOO_LONG,
  notesTooLong,
  saveContractNotes,
  type ContractNotes as Notes,
} from "@/lib/contracts-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "../ui";

function savedLine(notes: Notes) {
  if (!notes.updatedAt) return "Nenhuma observação salva.";
  const when = dateTime(notes.updatedAt);
  return notes.updatedBy
    ? `Salvo por ${notes.updatedBy} em ${when}`
    : `Salvo em ${when}`;
}

/** The team's internal notes: the only contract data written here; the daily run never touches it. */
export function ContractNotes({
  externalId,
  initial,
}: {
  externalId: string;
  initial: Notes;
}) {
  const [saved, setSaved] = useState(initial),
    [text, setText] = useState(initial.text),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invalid, setInvalid] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setError("");
    if (notesTooLong(text)) {
      setInvalid(NOTES_TOO_LONG);
      input.current?.focus();
      return;
    }
    setInvalid("");
    setBusy(true);
    try {
      const submitted = text;
      const result = await saveContractNotes(externalId, submitted);
      setSaved(result);
      // Take the server's (trimmed) text only when nothing was typed meanwhile.
      setText((current) => (current === submitted ? result.text : current));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section contract-notes" aria-labelledby="contract-notes-label">
      <form onSubmit={save} noValidate>
        <h2>
          <label id="contract-notes-label" htmlFor="contract-notes">
            Observações internas
          </label>
        </h2>
        <p id="contract-notes-help" className="muted">
          Informações da equipe que não constam no Contratos.gov.br. A
          atualização diária não altera este campo.
        </p>
        <Textarea
          ref={input}
          id="contract-notes"
          name="notes"
          rows={5}
          value={text}
          aria-invalid={!!invalid}
          aria-describedby={`contract-notes-help${invalid ? " contract-notes-error" : ""}`}
          onChange={(e) => {
            setText(e.target.value);
            if (invalid && !notesTooLong(e.target.value)) setInvalid("");
          }}
        />
        {invalid && (
          <small className="field-error" id="contract-notes-error" role="alert">
            {invalid}
          </small>
        )}
        <div className="contract-notes-actions">
          <p className="muted" aria-live="polite">
            {busy ? "Salvando…" : savedLine(saved)}
          </p>
          <Button className="button" type="submit" disabled={busy}>
            <Save size={16} />
            Salvar observações
          </Button>
        </div>
        {error && <ErrorState message={error} retry={() => save()} />}
      </form>
    </section>
  );
}
