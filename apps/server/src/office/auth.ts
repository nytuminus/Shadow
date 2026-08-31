// Login dos funcionários do escritório 2D — usuário/senha simples, sem SSO.
// bcryptjs (não bcrypt) de propósito: puro JS, sem módulo nativo pra
// desalinhar com o Node embutido do Electron.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.js';
import type { Employee } from '../db/index.js';

const TOKEN_TTL = '30d';

export interface JwtPayload {
  sub: string;
  username: string;
  name: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET não configurado no .env.');
  return s;
}

export function signToken(employee: Employee): string {
  const payload: JwtPayload = { sub: employee.id, username: employee.username, name: employee.name };
  return jwt.sign(payload, secret(), { expiresIn: TOKEN_TTL });
}

/** Usado tanto pelo middleware Express (header) quanto pelo handshake do Socket.io. */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, secret()) as JwtPayload;
}

export interface LoginResult {
  token: string;
  employee: { id: string; username: string; name: string };
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const employee = await db().getEmployeeByUsername(String(username || '').trim());
  if (!employee) throw new Error('Usuário ou senha inválidos.');
  const ok = await bcrypt.compare(String(password || ''), employee.passwordHash);
  if (!ok) throw new Error('Usuário ou senha inválidos.');
  return {
    token: signToken(employee),
    employee: { id: employee.id, username: employee.username, name: employee.name },
  };
}

/**
 * Cria as contas iniciais SE ainda não existir nenhuma — não sobrescreve nada
 * depois disso (edite/adicione funcionários direto no banco).
 */
export async function seedEmployeesIfEmpty(
  seed: { username: string; name: string; password: string }[]
): Promise<void> {
  const existing = await db().listEmployees();
  if (existing.length > 0) return;
  for (const s of seed) {
    const passwordHash = await bcrypt.hash(s.password, 10);
    await db().createEmployee({ username: s.username, name: s.name, passwordHash });
    console.log(`     Funcionário criado: ${s.username}`);
  }
}

export interface AuthedRequest extends Request {
  employee?: JwtPayload;
}

/** Middleware Express: exige `Authorization: Bearer <token>`. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Não autenticado.' });
    return;
  }
  try {
    req.employee = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}
