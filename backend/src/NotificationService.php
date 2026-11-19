<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class NotificationService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function reminders(): int
    {
        $setting = $this->pdo->query(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'reminder_before_hours'"
        )->fetchColumn();
        $hours = filter_var($setting, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 167]]);
        if ($hours === false) {
            throw new \RuntimeException('Reminder-before-deadline setting is invalid.');
        }
        if ($hours === 0) {
            return 0;
        }
        $query = $this->pdo->prepare(
            "SELECT id, guest_id, DATE_FORMAT(confirmation_deadline, '%Y%m%d%H%i') AS deadline_key
             FROM credit_transactions
             WHERE status = 'pending_guest_confirmation'
               AND confirmation_deadline > UTC_TIMESTAMP(6)
               AND confirmation_deadline <= TIMESTAMPADD(HOUR, ?, UTC_TIMESTAMP(6))
             ORDER BY confirmation_deadline LIMIT 500"
        );
        $query->execute([$hours]);
        $insert = $this->pdo->prepare(
            "INSERT IGNORE INTO notifications
                (user_id, related_transaction_id, notification_type, event_key, message)
             VALUES (?, ?, 'confirmation_reminder', ?, ?)"
        );
        $created = 0;
        foreach ($query->fetchAll() as $row) {
            $insert->execute([
                (int) $row['guest_id'],
                (int) $row['id'],
                'deadline_' . $row['deadline_key'],
                'Reminder: please review and confirm credit transaction #' . $row['id'] . ' before it expires.',
            ]);
            $created += $insert->rowCount();
        }
        return $created;
    }

    public function listFor(int $userId): array
    {
        $query = $this->pdo->prepare(
            'SELECT id, related_transaction_id, notification_type, message, created_at, read_at
             FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
        );
        $query->execute([$userId]);
        return $query->fetchAll();
    }

    public function markRead(int $notificationId, int $userId): void
    {
        $query = $this->pdo->prepare(
            'UPDATE notifications SET read_at = UTC_TIMESTAMP(6)
             WHERE id = ? AND user_id = ? AND read_at IS NULL'
        );
        $query->execute([$notificationId, $userId]);
        if ($query->rowCount() === 0) {
            $exists = $this->pdo->prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?');
            $exists->execute([$notificationId, $userId]);
            if ($exists->fetchColumn() === false) {
                throw new ApiException(404, 'Notification not found.');
            }
        }
    }

    public function deleteFor(int $notificationId, int $userId): void
    {
        $query = $this->pdo->prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?');
        $query->execute([$notificationId, $userId]);
        if ($query->rowCount() === 0) {
            throw new ApiException(404, 'Notification not found.');
        }
    }

    public function deleteAllFor(int $userId): void
    {
        $query = $this->pdo->prepare('DELETE FROM notifications WHERE user_id = ?');
        $query->execute([$userId]);
    }

    public static function transaction(PDO $pdo, int $guestId, int $transactionId, string $type, string $eventKey, string $message): void
    {
        $query = $pdo->prepare(
            'INSERT INTO notifications
                (user_id, related_transaction_id, notification_type, event_key, message)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE message = VALUES(message)'
        );
        $query->execute([$guestId, $transactionId, $type, $eventKey, $message]);
    }

    public static function financeManagers(PDO $pdo, int $transactionId, string $status): void
    {
        $query = $pdo->prepare(
            "INSERT INTO notifications (user_id, related_transaction_id, notification_type, event_key, message)
             SELECT id, ?, ?, ?, ?
             FROM users WHERE role IN ('finance_manager', 'owner') AND is_active = TRUE
             ON DUPLICATE KEY UPDATE message = VALUES(message)"
        );
        $query->execute([
            $transactionId,
            $status,
            'transaction_' . $transactionId . '_' . $status,
            'Credit transaction #' . $transactionId . ' is awaiting ' . str_replace('_', ' ', $status) . '.',
        ]);
    }
}
