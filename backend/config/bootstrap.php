<?php
declare(strict_types=1);

use Haroni\Dcms\Database;

define('DCMS_ROOT', dirname(__DIR__));

$envFile = DCMS_ROOT . DIRECTORY_SEPARATOR . '.env';
if (is_file($envFile) && is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim(trim($value), "\"'");
        if ($key !== '') {
            $environmentValue = getenv($key);
            if ($environmentValue === false) {
                $environmentValue = $value;
                putenv($key . '=' . $value);
            }
            $_ENV[$key] = $environmentValue;
        }
    }
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'Haroni\\Dcms\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = DCMS_ROOT . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR
        . str_replace('\\', DIRECTORY_SEPARATOR, substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'Africa/Addis_Ababa');

function dcms_env(string $name, ?string $default = null): ?string
{
    if (array_key_exists($name, $_ENV) && is_string($_ENV[$name])) {
        return $_ENV[$name];
    }
    $value = getenv($name);
    return $value === false ? $default : $value;
}

function dcms_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = dcms_env('DB_DSN');
    $username = dcms_env('DB_USERNAME');
    $password = dcms_env('DB_PASSWORD');
    if ($dsn === null || $username === null || $password === null) {
        throw new RuntimeException('Database configuration is incomplete.');
    }
    $pdo = Database::connect($dsn, $username, $password);
    return $pdo;
}

if (PHP_SAPI !== 'cli' && session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Strict');
    session_name('haroni_dcms');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}
