<?php
// Load local credentials (gitignored — create config.local.php on each server)
if (file_exists(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

// Fallback to environment variables (for Docker / CI environments)
defined('DB_HOST')              || define('DB_HOST',              getenv('DB_HOST')              ?: 'localhost');
defined('DB_NAME')              || define('DB_NAME',              getenv('DB_NAME')              ?: 'lastprize_djbig');
defined('DB_USER')              || define('DB_USER',              getenv('DB_USER')              ?: '');
defined('DB_PASS')              || define('DB_PASS',              getenv('DB_PASS')              ?: '');
defined('JWT_SECRET')           || define('JWT_SECRET',           getenv('JWT_SECRET')           ?: '');
defined('GOOGLE_CLIENT_ID')     || define('GOOGLE_CLIENT_ID',     getenv('GOOGLE_CLIENT_ID')     ?: '');
defined('GOOGLE_CLIENT_SECRET') || define('GOOGLE_CLIENT_SECRET', getenv('GOOGLE_CLIENT_SECRET') ?: '');
defined('ADMIN_PASSWORD')       || define('ADMIN_PASSWORD',       getenv('ADMIN_PASSWORD')       ?: '');
defined('APP_URL')              || define('APP_URL',              getenv('APP_URL')              ?: 'https://djbig.last-prize.com');
defined('BANK_NAME')            || define('BANK_NAME',            getenv('BANK_NAME')            ?: 'ธนาคารกสิกรไทย');
defined('BANK_ACCOUNT')         || define('BANK_ACCOUNT',         getenv('BANK_ACCOUNT')         ?: '');
defined('BANK_HOLDER')          || define('BANK_HOLDER',          getenv('BANK_HOLDER')          ?: '');

define('UPLOAD_DIR', dirname(__DIR__) . '/uploads/slips/');
define('UPLOAD_URL', APP_URL . '/uploads/slips/');

function db(): PDO {
    static $pdo;
    if (!$pdo) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
    }
    return $pdo;
}

function init_tables(): void {
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS djbig_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        google_id VARCHAR(128) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        picture VARCHAR(500),
        created_at DATETIME DEFAULT NOW()
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS djbig_payment_slips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        slip_filename VARCHAR(255),
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        submitted_at DATETIME DEFAULT NOW(),
        reviewed_at DATETIME NULL,
        notes TEXT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS djbig_license_keys (
        id INT AUTO_INCREMENT PRIMARY KEY,
        license_key VARCHAR(36) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        slip_id INT NOT NULL,
        created_at DATETIME DEFAULT NOW(),
        activated_at DATETIME NULL,
        machine_id VARCHAR(64) DEFAULT NULL,
        status ENUM('unused','active','revoked') DEFAULT 'unused'
    )");
    // Migrate: add missing columns if table was created before they were added
    $existing_cols = array_column($pdo->query("SHOW COLUMNS FROM djbig_license_keys")->fetchAll(), 'Field');
    if (!in_array('machine_id', $existing_cols))
        $pdo->exec("ALTER TABLE djbig_license_keys ADD COLUMN machine_id VARCHAR(64) DEFAULT NULL");
    if (!in_array('activated_at', $existing_cols))
        $pdo->exec("ALTER TABLE djbig_license_keys ADD COLUMN activated_at DATETIME NULL");
    if (!in_array('status', $existing_cols))
        $pdo->exec("ALTER TABLE djbig_license_keys ADD COLUMN status ENUM('unused','active','revoked') DEFAULT 'unused'");
}
