<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use RuntimeException;

final class DatabaseMaintenance
{
    public static function listBackups(): array
    {
        $directory = self::backupDirectory();
        $backups = [];
        foreach (new \DirectoryIterator($directory) as $entry) {
            $filename = $entry->getFilename();
            if ($entry->isDot() || $entry->isLink() || !$entry->isFile()
                || !preg_match('/^haroni-dcms-(\d{8}-\d{6})-[a-f0-9]{8}\.sql$/D', $filename, $match)) {
                continue;
            }
            $checksumPath = $entry->getPathname() . '.sha256';
            if (!is_file($checksumPath) || is_link($checksumPath)) {
                continue;
            }
            $createdAt = \DateTimeImmutable::createFromFormat(
                '!Ymd-His',
                $match[1],
                new \DateTimeZone('UTC')
            );
            if ($createdAt === false) {
                continue;
            }
            $backups[] = [
                'filename' => $filename,
                'created_at' => $createdAt->format(DATE_ATOM),
                'size_bytes' => $entry->getSize(),
            ];
        }
        usort($backups, static fn(array $left, array $right): int =>
            strcmp($right['created_at'], $left['created_at'])
        );
        return array_slice($backups, 0, 500);
    }

    public static function backupPath(string $filename): string
    {
        if (!preg_match('/^haroni-dcms-\d{8}-\d{6}-[a-f0-9]{8}\.sql$/D', $filename)) {
            throw new ApiException(400, 'Invalid backup filename.');
        }
        $directory = self::backupDirectory();
        $path = realpath($directory . DIRECTORY_SEPARATOR . $filename);
        if ($path === false || !is_file($path) || is_link($directory . DIRECTORY_SEPARATOR . $filename)
            || !self::isWithin($path, $directory)) {
            throw new ApiException(404, 'Backup file not found.');
        }
        $checksumPath = $path . '.sha256';
        if (is_link($checksumPath)) {
            throw new ApiException(409, 'Backup checksum is invalid.');
        }
        $checksumText = is_file($checksumPath) ? file_get_contents($checksumPath) : false;
        $expectedHash = hash_file('sha256', $path);
        if (!is_string($checksumText) || !is_string($expectedHash)
            || !preg_match('/^([a-f0-9]{64})\s+(\S+)$/D', trim($checksumText), $match)
            || !hash_equals($match[1], $expectedHash)
            || !hash_equals($filename, $match[2])) {
            throw new ApiException(409, 'Backup checksum is missing or does not match.');
        }
        return $path;
    }

    public static function backup(): array
    {
        $connection = self::connectionDetails();
        $directory = self::backupDirectory();
        $binary = dcms_env('MYSQLDUMP_BIN', 'mysqldump');
        $filename = 'haroni-dcms-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.sql';
        $path = $directory . DIRECTORY_SEPARATOR . $filename;
        if (file_exists($path)) {
            throw new RuntimeException('A backup with the generated filename already exists.');
        }
        $command = [
            $binary,
            '--single-transaction',
            '--routines',
            '--triggers',
            '--events',
            '--hex-blob',
            '--user=' . $connection['username'],
            '--host=' . $connection['host'],
            '--port=' . $connection['port'],
            '--result-file=' . $path,
            $connection['database'],
        ];
        try {
            self::run($command, $connection['password']);
        } catch (\Throwable $exception) {
            @unlink($path);
            throw $exception;
        }
        if (!is_file($path) || filesize($path) === 0) {
            @unlink($path);
            throw new RuntimeException('Database backup did not produce a non-empty dump.');
        }
        $hash = hash_file('sha256', $path);
        if (!is_string($hash)) {
            @unlink($path);
            throw new RuntimeException('Could not calculate the database backup checksum.');
        }
        if (file_put_contents($path . '.sha256', $hash . '  ' . $filename . PHP_EOL, LOCK_EX) === false) {
            @unlink($path);
            throw new RuntimeException('Could not write the database backup checksum.');
        }
        if (!chmod($path, 0600) || !chmod($path . '.sha256', 0600)) {
            @unlink($path);
            @unlink($path . '.sha256');
            throw new RuntimeException('Could not restrict permissions on the database backup files.');
        }
        return ['filename' => $filename, 'sha256' => $hash, 'bytes' => filesize($path)];
    }

    public static function restore(string $filename, PDO $pdo, string $confirmation): void
    {
        if (!preg_match('/^haroni-dcms-\d{8}-\d{6}-[a-f0-9]{8}\.sql$/D', $filename)) {
            throw new RuntimeException('Restore accepts only a named Haroni DCMS SQL backup file.');
        }
        $connection = self::connectionDetails();
        if (!hash_equals($connection['database'], $confirmation)) {
            throw new RuntimeException('Database name confirmation did not match; restore cancelled.');
        }
        $directory = self::backupDirectory();
        $path = realpath($directory . DIRECTORY_SEPARATOR . $filename);
        if ($path === false || !is_file($path) || !self::isWithin($path, $directory)) {
            throw new RuntimeException('Backup file was not found inside the configured backup directory.');
        }
        $checksumPath = $path . '.sha256';
        $checksumText = is_file($checksumPath) ? file_get_contents($checksumPath) : false;
        $expectedHash = hash_file('sha256', $path);
        if (!is_string($checksumText) || !is_string($expectedHash)
            || !preg_match('/^([a-f0-9]{64})\s+(\S+)$/D', trim($checksumText), $match)
            || !hash_equals($match[1], $expectedHash)
            || !hash_equals($filename, $match[2])) {
            throw new RuntimeException('Backup checksum is missing or does not match; restore cancelled.');
        }

        $tableCount = (int) $pdo->query(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()'
        )->fetchColumn();
        if ($tableCount !== 0) {
            throw new RuntimeException(
                'Restore requires an empty database. It will not overwrite existing tables or records.'
            );
        }
        $binary = dcms_env('MYSQL_BIN', 'mysql');
        self::run([
            $binary,
            '--user=' . $connection['username'],
            '--host=' . $connection['host'],
            '--port=' . $connection['port'],
            '--database=' . $connection['database'],
        ], $connection['password'], $path);
    }

    public static function databaseName(): string
    {
        return self::connectionDetails()['database'];
    }

    private static function connectionDetails(): array
    {
        $dsn = dcms_env('DB_DSN');
        $username = dcms_env('DCMS_BACKUP_DB_USERNAME', dcms_env('DB_USERNAME'));
        $password = dcms_env('DCMS_BACKUP_DB_PASSWORD', dcms_env('DB_PASSWORD'));
        if ($dsn === null || $username === null || $password === null || !str_starts_with($dsn, 'mysql:')) {
            throw new RuntimeException('Backup tools require a configured MySQL DB_DSN, DB_USERNAME, and DB_PASSWORD.');
        }
        $parts = [];
        foreach (explode(';', substr($dsn, 6)) as $part) {
            if (str_contains($part, '=')) {
                [$key, $value] = explode('=', $part, 2);
                $parts[strtolower(trim($key))] = trim($value);
            }
        }
        $host = $parts['host'] ?? '127.0.0.1';
        $port = $parts['port'] ?? '3306';
        $database = $parts['dbname'] ?? '';
        if ($database === '' || $host === '' || $username === '' || $password === ''
            || !preg_match('/^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/D', $database)
            || !preg_match('/^\d{1,5}$/D', $port) || (int) $port < 1 || (int) $port > 65535
            || str_contains($host, "\0") || str_contains($host, "\r") || str_contains($host, "\n")
            || str_contains($username, "\0") || str_contains($username, "\r") || str_contains($username, "\n")) {
            throw new RuntimeException('MySQL DB_DSN must include a valid dbname and TCP host/port.');
        }
        return [
            'host' => $host,
            'port' => $port,
            'database' => $database,
            'username' => $username,
            'password' => $password,
        ];
    }

    private static function backupDirectory(): string
    {
        $configured = dcms_env('DCMS_BACKUP_DIR');
        if ($configured === null || trim($configured) === '') {
            throw new RuntimeException('Set DCMS_BACKUP_DIR to a protected directory outside the project directory.');
        }
        $isAbsolute = DIRECTORY_SEPARATOR === '\\'
            ? preg_match('/^(?:[A-Za-z]:\\\\|\\\\\\\\)/', $configured) === 1
            : str_starts_with($configured, '/');
        if (!$isAbsolute) {
            throw new RuntimeException('DCMS_BACKUP_DIR must be an absolute path.');
        }
        if (!is_dir($configured) && !mkdir($configured, 0700, true) && !is_dir($configured)) {
            throw new RuntimeException('Could not create the configured database backup directory.');
        }
        $directory = realpath($configured);
        if ($directory === false || self::isWithin($directory, dirname(DCMS_ROOT))) {
            throw new RuntimeException('Database backups must be stored outside the project directory.');
        }
        return $directory;
    }

    private static function isWithin(string $path, string $directory): bool
    {
        $path = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path), DIRECTORY_SEPARATOR);
        $directory = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $directory), DIRECTORY_SEPARATOR);
        $root = realpath($directory);
        if ($root === false) {
            return false;
        }
        $path = DIRECTORY_SEPARATOR === '\\' ? strtolower($path) : $path;
        $root = DIRECTORY_SEPARATOR === '\\' ? strtolower(rtrim($root, DIRECTORY_SEPARATOR)) : rtrim($root, DIRECTORY_SEPARATOR);
        return $path === $root || str_starts_with($path, $root . DIRECTORY_SEPARATOR);
    }

    private static function run(array $command, string $password, ?string $inputFile = null): void
    {
        if ($command === [] || !is_string($command[0]) || $command[0] === ''
            || str_contains($password, "\0") || str_contains($password, "\r") || str_contains($password, "\n")) {
            throw new RuntimeException('MySQL command configuration is invalid.');
        }
        $optionFile = tempnam(sys_get_temp_dir(), 'dcms-mysql-');
        if ($optionFile === false) {
            throw new RuntimeException('Could not create a temporary MySQL credential file.');
        }
        $escapedPassword = str_replace(['\\', '"'], ['\\\\', '\\"'], $password);
        if (file_put_contents($optionFile, "[client]\npassword=\"" . $escapedPassword . "\"\n", LOCK_EX) === false) {
            @unlink($optionFile);
            throw new RuntimeException('Could not write temporary MySQL credentials.');
        }
        if (!chmod($optionFile, 0600)) {
            @unlink($optionFile);
            throw new RuntimeException('Could not restrict permissions on temporary MySQL credentials.');
        }
        $command = array_merge(
            [$command[0], '--defaults-extra-file=' . $optionFile],
            array_slice($command, 1)
        );
        $descriptors = [
            0 => $inputFile === null ? ['pipe', 'r'] : ['file', $inputFile, 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        try {
            $process = proc_open($command, $descriptors, $pipes);
            if (!is_resource($process)) {
                throw new RuntimeException('Could not start the configured MySQL command-line client.');
            }
            if ($inputFile === null) {
                fclose($pipes[0]);
            }
            $stdout = stream_get_contents($pipes[1]);
            fclose($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[2]);
            $exitCode = proc_close($process);
            if ($exitCode !== 0) {
                $details = trim((string) $stderr . "\n" . (string) $stdout);
                throw new RuntimeException(
                    'MySQL command failed: ' . ($details !== '' ? $details : 'exit code ' . $exitCode)
                );
            }
        } finally {
            @unlink($optionFile);
        }
    }
}
