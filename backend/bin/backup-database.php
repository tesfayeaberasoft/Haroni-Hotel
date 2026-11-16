<?php
declare(strict_types=1);

use Haroni\Dcms\DatabaseMaintenance;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

try {
    $backup = DatabaseMaintenance::backup();
    fwrite(STDOUT, sprintf(
        "Database backup created: %s (%d bytes)\nSHA-256: %s\n",
        $backup['filename'],
        $backup['bytes'],
        $backup['sha256']
    ));
} catch (Throwable $exception) {
    fwrite(STDERR, 'Database backup failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
