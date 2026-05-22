import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from './db.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'email, username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const id = randomUUID();

    await db.execute({
      sql: 'INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)',
      args: [id, email.toLowerCase().trim(), username.trim(), passwordHash],
    });

    const token = jwt.sign({ userId: id, email }, process.env.JWT_SECRET!, { expiresIn: '30d' });
    return res.status(201).json({
      token,
      user: { id, email: email.toLowerCase().trim(), username: username.trim(), plan: 'free' },
    });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }
    console.error('[Auth] Register error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await db.execute({
      sql: 'SELECT id, email, username, password_hash, plan FROM users WHERE email = ?',
      args: [email.toLowerCase().trim()],
    });

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: '30d' });
    return res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, plan: user.plan },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
