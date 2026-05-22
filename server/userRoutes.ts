import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './middleware.js';
import { db } from './db.js';

const router = Router();

// GET /api/user/me  — full profile
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.execute({
      sql: 'SELECT id, email, username, plan, created_at, premium_expires_at FROM users WHERE id = ?',
      args: [req.userId!],
    });

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({ user });
  } catch (err) {
    console.error('[User] /me error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/plan  — lightweight check used by Electron app to gate upload feature
router.get('/plan', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.execute({
      sql: 'SELECT plan, premium_expires_at FROM users WHERE id = ?',
      args: [req.userId!],
    });

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Auto-downgrade if premium expired
    let plan = user.plan as string;
    if (plan === 'premium' && user.premium_expires_at) {
      const expired = new Date(user.premium_expires_at as string) < new Date();
      if (expired) {
        plan = 'free';
        await db.execute({
          sql: "UPDATE users SET plan = 'free', premium_expires_at = NULL WHERE id = ?",
          args: [req.userId!],
        });
      }
    }

    return res.json({ plan });
  } catch (err) {
    console.error('[User] /plan error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
