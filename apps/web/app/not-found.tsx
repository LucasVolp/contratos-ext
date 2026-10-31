import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <div className="eyebrow">404 — PÁGINA NÃO ENCONTRADA</div>
      <h1>Este caminho não está no arquivo.</h1>
      <Link href="/pregoes" className="button">
        Voltar ao início
      </Link>
    </div>
  );
}
