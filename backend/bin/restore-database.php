<?php
declare(strict_types=1);

use Haroni\Dcms\DatabaseMaintenance;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

if ($argc !== 2) {
    fwrite(STDERR, "Usage: php restore-database.php <backup-filename.sql>\n");
    exit(2);
}

try {
    $database = DatabaseMaintenance::databaseName();
    fwrite(STDOUT, "This operation imports into the EMPTY database '{$database}'. Existing tables are never overwritten.\n");
    fwrite(STDOUT, "Type the database name to continue: ");
    $confirmation = trim((string) fgets(STDIN));
    DatabaseMaintenance::restore(basename($argv[1]), dcms_db(), $confirmation);
    fwrite(STDOUT, "Database restore completed from {$argv[1]}.\n");
} catch (Throwable $exception) {
    fwrite(STDERR, 'Database restore failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
