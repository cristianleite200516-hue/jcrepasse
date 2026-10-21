import { Router } from "express";
import { requireAuth } from "../middleware/auth";

export const fipeRouter = Router();
fipeRouter.use(requireAuth);

// Consulta a tabela FIPE via apifipe.com.br (serviço pago, token em APIFIPE_TOKEN). Essa API
// não tem consulta por placa — só marca/modelo/ano ou código FIPE direto.
const APIFIPE_BASE = "https://api.apifipe.com.br";

async function proxyApiFipe(path: string) {
  const token = process.env.APIFIPE_TOKEN;
  if (!token) throw new Error("APIFIPE_TOKEN não configurado no servidor (veja server/.env)");

  const res = await fetch(`${APIFIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.mensagem || `apifipe respondeu ${res.status}`);
  }
  return data;
}

const TIPOS_VALIDOS = new Set(["carros", "motos", "caminhoes"]);
function tipoVeiculo(req: { query: { tipo?: unknown } }) {
  const tipo = typeof req.query.tipo === "string" ? req.query.tipo : "carros";
  return TIPOS_VALIDOS.has(tipo) ? tipo : "carros";
}

fipeRouter.get("/marcas", async (req, res) => {
  try {
    const data: any[] = await proxyApiFipe(`/${tipoVeiculo(req)}`);
    res.json(data.map((m) => ({ codigo: String(m.codMarca), nome: m.nomeMarca })));
  } catch (err) {
    res.status(502).json({ error: "Não foi possível consultar as marcas na FIPE" });
  }
});

fipeRouter.get("/marcas/:marcaId/modelos", async (req, res) => {
  try {
    const data: any[] = await proxyApiFipe(`/${tipoVeiculo(req)}/${req.params.marcaId}`);
    res.json(data.map((m) => ({ codigo: String(m.codModelo), nome: m.nomeModelo })));
  } catch (err) {
    res.status(502).json({ error: "Não foi possível consultar os modelos na FIPE" });
  }
});

fipeRouter.get("/marcas/:marcaId/modelos/:modeloId/anos", async (req, res) => {
  try {
    const data: any[] = await proxyApiFipe(`/${tipoVeiculo(req)}/${req.params.marcaId}/${req.params.modeloId}`);
    res.json(data.map((a) => ({ codigo: a.codAno, nome: a.nomeAno })));
  } catch (err) {
    res.status(502).json({ error: "Não foi possível consultar os anos na FIPE" });
  }
});

fipeRouter.get("/marcas/:marcaId/modelos/:modeloId/anos/:anoId", async (req, res) => {
  try {
    const data: any = await proxyApiFipe(
      `/${tipoVeiculo(req)}/${req.params.marcaId}/${req.params.modeloId}/${req.params.anoId}`
    );
    res.json({
      Valor: data.valorVeiculo,
      Marca: data.nomeMarca,
      Modelo: data.nomeModelo,
      AnoModelo: data.anoModelo,
      CodigoFipe: data.codFipe,
      MesReferencia: data.refMes,
    });
  } catch (err) {
    res.status(502).json({ error: "Não foi possível consultar o valor FIPE" });
  }
});

// Busca direta pelo código FIPE, quando já se sabe o código do veículo (pula marca/modelo/ano).
fipeRouter.get("/codigo/:codigoFipe", async (req, res) => {
  try {
    const data: any[] = await proxyApiFipe(`/fipe/${req.params.codigoFipe}`);
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: "Código FIPE não encontrado" });
    }
    res.json(
      data.map((d) => ({
        Valor: d.valorVeiculo,
        Marca: d.nomeMarca,
        Modelo: d.nomeModelo,
        AnoModelo: d.anoModelo,
        CodigoFipe: d.codFipe,
        MesReferencia: d.refMes,
        codAno: d.codAno,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: "Não foi possível consultar esse código FIPE" });
  }
});
