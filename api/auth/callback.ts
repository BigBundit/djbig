import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).send('No code provided');
  }

  try {
    const host = req.headers.host;
    const protocol = host?.includes('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${host}/api/auth/callback`;

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
    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).send('Authentication failed');
  }
}
