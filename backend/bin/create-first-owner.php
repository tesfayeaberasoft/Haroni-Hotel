<?php
declare(strict_types=1);

use Haroni\Dcms\AuditLogger;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

$username = getenv('DCMS_BOOTSTRAP_USERNAME');
$fullName = getenv('DCMS_BOOTSTRAP_FULL_NAME');
$password = getenv('DCMS_BOOTSTRAP_PASSWORD');
putenv('DCMS_BOOTSTRAP_PASSWORD');
unset($_ENV['DCMS_BOOTSTRAP_PASSWORD']);

if (!is_string($username) || !preg_match('/^[A-Za-z0-9._-]{3,80}$/D', $username)) {
    fwrite(STDERR, "DCMS_BOOTSTRAP_USERNAME must be 3 to 80 letters, numbers, dots, underscores or hyphens.\n");
    exit(2);
}
if (!is_string($fullName) || trim($fullName) === '') {
    fwrite(STDERR, "DCMS_BOOTSTRAP_FULL_NAME must not be empty.\n");
    exit(2);
}
if (!is_string($password) || strlen($password) < 12 || strlen($password) > 72) {
    fwrite(STDERR, "DCMS_BOOTSTRAP_PASSWORD must be 12 to 72 bytes. Use at least 12 ASCII characters.\n");
    exit(2);
}
$passwordHash = password_hash($password, PASSWORD_DEFAULT);
unset($password);

try {
    $pdo = dcms_db();
    $pdo->beginTransaction();
    $count = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'owner'")->fetchColumn();
    if ($count !== 0) {
        throw new RuntimeException('An Owner already exists; bootstrap is disabled.');
    }
    $insert = $pdo->prepare(
        "INSERT INTO users (username, full_name, password_hash, role)
         VALUES (?, ?, ?, 'owner')"
    );
    $insert->execute([$username, trim($fullName), $passwordHash]);
    $id = (int) $pdo->lastInsertId();
    AuditLogger::record($pdo, $id, 'initial_owner_created', 'user', $id);
    $pdo->commit();
    fwrite(STDOUT, "Initial Owner created with user ID {$id}.\n");
} catch (Throwable $exception) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Owner bootstrap failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
