import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { STATUS_LABELS } from "../lib/types";
import { StatusBadge } from "../components/StatusBadge";

interface DuplicateLead {
  id: string;
  name: string | null;
  phone: string;
  status: keyof typeof STATUS_LABELS;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  createdAt: string;
  updatedAt: string;
}

function vehicleLabel(l: DuplicateLead) {
  const parts = [l.vehicleBrand, l.vehicleModel].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return l.vehicleInfo || "—";
}

export function Duplicates() {
  const [groups, setGroups] = useState<DuplicateLead[][]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await api.get("/leads/duplicates");
    setGroups(res.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function removeLead(id: string) {
    if (!confirm("Excluir esse lead (e toda a conversa dele)? Não tem como desfazer.")) return;
    await api.delete(`/leads/${id}`);
    setGroups((prev) => prev.map((g) => g.filter((l) => l.id !== id)).filter((g) => g.length > 1));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Leads duplicados</h1>
        <p className="text-sm text-slate-500">
          Leads com o mesmo nome (ignorando emoji, acento e maiúsculas) — comum quando o mesmo contato aparece duas
          vezes no WhatsApp. Revise e apague o que for repetido.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Nenhum duplicado encontrado, tudo limpo!
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group[0].id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-slate-600">
                "{group[0].name}" — {group.length} leads
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-1 pr-4">Lead</th>
                      <th className="py-1 pr-4">Telefone</th>
                      <th className="py-1 pr-4">Veículo</th>
                      <th className="py-1 pr-4">Status</th>
                      <th className="py-1 pr-4">Criado em</th>
                      <th className="py-1 pr-4">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((l) => (
                      <tr key={l.id} className="border-t border-slate-200">
                        <td className="py-1.5 pr-4">
                          <Link to={`/leads/${l.id}`} className="text-slate-900 hover:underline">
                            {l.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-4 text-slate-500">{l.phone}</td>
                        <td className="py-1.5 pr-4 text-slate-500">{vehicleLabel(l)}</td>
                        <td className="py-1.5 pr-4">
                          <StatusBadge status={l.status} />
                        </td>
                        <td className="py-1.5 pr-4 text-slate-500">
                          {new Date(l.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="py-1.5 pr-4">
                          <button onClick={() => removeLead(l.id)} className="text-red-600 hover:underline">
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
