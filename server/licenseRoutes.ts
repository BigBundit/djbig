import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb } from './mysqlDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// File upload config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/slips'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

function generateLicenseKey(): string {
  const hex = randomUUID().replace(/-/g, '').toUpperCase();
  return `DJBIG-${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
}

function getPortalToken(req: Request): { userId: number; email: string; name: string } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
    if (!payload.userId || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

function isAdmin(req: Request): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

// --- Public routes ---

// GET /api/license/bank-info
router.get('/bank-info', (_req, res) => {
  res.json({
    bank: process.env.BANK_NAME || 'กสิกรไทย',
    account: process.env.BANK_ACCOUNT || 'XXX-X-XXXXX-X',
    holder: process.env.BANK_HOLDER || 'กรุณาติดต่อแอดมิน',
    amount: 199,
  });
});

// POST /api/license/upsert-user  — called after Google OAuth for portal
router.post('/upsert-user', async (req: Request, res: Response) => {
  const { google_id, email, name, picture } = req.body;
  if (!google_id || !email) return res.status(400).json({ error: 'Missing fields' });

  try {
    const db = getDb();
    await db.execute(
      `INSERT INTO djbig_users (google_id, email, name, picture)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), picture=VALUES(picture)`,
      [google_id, email, name || '', picture || '']
    );

    const [rows] = await db.execute<any[]>(
      'SELECT id, google_id, email, name, picture FROM djbig_users WHERE google_id = ?',
      [google_id]
    );
    const user = rows[0];
    if (!user) return res.status(500).json({ error: 'User not found after upsert' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name, picture: user.picture },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, picture: user.picture } });
  } catch (err) {
    console.error('[license/upsert-user]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/license/status — user's current slip & key status
router.get('/status', async (req: Request, res: Response) => {
  const token = getPortalToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = getDb();
    const [slips] = await db.execute<any[]>(
      `SELECT id, status, submitted_at, notes FROM djbig_payment_slips
       WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`,
      [token.userId]
    );

    if (!slips.length) return res.json({ slip: null, key: null });

    const slip = slips[0];
    let key: string | null = null;

    if (slip.status === 'approved') {
      const [keys] = await db.execute<any[]>(
        `SELECT license_key FROM djbig_license_keys WHERE slip_id = ? LIMIT 1`,
        [slip.id]
      );
      key = keys[0]?.license_key || null;
    }

    res.json({ slip, key });
  } catch (err) {
    console.error('[license/status]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/submit-slip — upload payment slip
router.post('/submit-slip', upload.single('slip'), async (req: Request, res: Response) => {
  const token = getPortalToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No slip image uploaded' });

  try {
    const db = getDb();

    // Check if already submitted pending/approved
    const [existing] = await db.execute<any[]>(
      `SELECT id, status FROM djbig_payment_slips WHERE user_id = ? AND status IN ('pending','approved') LIMIT 1`,
      [token.userId]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Already submitted', status: existing[0].status });
    }

    await db.execute(
      `INSERT INTO djbig_payment_slips (user_id, email, name, slip_filename) VALUES (?, ?, ?, ?)`,
      [token.userId, token.email, token.name || '', req.file.filename]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[license/submit-slip]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/validate — game calls this to check a key (with machine binding)
router.post('/validate', async (req: Request, res: Response) => {
  const { key, machineId } = req.body;
  if (!key) return res.status(400).json({ valid: false, error: 'No key provided' });

  try {
    const db = getDb();
    const [rows] = await db.execute<any[]>(
      `SELECT id, email, status, machine_id FROM djbig_license_keys WHERE license_key = ?`,
      [key]
    );

    if (!rows.length) return res.json({ valid: false, error: 'Key ไม่ถูกต้อง' });
    const k = rows[0];
    if (k.status === 'revoked') return res.json({ valid: false, error: 'Key ถูกยกเลิกการใช้งานแล้ว' });

    // Machine ID binding check
    if (k.machine_id && machineId && k.machine_id !== machineId) {
      return res.json({ valid: false, error: 'Key นี้ถูกผูกกับเครื่องอื่นแล้ว ไม่สามารถใช้งานได้ (1 Key = 1 เครื่อง)' });
    }

    // First activation: bind machine_id and mark active
    if (!k.machine_id && machineId) {
      await db.execute(
        `UPDATE djbig_license_keys SET status='active', activated_at=NOW(), machine_id=? WHERE id=?`,
        [machineId, k.id]
      );
    } else if (k.status === 'unused') {
      await db.execute(
        `UPDATE djbig_license_keys SET status='active', activated_at=NOW() WHERE id=?`,
        [k.id]
      );
    }

    res.json({ valid: true, plan: 'premium', email: k.email });
  } catch (err) {
    console.error('[license/validate]', err);
    res.status(500).json({ valid: false, error: 'Server error' });
  }
});

// --- Admin login ---
router.post('/admin/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '12h' });
  res.json({ token });
});

// --- Admin routes (require admin token) ---

// GET /api/license/admin/slips
router.get('/admin/slips', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { status } = req.query;
  try {
    const db = getDb();
    let q = `SELECT s.id, s.user_id, s.email, s.name, s.slip_filename, s.status,
                    s.submitted_at, s.reviewed_at, s.notes,
                    k.license_key
             FROM djbig_payment_slips s
             LEFT JOIN djbig_license_keys k ON k.slip_id = s.id`;
    const params: any[] = [];
    if (status && status !== 'all') {
      q += ' WHERE s.status = ?';
      params.push(status);
    }
    q += ' ORDER BY s.submitted_at DESC';

    const [rows] = await db.execute<any[]>(q, params);
    res.json({ slips: rows });
  } catch (err) {
    console.error('[admin/slips]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/admin/approve
router.post('/admin/approve', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { slip_id } = req.body;
  if (!slip_id) return res.status(400).json({ error: 'Missing slip_id' });

  try {
    const db = getDb();

    // Get slip info
    const [slips] = await db.execute<any[]>(
      `SELECT id, user_id, email, status FROM djbig_payment_slips WHERE id = ?`,
      [slip_id]
    );
    if (!slips.length) return res.status(404).json({ error: 'Slip not found' });
    const slip = slips[0];
    if (slip.status === 'approved') return res.status(409).json({ error: 'Already approved' });

    // Generate key
    const licenseKey = generateLicenseKey();

    await db.execute(
      `UPDATE djbig_payment_slips SET status='approved', reviewed_at=NOW() WHERE id=?`,
      [slip_id]
    );

    await db.execute(
      `INSERT INTO djbig_license_keys (license_key, user_id, email, slip_id) VALUES (?, ?, ?, ?)`,
      [licenseKey, slip.user_id, slip.email, slip_id]
    );

    res.json({ ok: true, license_key: licenseKey });
  } catch (err) {
    console.error('[admin/approve]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/admin/reject
router.post('/admin/reject', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { slip_id, notes } = req.body;
  if (!slip_id) return res.status(400).json({ error: 'Missing slip_id' });

  try {
    const db = getDb();
    await db.execute(
      `UPDATE djbig_payment_slips SET status='rejected', reviewed_at=NOW(), notes=? WHERE id=?`,
      [notes || '', slip_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/reject]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/license/admin/keys
router.get('/admin/keys', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const db = getDb();
    const [rows] = await db.execute<any[]>(
      `SELECT id, license_key, email, status, created_at, activated_at, machine_id FROM djbig_license_keys ORDER BY created_at DESC`
    );
    res.json({ keys: rows });
  } catch (err) {
    console.error('[admin/keys]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/admin/revoke
router.post('/admin/revoke', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { key_id } = req.body;
  try {
    const db = getDb();
    await db.execute(`UPDATE djbig_license_keys SET status='revoked' WHERE id=?`, [key_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/revoke]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/license/admin/unlink-machine — remove machine binding so key can be used on new PC
router.post('/admin/unlink-machine', async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const { key_id } = req.body;
  try {
    const db = getDb();
    await db.execute(`UPDATE djbig_license_keys SET machine_id=NULL WHERE id=?`, [key_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/unlink-machine]', err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
