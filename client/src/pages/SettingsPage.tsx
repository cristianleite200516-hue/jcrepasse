import { askConfirm } from "../lib/askConfirm";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { NewUserForm } from "../components/NewUserForm";
import { ChangePasswordForm } from "../components/ChangePasswordForm";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  dailyGoal: number | null;
  createdAt: string;
}

export function SettingsPage() {
  const { user: currentUser } = useAuth();
  const [aiSystemPrompt, setAiSystemPrompt] = useState("");
  const [businessInfo, setBusinessInfo] = useState("");
  const [dailyClosingGoal, setDailyClosingGoal] = useState("");
  const [storeName, setStoreName] = useState("");
  const [auditPhone, setAuditPhone] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storeLat, setStoreLat] = useState("");
  const [storeLng, setStoreLng] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [showNewUser, setShowNewUser] = useState(false);

  useEffect(() => {
    api.get("/settings").then((res) => {
      setAiSystemPrompt(res.data.aiSystemPrompt);
      setBusinessInfo(res.data.businessInfo);
      setDailyClosingGoal(res.data.dailyClosingGoal?.toString() ?? "");
      setStoreName(res.data.storeName ?? "");
      setAuditPhone(res.data.auditPhone ?? "");
      setStoreAddress(res.data.storeAddress ?? "");
      setStoreLat(res.data.storeLat?.toString() ?? "");
      setStoreLng(res.data.storeLng?.toString() ?? "");
      setLoading(false);
    });
    loadUsers();
  }, []);

  async function loadUsers() {
    const res = await api.get("/auth/users");
    setUsers(res.data);
  }

  async function updateUserGoal(userId: string, value: string) {
    const dailyGoal = value.trim() === "" ? null : parseInt(value, 10);
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dailyGoal } : u)));
    await api.patch(`/auth/users/${userId}`, { dailyGoal });
  }

  async function updateUserRole(target: UserRow, role: UserRow["role"]) {
    const label = role === "ADMIN" ? "Administrador" : "Agente";
    if (!await askConfirm(`Alterar o papel de ${target.name} para ${label}? Vale imediatamente.`)) {
      await loadUsers();
      return;
    }
    try {
      await api.patch(`/auth/users/${target.id}`, { role });
    } catch (err: any) {
      alert(err?.response?.data?.error || "Não foi possível alterar o papel.");
    }
    await loadUsers();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    await api.put("/settings", {
      aiSystemPrompt,
      businessInfo,
      dailyClosingGoal: dailyClosingGoal.trim() === "" ? null : parseInt(dailyClosingGoal, 10),
      storeName: storeName || null,
      storeAddress: storeAddress || null,
      storeLat: storeLat.trim() === "" ? null : Number(storeLat),
      storeLng: storeLng.trim() === "" ? null : Number(storeLng),
      auditPhone: auditPhone.replace(/\D/g, "") || null,
    });
    setSaved(true);
  }

  if (loading) return <div className="text-sm text-slate-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-8">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h1 className="text-lg font-bold text-slate-900">Configurações da IA</h1>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Instruções da IA (deixe em branco para usar o padrão de compra de veículos)
          </label>
          <textarea
            value={aiSystemPrompt}
            onChange={(e) => setAiSystemPrompt(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            placeholder="Ex: Você é um atendente da loja X que compra veículos..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Informações do negócio</label>
          <textarea
            value={businessInfo}
            onChange={(e) => setBusinessInfo(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Ex: horário de atendimento, condições de pagamento, região de atuação..."
          />
          <p className="mt-1 text-xs text-slate-500">
            Não precisa listar os carros aqui: a IA recebe o Estoque atualizado automaticamente, e carro marcado
            como vendido sai da lista. O preço vem do valor de venda do veículo.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="text-sm font-medium text-slate-600">Seu WhatsApp pra avisos</div>
          <p className="text-xs text-slate-500">
            Recebe o resumo do dia às 8h, o resumo do follow-up semanal e os avisos de lead esperando resposta. Com DDI e
            DDD, só números (ex: 5541999999999). Vazio = sem avisos.
          </p>
          <input
            value={auditPhone}
            onChange={(e) => setAuditPhone(e.target.value)}
            placeholder="5541999999999"
            inputMode="numeric"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="text-sm font-medium text-slate-600">Localização da loja (enviada pelo WhatsApp)</div>
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Nome da loja"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={storeAddress}
            onChange={(e) => setStoreAddress(e.target.value)}
            placeholder="Endereço completo"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={storeLat}
              onChange={(e) => setStoreLat(e.target.value)}
              placeholder="Latitude"
              inputMode="decimal"
              className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={storeLng}
              onChange={(e) => setStoreLng(e.target.value)}
              placeholder="Longitude"
              inputMode="decimal"
              className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Pra pegar latitude/longitude: abra o endereço no Google Maps, clique com o botão direito no
            pino exato e clique nos números que aparecem (copia automaticamente).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">
            Meta de fechamentos por dia (aparece no Painel do dia)
          </label>
          <input
            value={dailyClosingGoal}
            onChange={(e) => setDailyClosingGoal(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="ex: 3"
            className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-[#0b2545] px-4 py-2 text-sm font-medium text-white hover:bg-[#122f5c]"
        >
          Salvar
        </button>
        {saved && <span className="ml-3 text-sm text-emerald-600">Salvo!</span>}
      </form>

      <ChangePasswordForm />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Usuários</h2>
          {!showNewUser && (
            <button
              onClick={() => setShowNewUser(true)}
              className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              + Novo usuário
            </button>
          )}
        </div>

        {showNewUser && (
          <div className="mb-4">
            <NewUserForm onCreated={loadUsers} onClose={() => setShowNewUser(false)} />
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">E-mail</th>
                <th className="px-4 py-2">Papel</th>
                <th className="px-4 py-2">Meta diária</th>
                <th className="px-4 py-2">Desde</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-200">
                  <td className="px-4 py-2 text-slate-900">{u.name}</td>
                  <td className="px-4 py-2 text-slate-500">{u.email}</td>
                  <td className="px-4 py-2">
                    {u.id === currentUser?.id ? (
                      <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-700">
                        Administrador
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => updateUserRole(u, e.target.value as UserRow["role"])}
                        aria-label={`Papel de ${u.name}`}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="ADMIN">Administrador</option>
                        <option value="AGENT">Agente</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={u.dailyGoal ?? ""}
                      onBlur={(e) => updateUserGoal(u.id, e.target.value)}
                      placeholder="—"
                      inputMode="numeric"
                      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{new Date(u.createdAt).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
