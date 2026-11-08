"use client";
import { useState } from "react";
import { Check, ChevronDown, FilePenLine, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
import { Empty } from "@/components/ui";
import { Label } from "@/components/ui/label";

import { demoTasks as tasks } from "@/lib/dashboard-demo";


export function AttentionQueue({ announce }: { announce: (message: string) => void }) {
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const remaining = tasks.filter((task) => !completed.includes(task.id));
  const visible = remaining.filter((task) => tab === "all" || task.type === tab);
  return (
    <section className="dashboard-panel attention-panel" aria-labelledby="attention-title">
      <header className="dashboard-section-head"><div><span className="dashboard-kicker">01 / SUA AGENDA</span><h2 id="attention-title">Para resolver <span className="dashboard-count">{remaining.length}</span></h2></div><Badge variant="outline">Perfil de exemplo</Badge></header>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <div className="dashboard-task-filter-mobile"><Label htmlFor="task-filter">Exibir</Label><NativeSelect id="task-filter" aria-label="Exibir pendências" value={tab} onChange={(event) => setTab(event.target.value)}><option value="all">Tudo ({remaining.length})</option><option value="signature">Assinaturas</option><option value="pending">Pendências</option></NativeSelect></div>
        <TabsList variant="line" aria-label="Filtrar suas pendências">
          <TabsTrigger value="all">Tudo ({remaining.length})</TabsTrigger>
          <TabsTrigger value="signature">Assinaturas ({remaining.filter((t) => t.type === "signature").length})</TabsTrigger>
          <TabsTrigger value="pending">Pendências ({remaining.filter((t) => t.type === "pending").length})</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <div className="dashboard-task-list" role="region" aria-label="Lista de pendências" tabIndex={0}>
            {!visible.length && <Empty kind="pendências" title="Nenhum item nesta seleção." description="As ações deste painel são simulações locais." action={<Button variant="outline" onClick={() => setTab("all")}>Mostrar tudo</Button>} />}
            {visible.map((task) => <article className="dashboard-task" key={task.id}>
              <div className={`dashboard-task-icon ${task.urgent ? "is-urgent" : ""}`}>{task.type === "signature" ? <FilePenLine size={18} aria-hidden="true" /> : <ListTodo size={18} aria-hidden="true" />}</div>
              <div className="dashboard-task-body"><span className="dashboard-task-type">{task.type === "signature" ? "Aguardando sua assinatura" : "Preenchimento pendente"}</span><h3>{task.title}</h3><p>{task.description}</p>
                {open === task.id && <div className="dashboard-task-detail" id={`detail-${task.id}`}><p>{task.detail}</p><strong>Demonstração · sem efeito em documentos reais</strong>{task.type === "signature" && <Button onClick={() => { setCompleted([...completed, task.id]); setOpen(null); announce("Assinatura simulada. Nenhum documento foi assinado. Recarregue a página para restaurar o exemplo."); }}>Simular assinatura <Check size={14} aria-hidden="true" /></Button>}</div>}
              </div>
              <div className="dashboard-task-action"><span className={task.urgent ? "dashboard-deadline urgent" : "dashboard-deadline"}>{task.urgent && <span aria-hidden="true">●</span>} {task.deadline}</span><Button variant="outline" aria-expanded={open === task.id} aria-controls={open === task.id ? `detail-${task.id}` : undefined} onClick={() => setOpen(open === task.id ? null : task.id)}>{open === task.id ? "Fechar revisão" : task.action}<ChevronDown size={13} aria-hidden="true" /></Button></div>
            </article>)}
          </div>
        </TabsContent>
      </Tabs>
      <p className="dashboard-panel-foot">Prazos mais próximos primeiro · atribuições pessoais independem do recorte financeiro</p>
    </section>
  );
}
