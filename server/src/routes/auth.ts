import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth, AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos" });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Credenciais inválidas" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Credenciais inválidas" });
  if (!user.active) return res.status(403).json({ error: "Seu acesso ao CRM foi removido. Fale com o administrador." });

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    process.env.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "AGENT"]).default("AGENT"),
});

authRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password, role } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Já existe um usuário com esse e-mail" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email, passwordHash, role } });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

authRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, dailyGoal: true, isOwner: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

const updateUserSchema = z.object({
  dailyGoal: z.number().int().min(0).nullable().optional(),
  role: z.enum(["ADMIN", "AGENT"]).optional(),
  active: z.boolean().optional(),
});

authRouter.patch("/users/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Impede o admin de se rebaixar sozinho — o que também garante que sempre sobra um admin.
  if (parsed.data.role && req.params.id === req.user?.id) {
    return res.status(400).json({ error: "Você não pode alterar o seu próprio papel" });
  }

  // Só o administrador principal (dono) pode remover ou devolver acesso de alguém.
  if (parsed.data.active !== undefined) {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isOwner: true } });
    if (!me?.isOwner) {
      return res.status(403).json({ error: "Só o administrador principal pode remover ou devolver acesso" });
    }
  }

  // Ninguém remove o próprio acesso (evita o admin se trancar pra fora).
  if (parsed.data.active === false && req.params.id === req.user?.id) {
    return res.status(400).json({ error: "Você não pode remover o seu próprio acesso" });
  }

  // O admin principal (dono) nunca perde o papel de administrador nem o acesso, nem por outro admin.
  if ((parsed.data.role && parsed.data.role !== "ADMIN") || parsed.data.active === false) {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { isOwner: true } });
    if (target?.isOwner) {
      return res.status(403).json({ error: "Esse é o administrador principal: o papel e o acesso dele não podem ser alterados" });
    }
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true, dailyGoal: true, isOwner: true, active: true, createdAt: true },
  });
  res.json(user);
});

// Apaga a pessoa do CRM de vez. Só o administrador principal pode, e nunca a si mesmo.
// Os leads dela ficam sem responsável e o histórico de alterações fica sem autor — nada de lead some.
authRouter.delete("/users/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isOwner: true } });
  if (!me?.isOwner) {
    return res.status(403).json({ error: "Só o administrador principal pode apagar usuários" });
  }
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "Você não pode apagar a si mesmo" });
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { isOwner: true } });
  if (!target) return res.status(404).json({ error: "Usuário não encontrado" });
  if (target.isOwner) {
    return res.status(403).json({ error: "O administrador principal não pode ser apagado" });
  }

  await prisma.$transaction([
    prisma.lead.updateMany({ where: { assignedToId: req.params.id }, data: { assignedToId: null } }),
    prisma.auditLog.updateMany({ where: { userId: req.params.id }, data: { userId: null } }),
    prisma.user.delete({ where: { id: req.params.id } }),
  ]);
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Senha atual incorreta" });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

// Lista leve da equipe (só id+nome) para popular seletores de "responsável" —
// disponível para qualquer usuário autenticado, ao contrário de /users (admin only).
authRouter.get("/team", requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});
