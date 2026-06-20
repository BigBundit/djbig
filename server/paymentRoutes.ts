import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from './db.js';
import { requireAuth } from './middleware.js';

const router = Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(key);
}

// POST /api/payment/create-checkout
// Creates a Stripe Checkout session for 199 THB one-time
router.post('/create-checkout', requireAuth, async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const userId = (req as any).userId;
    const email = (req as any).email;

    const baseUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'promptpay'],
      line_items: [
        {
          price_data: {
            currency: 'thb',
            product_data: {
              name: 'DJBIG Premium',
              description: 'อัพโหลดเพลง mp3/mp4 ไม่จำกัด',
              images: [`${baseUrl}/logodjbig.png`],
            },
            unit_amount: 19900, // 199 THB in satang
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: email,
      metadata: { userId },
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment/cancel`,
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payment/webhook
// Stripe calls this after successful payment
router.post('/webhook', async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    if (webhookSecret) {
      const sig = req.headers['stripe-signature'] as string;
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody || req.body,
        sig,
        webhookSecret
      );
    } else {
      // Dev mode: no signature check
      event = req.body as Stripe.Event;
    }
  } catch (e: any) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;

    if (userId) {
      await db.execute({
        sql: `UPDATE users SET plan = 'premium', premium_expires_at = NULL WHERE id = ?`,
        args: [userId],
      });
      console.log(`[Payment] User ${userId} upgraded to premium`);
    }
  }

  res.json({ received: true });
});

// GET /payment/success — verify session with Stripe and update DB immediately
router.get('/success', async (req: Request, res: Response) => {
  const { session_id } = req.query as { session_id?: string };
  let upgraded = false;

  if (session_id) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === 'paid') {
        const userId = session.metadata?.userId;
        if (userId) {
          await db.execute({
            sql: `UPDATE users SET plan = 'premium', premium_expires_at = NULL WHERE id = ?`,
            args: [userId],
          });
          console.log(`[Payment] User ${userId} upgraded to premium via success page`);
          upgraded = true;
        }
      }
    } catch (e: any) {
      console.error('Success page verify error:', e.message);
    }
  }

  res.send(`
    <html>
      <head>
        <title>DJBIG Premium</title>
        <style>
          body { background: #0f172a; color: white; font-family: monospace;
                 display: flex; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; text-align: center; }
          h1 { font-size: 2rem; color: #f59e0b; }
          p { color: #94a3b8; margin-top: 1rem; }
          .ok { color: #4ade80; font-size: 0.85rem; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div>
          <h1>★ PREMIUM ACTIVATED!</h1>
          <p>ชำระเงินสำเร็จแล้ว</p>
          ${upgraded ? '<p class="ok">✓ อัปเดตแผนเรียบร้อย — กลับไปที่แอป DJBIG และกด refresh plan</p>' : '<p>กลับไปที่แอป DJBIG และกด refresh plan</p>'}
        </div>
      </body>
    </html>
  `);
});

// GET /payment/cancel
router.get('/cancel', (req: Request, res: Response) => {
  res.send(`
    <html>
      <head>
        <title>DJBIG</title>
        <style>
          body { background: #0f172a; color: white; font-family: monospace;
                 display: flex; align-items: center; justify-content: center;
                 height: 100vh; margin: 0; text-align: center; }
          p { color: #64748b; }
        </style>
      </head>
      <body><div><p>ยกเลิกการชำระเงิน — ปิดหน้าต่างนี้ได้เลย</p></div></body>
    </html>
  `);
});

export default router;
