<?php
require __DIR__ . '/config.php';
require __DIR__ . '/lib/jwt.php';

// ── CORS ────────────────────────────────────────────────────────────────────
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed_origins = [APP_URL, 'http://localhost:3000', 'http://localhost:5173'];
$is_electron = !$origin || str_starts_with($origin, 'app://') || str_starts_with($origin, 'file://');
if ($is_electron || in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: " . ($origin ?: '*'));
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Helper ───────────────────────────────────────────────────────────────────
function json_out(int $code, mixed $data): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

function http_post(string $url, array $data): array {
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => 'Content-Type: application/x-www-form-urlencoded',
        'content' => http_build_query($data),
        'timeout' => 10,
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    return $res ? (json_decode($res, true) ?? []) : [];
}

function http_get(string $url, string $bearer = ''): array {
    $headers = $bearer ? ["Authorization: Bearer $bearer"] : [];
    $ctx = stream_context_create(['http' => [
        'header'  => implode("\r\n", $headers),
        'timeout' => 10,
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    return $res ? (json_decode($res, true) ?? []) : [];
}

function gen_license_key(): string {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $seg = fn() => implode('', array_map(fn($_) => $chars[random_int(0, 35)], range(1,4)));
    return 'DJBIG-' . $seg() . '-' . $seg() . '-' . $seg() . '-' . $seg();
}

// ── Router ───────────────────────────────────────────────────────────────────
try {
    init_tables();
    $path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $path   = preg_replace('#^/api#', '', rtrim($path, '/'));
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET'  && $path === '/auth/google/url')       { route_google_url(); }
    elseif ($method === 'GET'  && $path === '/auth/callback')     { route_google_callback(); }
    elseif ($method === 'GET'  && $path === '/license/status')    { route_license_status(); }
    elseif ($method === 'POST' && $path === '/license/validate')  { route_license_validate(); }
    elseif ($method === 'POST' && $path === '/slip/upload')       { route_slip_upload(); }
    elseif ($method === 'POST' && $path === '/admin/login')       { route_admin_login(); }
    elseif ($method === 'GET'  && $path === '/admin/slips')       { route_admin_slips(); }
    elseif ($method === 'POST' && $path === '/admin/approve')     { route_admin_approve(); }
    elseif ($method === 'POST' && $path === '/admin/reject')      { route_admin_reject(); }
    elseif ($method === 'GET'  && $path === '/admin/keys')        { route_admin_keys(); }
    elseif ($method === 'POST' && $path === '/admin/revoke')      { route_admin_revoke(); }
    elseif ($method === 'POST' && $path === '/admin/unlink-machine') { route_admin_unlink(); }
    elseif ($method === 'GET'  && $path === '/license/bank-info')   { route_bank_info(); }
    else { json_out(404, ['error' => 'Not found']); }

} catch (PDOException $e) {
    json_out(500, ['error' => 'Database error: ' . $e->getMessage()]);
} catch (Throwable $e) {
    json_out(500, ['error' => $e->getMessage()]);
}

// ── Auth: Google URL ─────────────────────────────────────────────────────────
function route_google_url(): void {
    $source      = $_GET['source'] ?? 'portal';
    $redirect_uri = APP_URL . '/api/auth/callback';
    $params = http_build_query([
        'client_id'     => GOOGLE_CLIENT_ID,
        'redirect_uri'  => $redirect_uri,
        'response_type' => 'code',
        'scope'         => 'profile email',
        'access_type'   => 'offline',
        'prompt'        => 'consent',
        'state'         => $source,
    ]);
    json_out(200, ['url' => 'https://accounts.google.com/o/oauth2/v2/auth?' . $params]);
}

// ── Auth: Google Callback ────────────────────────────────────────────────────
function route_google_callback(): void {
    $code   = $_GET['code']  ?? '';
    $source = $_GET['state'] ?? 'portal';
    if (!$code) { echo '<p>No code</p>'; exit; }

    $redirect_uri = APP_URL . '/api/auth/callback';

    // Exchange code → tokens
    $tokens = http_post('https://oauth2.googleapis.com/token', [
        'code'          => $code,
        'client_id'     => GOOGLE_CLIENT_ID,
        'client_secret' => GOOGLE_CLIENT_SECRET,
        'redirect_uri'  => $redirect_uri,
        'grant_type'    => 'authorization_code',
    ]);
    if (empty($tokens['access_token'])) {
        echo '<p>Token exchange failed</p>'; exit;
    }

    // Get Google user info
    $guser = http_get('https://www.googleapis.com/oauth2/v2/userinfo', $tokens['access_token']);
    if (empty($guser['id'])) { echo '<p>Failed to get user info</p>'; exit; }

    // Upsert user in DB
    $pdo = db();
    $pdo->prepare("INSERT INTO djbig_users (google_id, email, name, picture)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), picture=VALUES(picture)")
        ->execute([$guser['id'], $guser['email'], $guser['name'] ?? '', $guser['picture'] ?? '']);

    $row = $pdo->prepare("SELECT id, email, name, picture FROM djbig_users WHERE google_id = ?");
    $row->execute([$guser['id']]);
    $user = $row->fetch();

    $token = jwt_sign(['userId' => $user['id'], 'email' => $user['email'],
                       'name'   => $user['name'], 'picture' => $user['picture']], JWT_SECRET, 7);

    $user_json  = json_encode($user);
    $token_json = json_encode($token);

    // Post message back to opener popup
    echo <<<HTML
<!DOCTYPE html><html><body><script>
if(window.opener){
    window.opener.postMessage({type:'OAUTH_PORTAL_SUCCESS',token:{$token_json},user:{$user_json}},'*');
    window.close();
}
</script><p>เข้าสู่ระบบสำเร็จ — สามารถปิดหน้าต่างนี้ได้</p></body></html>
HTML;
    exit;
}

// ── License: Status ──────────────────────────────────────────────────────────
function route_license_status(): void {
    $auth = require_auth();
    $pdo  = db();

    $slip = $pdo->prepare("SELECT * FROM djbig_payment_slips WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1");
    $slip->execute([$auth['userId']]);
    $slip_row = $slip->fetch();

    $key_row = null;
    if ($slip_row && $slip_row['status'] === 'approved') {
        $key = $pdo->prepare("SELECT license_key, status, machine_id FROM djbig_license_keys WHERE slip_id = ?");
        $key->execute([$slip_row['id']]);
        $key_row = $key->fetch();
    }

    json_out(200, [
        'slip' => $slip_row ?: null,
        'key'  => $key_row ? $key_row['license_key'] : null,
    ]);
}

// ── License: Validate (Electron) ─────────────────────────────────────────────
function route_license_validate(): void {
    $b = body();
    $key_input = trim($b['key'] ?? '');
    $machine   = trim($b['machineId'] ?? '');

    if (!$key_input) json_out(400, ['valid' => false, 'error' => 'กรุณากรอก Key']);

    $pdo = db();
    $stmt = $pdo->prepare("SELECT * FROM djbig_license_keys WHERE license_key = ? AND status != 'revoked'");
    $stmt->execute([$key_input]);
    $k = $stmt->fetch();

    if (!$k) json_out(200, ['valid' => false, 'error' => 'Key ไม่ถูกต้องหรือถูกยกเลิกแล้ว']);

    // Machine binding check
    if ($k['machine_id'] && $machine && $k['machine_id'] !== $machine) {
        json_out(200, ['valid' => false, 'error' => 'Key นี้ถูกผูกกับเครื่องอื่นแล้ว (1 Key = 1 เครื่อง)']);
    }

    // Bind machine on first use
    if (!$k['machine_id'] && $machine) {
        $pdo->prepare("UPDATE djbig_license_keys SET status='active', activated_at=NOW(), machine_id=? WHERE id=?")
            ->execute([$machine, $k['id']]);
    }

    json_out(200, ['valid' => true, 'plan' => 'premium', 'email' => $k['email']]);
}

// ── Slip: Upload ─────────────────────────────────────────────────────────────
function route_slip_upload(): void {
    $auth = require_auth();

    if (empty($_FILES['slip'])) json_out(400, ['error' => 'ไม่พบไฟล์สลิป']);

    $file = $_FILES['slip'];
    $ext  = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'])) {
        json_out(400, ['error' => 'รองรับเฉพาะไฟล์รูปภาพ']);
    }
    if ($file['size'] > 10 * 1024 * 1024) json_out(400, ['error' => 'ไฟล์ใหญ่เกิน 10MB']);

    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);

    $filename = time() . '_' . $auth['userId'] . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], UPLOAD_DIR . $filename)) {
        json_out(500, ['error' => 'อัปโหลดไม่สำเร็จ']);
    }

    $pdo  = db();
    $name = body()['name'] ?? '';

    // Check if pending slip already exists — update it instead of duplicate
    $existing = $pdo->prepare("SELECT id FROM djbig_payment_slips WHERE user_id = ? AND status = 'pending'");
    $existing->execute([$auth['userId']]);
    $ex = $existing->fetch();

    if ($ex) {
        $pdo->prepare("UPDATE djbig_payment_slips SET slip_filename=?, name=?, submitted_at=NOW() WHERE id=?")
            ->execute([$filename, $name, $ex['id']]);
    } else {
        $pdo->prepare("INSERT INTO djbig_payment_slips (user_id, email, name, slip_filename) VALUES (?,?,?,?)")
            ->execute([$auth['userId'], $auth['email'], $name, $filename]);
    }

    json_out(200, ['ok' => true, 'filename' => $filename]);
}

// ── Admin: Login ─────────────────────────────────────────────────────────────
function route_admin_login(): void {
    $b = body();
    if (($b['password'] ?? '') !== ADMIN_PASSWORD) {
        json_out(401, ['error' => 'รหัสผ่านไม่ถูกต้อง']);
    }
    $token = jwt_sign(['admin' => true], JWT_SECRET . '_admin', 1);
    json_out(200, ['token' => $token]);
}

// ── Admin: List Slips ────────────────────────────────────────────────────────
function route_admin_slips(): void {
    require_admin();
    $pdo  = db();
    $rows = $pdo->query("
        SELECT s.*, u.name as user_name, u.picture,
               k.license_key, k.machine_id, k.status as key_status
        FROM djbig_payment_slips s
        JOIN djbig_users u ON u.id = s.user_id
        LEFT JOIN djbig_license_keys k ON k.slip_id = s.id
        ORDER BY s.submitted_at DESC
    ")->fetchAll();
    json_out(200, ['slips' => $rows]);
}

// ── Admin: Approve Slip → Generate Key ──────────────────────────────────────
function route_admin_approve(): void {
    require_admin();
    $b       = body();
    $slip_id = intval($b['slipId'] ?? 0);
    if (!$slip_id) json_out(400, ['error' => 'Missing slipId']);

    $pdo = db();
    $slip = $pdo->prepare("SELECT * FROM djbig_payment_slips WHERE id = ?");
    $slip->execute([$slip_id]);
    $s = $slip->fetch();
    if (!$s) json_out(404, ['error' => 'Slip not found']);

    // Check if key already exists
    $existing = $pdo->prepare("SELECT license_key FROM djbig_license_keys WHERE slip_id = ?");
    $existing->execute([$slip_id]);
    $ex = $existing->fetch();

    if ($ex) {
        $key = $ex['license_key'];
    } else {
        // Generate unique key
        do {
            $key = gen_license_key();
            $dup = $pdo->prepare("SELECT id FROM djbig_license_keys WHERE license_key = ?");
            $dup->execute([$key]);
        } while ($dup->fetch());

        $pdo->prepare("INSERT INTO djbig_license_keys (license_key, user_id, email, slip_id) VALUES (?,?,?,?)")
            ->execute([$key, $s['user_id'], $s['email'], $slip_id]);
    }

    $pdo->prepare("UPDATE djbig_payment_slips SET status='approved', reviewed_at=NOW() WHERE id=?")
        ->execute([$slip_id]);

    json_out(200, ['ok' => true, 'key' => $key]);
}

// ── Admin: Reject Slip ───────────────────────────────────────────────────────
function route_admin_reject(): void {
    require_admin();
    $b       = body();
    $slip_id = intval($b['slipId'] ?? 0);
    $notes   = $b['notes'] ?? '';
    if (!$slip_id) json_out(400, ['error' => 'Missing slipId']);

    db()->prepare("UPDATE djbig_payment_slips SET status='rejected', reviewed_at=NOW(), notes=? WHERE id=?")
       ->execute([$notes, $slip_id]);

    json_out(200, ['ok' => true]);
}

// ── Admin: List Keys ─────────────────────────────────────────────────────────
function route_admin_keys(): void {
    require_admin();
    $rows = db()->query("
        SELECT k.*, s.slip_filename
        FROM djbig_license_keys k
        LEFT JOIN djbig_payment_slips s ON s.id = k.slip_id
        ORDER BY k.created_at DESC
    ")->fetchAll();
    json_out(200, ['keys' => $rows]);
}

// ── Bank Info (public) ───────────────────────────────────────────────────────
function route_bank_info(): void {
    json_out(200, ['bank' => BANK_NAME, 'account' => BANK_ACCOUNT, 'holder' => BANK_HOLDER]);
}

// ── Admin: Revoke Key ────────────────────────────────────────────────────────
function route_admin_revoke(): void {
    require_admin();
    $b  = body();
    $id = intval($b['keyId'] ?? 0);
    if (!$id) json_out(400, ['error' => 'Missing keyId']);

    db()->prepare("UPDATE djbig_license_keys SET status='revoked' WHERE id=?")
       ->execute([$id]);

    json_out(200, ['ok' => true]);
}

// ── Admin: Unlink Machine ────────────────────────────────────────────────────
function route_admin_unlink(): void {
    require_admin();
    $b  = body();
    $id = intval($b['keyId'] ?? 0);
    if (!$id) json_out(400, ['error' => 'Missing keyId']);

    db()->prepare("UPDATE djbig_license_keys SET machine_id=NULL, status='unused', activated_at=NULL WHERE id=?")
       ->execute([$id]);

    json_out(200, ['ok' => true]);
}
