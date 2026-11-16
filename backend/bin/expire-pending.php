<?php
declare(strict_types=1);

use Haroni\Dcms\CreditTransactionService;
use Haroni\Dcms\NotificationService;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

try {
    $pdo = dcms_db();
    $reminders = (new NotificationService($pdo))->reminders();
    $expired = (new CreditTransactionService($pdo))->expirePending();
    $cleanedAttempts = $pdo->exec(
        'DELETE FROM login_attempts WHERE first_failed_at < UTC_TIMESTAMP(6) - INTERVAL 1 DAY'
    );
    $cleanedPinAttempts = $pdo->exec(
        'DELETE FROM confirmation_pin_attempts WHERE updated_at < UTC_TIMESTAMP(6) - INTERVAL 1 DAY'
    );
    fwrite(STDOUT, sprintf(
        "Created %d reminder(s); expired %d pending guest confirmation(s); removed %d stale login and %d PIN attempt record(s).\n",
        $reminders,
        $expired,
        $cleanedAttempts,
        $cleanedPinAttempts
    ));
} catch (Throwable $exception) {
    fwrite(STDERR, 'Expiration job failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
