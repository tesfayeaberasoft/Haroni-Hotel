<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class UserManagementService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(int $administratorId, array $data): int
    {
        Http::requireFields($data, ['username', 'password', 'role', 'full_name']);
        if (array_diff(array_keys($data), ['username', 'password', 'role', 'full_name', 'phone']) !== []) {
            throw new ApiException(422, 'User creation contains unsupported fields.');
        }
        $username = Http::text($data['username'], 'username', 80);
        $fullName = Http::text($data['full_name'], 'full_name', 180);
        $role = Http::text($data['role'], 'role', 32);
        $phone = isset($data['phone']) ? Http::text($data['phone'], 'phone', 32, true) : null;
        if (!preg_match('/^[A-Za-z0-9._-]{3,80}$/D', $username)) {
            throw new ApiException(422, 'Username must be 3 to 80 letters, numbers, dots, underscores or hyphens.');
        }
        if ($fullName === '' || mb_strlen($fullName, 'UTF-8') > 180) {
            throw new ApiException(422, 'Full name must contain 1 to 180 characters.');
        }
        if (!in_array($role, ['cashier', 'finance_manager', 'guest'], true)) {
            throw new ApiException(422, 'Only Cashier, Finance Manager, and Guest accounts can be created here.');
        }
        if (!is_string($data['password']) || strlen($data['password']) < 12 || strlen($data['password']) > 72) {
            throw new ApiException(422, 'Password must be 12 to 72 bytes long.');
        }
        if ($phone !== null && mb_strlen($phone, 'UTF-8') > 32) {
            throw new ApiException(422, 'Phone number cannot exceed 32 characters.');
        }
        if (array_key_exists('credit_limit', $data)) {
            throw new ApiException(422, 'Credit limits can only be assigned or changed by a Finance Manager.');
        }

        $this->pdo->beginTransaction();
        try {
            $insert = $this->pdo->prepare(
                'INSERT INTO users (username, full_name, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)'
            );
            $insert->execute([
                $username,
                $fullName,
                password_hash($data['password'], PASSWORD_DEFAULT),
                $role,
                $phone,
            ]);
            $userId = (int) $this->pdo->lastInsertId();
            if ($role === 'guest') {
                $guest = $this->pdo->prepare(
                    'INSERT INTO guest_accounts (user_id, full_name, credit_limit, created_by)
                     VALUES (?, ?, 0.00, ?)'
                );
                $guest->execute([$userId, $fullName, $administratorId]);
            }
            AuditLogger::record($this->pdo, $administratorId, 'user_created', 'user', $userId, [
                'username' => $username,
                'role' => $role,
            ]);
            $this->pdo->commit();
            return $userId;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception instanceof \PDOException && $exception->getCode() === '23000') {
                throw new ApiException(409, 'Username is already in use.');
            }
            throw $exception;
        }
    }

    public function list(): array
    {
        return $this->pdo->query(
            'SELECT u.id, u.username, u.full_name, u.role, u.phone, u.is_active, u.must_change_password,
                    u.created_at
             FROM users u ORDER BY u.created_at DESC LIMIT 1000'
        )->fetchAll();
    }

    public function updateProfile(int $targetUserId, int $administratorId, array $data): void
    {
        if ($data === [] || array_diff(array_keys($data), ['username', 'full_name', 'phone', 'role']) !== []) {
            throw new ApiException(422, 'Provide one or more of username, full_name, phone, and role only.');
        }
        $fields = [];
        $values = [];
        $newRole = null;
        if (array_key_exists('username', $data)) {
            $username = Http::text($data['username'], 'username', 80);
            if (!preg_match('/^[A-Za-z0-9._-]{3,80}$/D', $username)) {
                throw new ApiException(422, 'Username must be 3 to 80 letters, numbers, dots, underscores or hyphens.');
            }
            $fields[] = 'username = ?';
            $values[] = $username;
        }
        if (array_key_exists('full_name', $data)) {
            $fields[] = 'full_name = ?';
            $values[] = Http::text($data['full_name'], 'full_name', 180);
        }
        if (array_key_exists('phone', $data)) {
            $fields[] = 'phone = ?';
            $values[] = Http::text($data['phone'], 'phone', 32, true);
        }
        if (array_key_exists('role', $data)) {
            $newRole = Http::text($data['role'], 'role', 32);
            if (!in_array($newRole, ['system_administrator', 'cashier', 'finance_manager'], true)) {
                throw new ApiException(422, 'Role must be System Administrator, Cashier, or Finance Manager.');
            }
        }

        $this->pdo->beginTransaction();
        try {
            $activeAdministrators = [];
            if ($newRole !== null) {
                $activeAdministrators = array_map(
                    static fn(array $row): int => (int) $row['id'],
                    $this->pdo->query(
                        "SELECT id FROM users
                         WHERE role = 'system_administrator' AND is_active = TRUE
                         ORDER BY id FOR UPDATE"
                    )->fetchAll()
                );
            }
            $lookup = $this->pdo->prepare('SELECT role, is_active FROM users WHERE id = ? FOR UPDATE');
            $lookup->execute([$targetUserId]);
            $target = $lookup->fetch();
            if ($target === false) {
                throw new ApiException(404, 'User not found.');
            }
            $currentRole = $target['role'];
            $roleChanged = $newRole !== null && $newRole !== $currentRole;
            if ($roleChanged && $targetUserId === $administratorId) {
                throw new ApiException(422, 'You cannot change your own account role.');
            }
            if ($roleChanged && $currentRole === 'guest') {
                throw new ApiException(422, 'Guest accounts cannot be changed to staff roles here.');
            }
            if ($roleChanged && (bool) $target['is_active']
                && $currentRole === 'system_administrator'
                && count($activeAdministrators) <= 1) {
                throw new ApiException(409, 'At least one active System Administrator must remain.');
            }
            if ($roleChanged) {
                $fields[] = 'role = ?';
                $values[] = $newRole;
                $fields[] = 'auth_version = auth_version + 1';
            }
            if ($fields === []) {
                $this->pdo->commit();
                return;
            }
            $values[] = $targetUserId;
            $this->pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);
            if ($currentRole === 'guest' && array_key_exists('full_name', $data)) {
                $this->pdo->prepare('UPDATE guest_accounts SET full_name = ? WHERE user_id = ?')
                    ->execute([Http::text($data['full_name'], 'full_name', 180), $targetUserId]);
            }
            $details = [
                'changed_fields' => array_keys($data),
            ];
            if ($roleChanged) {
                $details['role_change'] = ['from' => $currentRole, 'to' => $newRole];
            }
            AuditLogger::record($this->pdo, $administratorId, 'user_profile_updated', 'user', $targetUserId, $details);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception instanceof \PDOException && $exception->getCode() === '23000') {
                throw new ApiException(409, 'Username is already in use.');
            }
            throw $exception;
        }
    }

    public function setActive(int $targetUserId, int $administratorId, bool $active): void
    {
        if ($targetUserId === $administratorId && !$active) {
            throw new ApiException(422, 'You cannot deactivate your own account.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                'UPDATE users
                 SET is_active = ?, auth_version = auth_version + IF(is_active <> ?, 1, 0)
                 WHERE id = ?'
            );
            $query->bindValue(1, $active, PDO::PARAM_BOOL);
            $query->bindValue(2, $active, PDO::PARAM_BOOL);
            $query->bindValue(3, $targetUserId, PDO::PARAM_INT);
            $query->execute();
            if ($query->rowCount() !== 1) {
                $check = $this->pdo->prepare('SELECT id, is_active FROM users WHERE id = ?');
                $check->execute([$targetUserId]);
                $existing = $check->fetch();
                if ($existing === false) {
                    throw new ApiException(404, 'User not found.');
                }
                if ((bool) $existing['is_active'] === $active) {
                    $this->pdo->commit();
                    return;
                }
            }
            AuditLogger::record($this->pdo, $administratorId, $active ? 'user_activated' : 'user_deactivated', 'user', $targetUserId);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function resetPassword(int $targetUserId, int $administratorId): string
    {
        $temporaryPassword = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                'UPDATE users SET password_hash = ?, must_change_password = TRUE,
                    auth_version = auth_version + 1 WHERE id = ?'
            );
            $query->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $targetUserId]);
            if ($query->rowCount() !== 1) {
                $exists = $this->pdo->prepare('SELECT id FROM users WHERE id = ?');
                $exists->execute([$targetUserId]);
                if ($exists->fetchColumn() === false) {
                    throw new ApiException(404, 'User not found.');
                }
            }
            AuditLogger::record($this->pdo, $administratorId, 'user_password_reset', 'user', $targetUserId);
            $this->pdo->commit();
            return $temporaryPassword;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function setOwnGuestPin(int $guestId, string $pin, string $currentPassword): void
    {
        if (!preg_match('/^\d{6,12}$/D', $pin)) {
            throw new ApiException(422, 'Guest PIN must contain 6 to 12 digits.');
        }
        $this->pdo->beginTransaction();
        try {
        $query = $this->pdo->prepare(
            "SELECT u.password_hash FROM users u JOIN guest_accounts g ON g.user_id = u.id WHERE u.id = ?"
        );
        $query->execute([$guestId]);
        $passwordHash = $query->fetchColumn();
        if (!is_string($passwordHash)) {
            throw new ApiException(403, 'Only guest accounts can set an in-person confirmation PIN.');
        }
        if (!password_verify($currentPassword, $passwordHash)) {
            throw new ApiException(403, 'Current password is incorrect.');
        }
        $upsert = $this->pdo->prepare(
            'INSERT INTO guest_confirmation_pins (guest_id, pin_hash) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE pin_hash = VALUES(pin_hash)'
        );
        $upsert->execute([$guestId, password_hash($pin, PASSWORD_DEFAULT)]);
        AuditLogger::record($this->pdo, $guestId, 'guest_confirmation_pin_set', 'guest_account', $guestId);
        $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }
}
