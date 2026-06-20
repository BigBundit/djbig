<?php
function b64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function b64url_decode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/'));
}

function jwt_sign(array $payload, string $secret, int $expiry_days = 7): string {
    $header  = b64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload['iat'] = time();
    $payload['exp'] = time() + $expiry_days * 86400;
    $body    = b64url_encode(json_encode($payload));
    $sig     = b64url_encode(hash_hmac('sha256', "$header.$body", $secret, true));
    return "$header.$body.$sig";
}

function jwt_verify(string $token, string $secret): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $body, $sig] = $parts;
    $expected = b64url_encode(hash_hmac('sha256', "$header.$body", $secret, true));
    if (!hash_equals($expected, $sig)) return null;
    $payload = json_decode(b64url_decode($body), true);
    if (!$payload || $payload['exp'] < time()) return null;
    return $payload;
}

function bearer_token(): ?string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $h, $m)) return $m[1];
    return null;
}

function require_auth(): array {
    $token = bearer_token();
    if (!$token) { json_out(401, ['error' => 'Unauthorized']); exit; }
    $payload = jwt_verify($token, JWT_SECRET);
    if (!$payload) { json_out(401, ['error' => 'Invalid or expired token']); exit; }
    return $payload;
}

function require_admin(): void {
    $token = bearer_token();
    if (!$token) { json_out(401, ['error' => 'Unauthorized']); exit; }
    $payload = jwt_verify($token, JWT_SECRET . '_admin');
    if (!$payload || empty($payload['admin'])) { json_out(403, ['error' => 'Forbidden']); exit; }
}
