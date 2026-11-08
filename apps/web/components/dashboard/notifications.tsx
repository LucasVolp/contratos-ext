"use client";
import { useState } from "react";
import { Bell, Check, CircleCheck, Clock3, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

const notices = [
  { id: "deadline", icon: Clock3, label: "Vigência", title: "Contrato 012/2025 vence em 15 dias", text: "Manutenção de elevadores · Reitoria. Defina a providência para o encerramento da vigência.", time: "Hoje, 08:30", urgent: true },
  { id: "document", icon: FileText, label: "Documento", title: "Uma nova assinatura foi solicitada", text: "Ata nº 018/2026 incluída na sua fila de trabalho.", time: "Hoje, 08:10", urgent: false },
  { id: "process", icon: CircleCheck, label: "Processo", title: "Processo 019/2026 mudou de etapa", text: "A análise técnica foi concluída. O processo aguarda análise jurídica.", time: "Ontem, 16:45", urgent: false },
];

export function Notifications({ announce }: { announce: (message: string) => void }) {
  const [read, setRead] = useState<string[]>([]);
  return (
    <section className="dashboard-panel dashboard-notifications" aria-labelledby="notifications-title">
      <header className="dashboard-section-head"><div><span className="dashboard-kicker">02 / ACOMPANHAMENTO</span><h2 id="notifications-title"><Bell size={17} aria-hidden="true" /> Notificações <span className="dashboard-count">{notices.length - read.length}</span></h2></div></header>
      <p className="dashboard-notifications-intro">Atualizações e prazos do seu trabalho.</p>
      <Button className="dashboard-read-all" variant="ghost" disabled={read.length === notices.length} onClick={() => { setRead(notices.map((n) => n.id)); announce("Todas as notificações do exemplo foram marcadas como lidas."); }}><Check size={14} aria-hidden="true" /> Marcar todas como lidas</Button>
      <div className="dashboard-notification-list" role="region" aria-label="Lista de notificações" tabIndex={0}>{notices.map((notice) => <article key={notice.id} className={`dashboard-notification ${read.includes(notice.id) ? "is-read" : ""}`}>
        <div className="dashboard-notification-meta"><span><notice.icon size={13} aria-hidden="true" />{notice.label}</span><span>{read.includes(notice.id) ? "Lida" : "● Não lida"}</span></div>
        <h3>{notice.title}</h3><p>{notice.text}</p>
        <div className="dashboard-notification-bottom"><time>{notice.time}</time><Button variant="ghost" disabled={read.includes(notice.id)} aria-label={`Marcar como lida: ${notice.title}`} onClick={() => { setRead([...read, notice.id]); announce("Notificação do exemplo marcada como lida."); }}>{read.includes(notice.id) ? "Lida" : "Marcar lida"}</Button></div>
      </article>)}</div>
      <p className="dashboard-panel-foot">Acontecimentos simulados · 08 nov 2026</p>
    </section>
  );
}
