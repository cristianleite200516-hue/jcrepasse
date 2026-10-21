import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Lead } from "../lib/types";

export function LeadPicker({ onSelect }: { onSelect: (lead: Lead) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.get("/leads", { params: { q: query } }).then((res) => setResults(res.data.slice(0, 8)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, selected]);

  return (
    <div className="relative">
      <input
        value={selected ? `${selected.name || "Sem nome"} — ${selected.phone}` : query}
        onChange={(e) => {
          setSelected(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar lead por nome ou telefone..."
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      {open && results.length > 0 && !selected && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {results.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => {
                setSelected(lead);
                onSelect(lead);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
            >
              <div className="font-medium text-slate-900">{lead.name || "Sem nome"}</div>
              <div className="text-xs text-slate-500">{lead.phone}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
