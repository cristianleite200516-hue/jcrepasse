import { Router } from "express";
import { requireAuth } from "../middleware/auth";

export const cepRouter = Router();
cepRouter.use(requireAuth);

cepRouter.get("/:cep", async (req, res) => {
  const cep = req.params.cep.replace(/\D/g, "");
  if (cep.length !== 8) return res.status(400).json({ error: "CEP inválido" });

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data: any = await response.json().catch(() => null);

    if (!response.ok || !data || data.erro) {
      return res.status(404).json({ error: "CEP não encontrado" });
    }

    res.json({
      cep: data.cep,
      address: data.logradouro || null,
      neighborhood: data.bairro || null,
      city: data.localidade || null,
      state: data.uf || null,
    });
  } catch (err) {
    console.error("Erro ao consultar CEP:", err);
    res.status(502).json({ error: "Não foi possível consultar o CEP agora" });
  }
});
