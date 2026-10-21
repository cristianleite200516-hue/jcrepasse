import { useEffect, useRef, useState } from "react";
import { api, API_HOST } from "../lib/api";
import { socket } from "../lib/socket";
import { Attachment, AttachmentCategory } from "../lib/types";

function fileUrl(a: Attachment) {
  return `${API_HOST}/api/attachments/${a.id}/file`;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({ leadId }: { leadId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await api.get(`/leads/${leadId}/attachments`);
    setAttachments(res.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    function onUpdated(payload: { leadId: string }) {
      if (payload.leadId === leadId) load();
    }
    socket.on("attachments:updated", onUpdated);
    return () => {
      socket.off("attachments:updated", onUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function handleUpload(files: FileList | null, category: AttachmentCategory) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append("files", f));
      formData.append("category", category);
      await api.post(`/leads/${leadId}/attachments`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch {
      setError("Não foi possível enviar o(s) arquivo(s) (máx. 15MB cada).");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este arquivo?")) return;
    await api.delete(`/attachments/${id}`);
  }

  const fotos = attachments.filter((a) => a.category === "FOTO");
  const documentos = attachments.filter((a) => a.category === "DOCUMENTO");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-600">Fotos e documentos</div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Fotos do veículo</span>
          <button
            type="button"
            onClick={() => fotoInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-50"
          >
            + Adicionar fotos
          </button>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleUpload(e.target.files, "FOTO")}
          />
        </div>
        {fotos.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhuma foto ainda</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {fotos.map((a) => (
              <div key={a.id} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200">
                <img src={fileUrl(a)} alt={a.originalName} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white group-hover:block"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Documentos</span>
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-50"
          >
            + Adicionar documento
          </button>
          <input
            ref={docInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => handleUpload(e.target.files, "DOCUMENTO")}
          />
        </div>
        {documentos.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum documento ainda</div>
        ) : (
          <div className="space-y-1">
            {documentos.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 text-xs">
                <a href={fileUrl(a)} target="_blank" rel="noreferrer" className="truncate text-emerald-600 hover:underline">
                  📄 {a.originalName}
                </a>
                <div className="flex items-center gap-2 text-slate-500">
                  <span>{fmtSize(a.size)}</span>
                  <button type="button" onClick={() => handleDelete(a.id)} className="hover:text-red-600">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {uploading && <div className="text-xs text-slate-500">Enviando...</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
