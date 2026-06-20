import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { initDb } from './server/db.js';
import authRoutes from './server/authRoutes.js';
import userRoutes from './server/userRoutes.js';
import paymentRoutes from './server/paymentRoutes.js';
import licenseRoutes from './server/licenseRoutes.js';
import { initMysqlDb, getDb } from './server/mysqlDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Init Turso DB
  await initDb();

  // Init MySQL DB (license system) — non-fatal if not configured yet
  try {
    await initMysqlDb();
  } catch (err) {
    console.warn('[MySQL] Not connected — license features disabled:', (err as Error).message);
  }

  const app = express();
  const PORT = 3000;

  // Middleware — allow PHP host + localhost in dev
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.APP_URL,                        // e.g. https://djbig.last-prize.com
    process.env.PHP_HOST_URL,                   // e.g. https://djbig.last-prize.com (same or diff)
  ].filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      // Allow no-origin (Electron, curl, mobile) and whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
  // Preserve raw body for Stripe webhook signature verification
  app.use((req, res, next) => {
    if (req.path === '/api/payment/webhook') {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => { (req as any).rawBody = data; next(); });
    } else {
      express.json()(req, res, next);
    }
  });

  // Serve marketing website (including portal pages)
  app.use('/website', express.static(path.join(__dirname, 'website')));
  app.use('/portal', express.static(path.join(__dirname, 'website', 'portal')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Auth & User routes (v2.0.0)
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/payment', paymentRoutes);
  app.use('/payment', paymentRoutes);
  app.use('/api/license', licenseRoutes);

  // --- OAuth Routes ---
  app.get('/api/auth/google/url', (req, res) => {
    const source = (req.query.source as string) || 'electron';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId) {
      return res.status(500).json({ error: 'Google Client ID not configured' });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'profile email',
      access_type: 'offline',
      prompt: 'consent',
      state: source,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ url });
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const source = (state as string) || 'electron';

    if (!code) {
      return res.status(400).send('No code provided');
    }

    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/callback`;

      // Exchange code for tokens
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const { access_token } = tokenResponse.data;

      // Get user info from Google
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const googleUser = userResponse.data;

      if (source === 'portal') {
        // Upsert user in MySQL and return a portal JWT
        let portalToken: string | null = null;
        let dbUser = googleUser;
        try {
          const db = getDb();
          await db.execute(
            `INSERT INTO djbig_users (google_id, email, name, picture)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), picture=VALUES(picture)`,
            [googleUser.id, googleUser.email, googleUser.name || '', googleUser.picture || '']
          );
          const [rows] = await db.execute<any[]>(
            'SELECT id, email, name, picture FROM djbig_users WHERE google_id = ?',
            [googleUser.id]
          );
          if (rows[0]) {
            dbUser = rows[0];
            portalToken = jwt.sign(
              { userId: rows[0].id, email: rows[0].email, name: rows[0].name, picture: rows[0].picture },
              process.env.JWT_SECRET!,
              { expiresIn: '7d' }
            );
          }
        } catch (dbErr) {
          console.error('[OAuth portal] MySQL error:', dbErr);
        }

        const html = `<html><body><script>
          if(window.opener){
            window.opener.postMessage({type:'OAUTH_PORTAL_SUCCESS',token:${JSON.stringify(portalToken)},user:${JSON.stringify(dbUser)}},'*');
            window.close();
          }
        </script><p>เข้าสู่ระบบสำเร็จ สามารถปิดหน้าต่างนี้ได้</p></body></html>`;
        return res.send(html);
      }

      // Default: Electron app flow
      const html = `<html><body><script>
        if(window.opener){
          window.opener.postMessage({type:'OAUTH_AUTH_SUCCESS',user:${JSON.stringify(googleUser)}},'*');
          window.close();
        } else { window.location.href='/'; }
      </script><p>Authentication successful. You can close this window.</p></body></html>`;
      res.send(html);

    } catch (error) {
      console.error('OAuth error:', error);
      res.status(500).send('Authentication failed');
    }
  });

  // --- WebSocket Server ---
  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server: httpServer });

  // Game State
  const rooms = new Map(); // roomId -> { players: [ws], state: {} }

  wss.on('connection', (ws) => {
    let currentRoomId = null;
    let playerId = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'CREATE_ROOM': {
            const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            playerId = 'HOST';
            rooms.set(roomId, { 
              players: [{ ws, id: playerId, name: data.name || 'Host', score: 0, health: 100, combo: 0 }],
              status: 'WAITING'
            });
            currentRoomId = roomId;
            ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomId, playerId }));
            break;
          }

          case 'JOIN_ROOM': {
            const { roomId, name } = data;
            const room = rooms.get(roomId);
            if (room && room.players.length < 2 && room.status === 'WAITING') {
              playerId = 'GUEST';
              currentRoomId = roomId;
              room.players.push({ ws, id: playerId, name: name || 'Guest', score: 0, health: 100, combo: 0 });
              
              // Notify both players
              room.players.forEach(p => {
                p.ws.send(JSON.stringify({ 
                  type: 'PLAYER_JOINED', 
                  players: room.players.map(pl => ({ id: pl.id, name: pl.name })) 
                }));
              });
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found or full' }));
            }
            break;
          }

          case 'START_GAME': {
            if (currentRoomId && playerId === 'HOST') {
              const room = rooms.get(currentRoomId);
              if (room) {
                room.status = 'PLAYING';
                const startTime = Date.now() + 3000; // Start in 3 seconds
                room.players.forEach(p => {
                  p.ws.send(JSON.stringify({ type: 'GAME_START', startTime }));
                });
              }
            }
            break;
          }

          case 'UPDATE_SCORE': {
            if (currentRoomId) {
              const room = rooms.get(currentRoomId);
              if (room) {
                const player = room.players.find(p => p.id === playerId);
                if (player) {
                  player.score = data.score;
                  player.health = data.health;
                  player.combo = data.combo;
                  
                  // Broadcast to opponent
                  const opponent = room.players.find(p => p.id !== playerId);
                  if (opponent) {
                    opponent.ws.send(JSON.stringify({
                      type: 'OPPONENT_UPDATE',
                      score: player.score,
                      health: player.health,
                      combo: player.combo
                    }));
                  }
                }
              }
            }
            break;
          }
          
          case 'PLAYER_READY': {
            if (currentRoomId) {
              const room = rooms.get(currentRoomId);
              if (room) {
                const opponent = room.players.find(p => p.id !== playerId);
                if (opponent) {
                  opponent.ws.send(JSON.stringify({ type: 'PLAYER_READY', ready: data.ready }));
                }
              }
            }
            break;
          }

          case 'GAME_FINISHED': {
            if (currentRoomId) {
              const room = rooms.get(currentRoomId);
              if (room) {
                const opponent = room.players.find(p => p.id !== playerId);
                if (opponent) {
                  opponent.ws.send(JSON.stringify({ type: 'OPPONENT_FINISHED', score: data.score }));
                }
              }
            }
            break;
          }

          case 'SIGNAL': {
            const { targetId, signal } = data;
            if (currentRoomId) {
              const room = rooms.get(currentRoomId);
              if (room) {
                const targetPlayer = room.players.find(p => p.id === targetId);
                if (targetPlayer) {
                  targetPlayer.ws.send(JSON.stringify({
                    type: 'SIGNAL',
                    senderId: playerId,
                    signal
                  }));
                }
              }
            }
            break;
          }

          case 'SONG_METADATA': {
             if (currentRoomId) {
                 const room = rooms.get(currentRoomId);
                 if (room) {
                     const opponent = room.players.find(p => p.id !== playerId);
                     if (opponent) {
                         opponent.ws.send(JSON.stringify({
                             type: 'SONG_METADATA',
                             metadata: data.metadata
                         }));
                     }
                 }
             }
             break;
          }

          case 'REQUEST_FILE': {
             if (currentRoomId) {
                 const room = rooms.get(currentRoomId);
                 if (room) {
                     const host = room.players.find(p => p.id !== playerId); // Assuming request comes from guest
                     if (host) {
                         host.ws.send(JSON.stringify({ type: 'REQUEST_FILE', requestorId: playerId }));
                     }
                 }
             }
             break;
          }
          
          case 'GAME_OVER': {
             if (currentRoomId) {
                 const room = rooms.get(currentRoomId);
                 if (room) {
                     const opponent = room.players.find(p => p.id !== playerId);
                     if (opponent) {
                         opponent.ws.send(JSON.stringify({ type: 'OPPONENT_FINISHED', score: data.score }));
                     }
                 }
             }
             break;
          }
        }
      } catch (e) {
        console.error('WS Error:', e);
      }
    });

    ws.on('close', () => {
      if (currentRoomId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          // Notify opponent
          const opponent = room.players.find(p => p.id !== playerId);
          if (opponent) {
            opponent.ws.send(JSON.stringify({ type: 'OPPONENT_DISCONNECTED' }));
          }
          rooms.delete(currentRoomId);
        }
      }
    });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve marketing website at root
    app.use(express.static(path.join(__dirname, 'website')));
  }
}

startServer();
