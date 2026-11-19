<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;

final class AuthService
{
    private const MAX_ATTEMPTS = 5;
    private const ATTEMPT_WINDOW_MINUTES = 15;
    private const DUMMY_HASH = '$2y$10$92IXUNpkjO0rOQO5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function login(string $username, string $password): array
    {
        if (PHP_SAPI === 'cli' || session_status() !== PHP_SESSION_ACTIVE) {
            throw new ApiException(500, 'Web session support is not available.');
        }
        if ($username === '' || strlen($username) > 80 || $password === '' || strlen($password) > 72) {
            throw new ApiException(401, 'Invalid username or password.');
        }
        $usernameKey = hash('sha256', mb_strtolower($username, 'UTF-8'));
        $ipKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                'SELECT id, username, full_name, password_hash, role, must_change_password, is_active, auth_version
                 FROM users WHERE username = ? LIMIT 1 FOR UPDATE'
            );
            $query->execute([$username]);
            $user = $query->fetch();

            if ($user !== false && !(bool) $user['is_active']) {
                throw new ApiException(403, 'This account is deactivated. Contact the System Administrator.');
            }

            $valid = password_verify($password, $user['password_hash'] ?? self::DUMMY_HASH);
            if (!$valid || $user === false) {
                $attempts = $this->recordFailure($usernameKey, $ipKey);
                $remaining = max(0, self::MAX_ATTEMPTS - $attempts);
                if ($user !== false && $attempts >= self::MAX_ATTEMPTS) {
                    $deactivate = $this->pdo->prepare(
                        'UPDATE users SET is_active = FALSE, auth_version = auth_version + 1 WHERE id = ?'
                    );
                    $deactivate->execute([(int) $user['id']]);
                    AuditLogger::record(
                        $this->pdo,
                        null,
                        'login_account_deactivated',
                        'user',
                        (int) $user['id'],
                        ['reason' => 'five_failed_login_attempts']
                    );
                }
                AuditLogger::record($this->pdo, null, 'login_failed', 'authentication', null, [
                    'username_key' => $usernameKey,
                ]);
                $this->pdo->commit();

                if ($user !== false && $attempts >= self::MAX_ATTEMPTS) {
                    throw new ApiException(
                        403,
                        'Invalid credentials. You have 0 attempts remaining; your account has been deactivated.'
                    );
                }
                throw new ApiException(
                    401,
                    sprintf(
                        'Invalid credentials. You have %d attempt%s remaining before your account is deactivated.',
                        $remaining,
                        $remaining === 1 ? '' : 's'
                    )
                );
            }

            $this->pdo->prepare('DELETE FROM login_attempts WHERE username_key = ?')
                ->execute([$usernameKey]);
            AuditLogger::record($this->pdo, (int) $user['id'], 'login', 'user', (int) $user['id']);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['auth_version'] = (int) $user['auth_version'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        return [
            'id' => (int) $user['id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'role' => $user['role'],
            'must_change_password' => (bool) $user['must_change_password'],
            'csrf_token' => $_SESSION['csrf_token'],
        ];
    }

    public function logout(?int $userId): void
    {
        if ($userId !== null) {
            AuditLogger::record($this->pdo, $userId, 'logout', 'user', $userId);
        }
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Strict',
            ]);
        }
        session_destroy();
    }

    public function currentUser(): ?array
    {
        $id = filter_var($_SESSION['user_id'] ?? null, FILTER_VALIDATE_INT);
        if ($id === false || $id === null || $id < 1) {
            return null;
        }
        $query = $this->pdo->prepare(
            'SELECT id, username, full_name, role, phone, must_change_password, auth_version, is_active
             FROM users WHERE id = ? LIMIT 1'
        );
        $query->execute([$id]);
        $user = $query->fetch();
        if ($user === false || !(bool) $user['is_active']
            || (int) ($user['auth_version'] ?? -1) !== (int) ($_SESSION['auth_version'] ?? -2)) {
            $this->logout((int) $id);
            return null;
        }
        $user['id'] = (int) $user['id'];
        $user['must_change_password'] = (bool) $user['must_change_password'];
        return $user;
    }

    public function changePassword(int $userId, string $currentPassword, string $newPassword): void
    {
        if (strlen($newPassword) < 12 || strlen($newPassword) > 72) {
            throw new ApiException(422, 'New password must be 12 to 72 bytes long.');
        }
        $query = $this->pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $query->execute([$userId]);
        $hash = $query->fetchColumn();
        if (!is_string($hash) || !password_verify($currentPassword, $hash)) {
            throw new ApiException(403, 'Current password is incorrect.');
        }
        $this->pdo->beginTransaction();
        try {
            $update = $this->pdo->prepare(
                'UPDATE users SET password_hash = ?, must_change_password = FALSE,
                    auth_version = auth_version + 1 WHERE id = ?'
            );
            $update->execute([password_hash($newPassword, PASSWORD_DEFAULT), $userId]);
            $version = $this->pdo->prepare('SELECT auth_version FROM users WHERE id = ?');
            $version->execute([$userId]);
            $authVersion = (int) $version->fetchColumn();
            AuditLogger::record($this->pdo, $userId, 'password_changed', 'user', $userId);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
        session_regenerate_id(true);
        $_SESSION['auth_version'] = $authVersion;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    private function recordFailure(string $usernameKey, string $ipKey): int
    {
        $query = $this->pdo->prepare(
            'INSERT INTO login_attempts (username_key, ip_key, attempts, first_failed_at, locked_until)
             VALUES (?, ?, 1, UTC_TIMESTAMP(6), NULL)
             ON DUPLICATE KEY UPDATE
                attempts = IF(first_failed_at < UTC_TIMESTAMP(6) - INTERVAL '
                . self::ATTEMPT_WINDOW_MINUTES . ' MINUTE, 1, attempts + 1),
                locked_until = NULL,
                first_failed_at = IF(first_failed_at < UTC_TIMESTAMP(6) - INTERVAL '
                . self::ATTEMPT_WINDOW_MINUTES . ' MINUTE, UTC_TIMESTAMP(6), first_failed_at)'
        );
        $query->execute([$usernameKey, $ipKey]);

        $total = $this->pdo->prepare(
            'SELECT COALESCE(SUM(attempts), 0)
             FROM login_attempts
             WHERE username_key = ? AND first_failed_at >= UTC_TIMESTAMP(6) - INTERVAL '
             . self::ATTEMPT_WINDOW_MINUTES . ' MINUTE'
        );
        $total->execute([$usernameKey]);
        return (int) $total->fetchColumn();
    }

    public static function requireRole(array $user, string ...$roles): void
    {
        $role = $user['role'] ?? null;
        $ownerAccessRoles = ['system_administrator', 'cashier', 'finance_manager'];
        if (!in_array($role, $roles, true)
            && !($role === 'owner' && array_intersect($roles, $ownerAccessRoles) !== [])) {
            throw new ApiException(403, 'Your role is not permitted to perform this action.');
        }
    }
}
