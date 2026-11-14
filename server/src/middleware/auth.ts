import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export interface AuthedRequest extends Request {
  user?: { id: string; role: "ADMIN" | "AGENT"; name: string; email: string };
}

// O papel vem do banco a cada requisição, não do token: o token vale 7 dias, então confiar nele
// deixaria quem foi rebaixado (ou removido) com o acesso antigo até expirar.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  const token = header.slice("Bearer ".length);
  let userId: string;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    userId = payload.id;
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
  } catch (err) {
    console.error("Erro ao verificar usuário autenticado:", err);
    return res.status(503).json({ error: "Não foi possível verificar o usuário" });
  }
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  // Acesso removido pelo administrador: derruba na hora, mesmo com token ainda válido.
  if (!user.active) return res.status(401).json({ error: "Seu acesso ao CRM foi removido" });

  const { active: _active, ...rest } = user;
  req.user = { ...rest, role: user.role === "ADMIN" ? "ADMIN" : "AGENT" };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Apenas administradores" });
  }
  next();
}
