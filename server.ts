import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON
  app.use(express.json());

  // --- OAuth Routes ---
  app.get('/api/auth/google/url', (req, res) => {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
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
      prompt: 'consent'
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ url });
  });

  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send('No code provided');
    }

    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
      
      // Exchange code for tokens
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      const { access_token } = tokenResponse.data;

      // Get user info
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const user = userResponse.data;

      // Send success message to parent window
      const html = `
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user: ${JSON.stringify(user)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. You can close this window.</p>
          </body>
        </html>
      `;
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
    // Serve static files in production
    app.use(express.static(path.join(__dirname, 'dist')));
  }
}

startServer();
