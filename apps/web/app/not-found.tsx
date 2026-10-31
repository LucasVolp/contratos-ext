import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <div className="eyebrow">404 — PÁGINA NÃO ENCONTRADA</div>
      <h1>Este caminho não está no arquivo.</h1>
      <Link href="/contratos" className="button">
        Voltar aos contratos
      </Link>
    </div>
  );
}
