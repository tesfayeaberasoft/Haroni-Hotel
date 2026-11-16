<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class SystemSettingsService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function confirmationDeadline(int $hours, int $administratorId): void
    {
        if ($hours < 1 || $hours > 168) {
            throw new ApiException(422, 'Confirmation deadline must be between 1 and 168 hours.');
        }
        $reminderHours = $this->pdo->query(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'reminder_before_hours'"
        )->fetchColumn();
        $reminderHours = filter_var($reminderHours, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 167]]);
        if ($reminderHours === false || $reminderHours >= $hours) {
            throw new ApiException(422, 'Reminder must be fewer hours than the confirmation deadline.');
        }
        $this->save('confirmation_deadline_hours', (string) $hours, $administratorId, 'confirmation_deadline_updated');
    }

    public function historicalDebtTarget(string $amount, int $financeManagerId): void
    {
        if (Money::minorUnits($amount) <= 0) {
            throw new ApiException(422, 'Historical debt reconciliation target must be greater than zero.');
        }
        $this->save('historical_debt_expected_total', $amount, $financeManagerId, 'historical_debt_target_updated');
    }

    public function list(): array
    {
        $settings = $this->pdo->query(
            "SELECT setting_key, setting_value, updated_at
             FROM system_settings ORDER BY setting_key"
        )->fetchAll();
        $result = [];
        foreach ($settings as $setting) {
            $result[$setting['setting_key']] = $setting['setting_value'];
        }
        foreach ([
            'hotel_name',
            'hotel_address',
            'hotel_phone',
            'hotel_email',
            'hotel_tin',
            'currency',
            'confirmation_deadline_hours',
            'reminder_before_hours',
            'historical_debt_expected_total',
            'receipt_footer',
            'sms_reminders_enabled',
        ] as $required) {
            if (!array_key_exists($required, $result)) {
                throw new \RuntimeException('Required system setting is missing: ' . $required);
            }
        }
        return $result;
    }

    public function update(array $settings, int $administratorId): void
    {
        $required = [
            'hotel_name',
            'hotel_address',
            'hotel_phone',
            'hotel_email',
            'hotel_tin',
            'currency',
            'confirmation_deadline_hours',
            'reminder_before_hours',
            'historical_debt_expected_total',
            'receipt_footer',
            'sms_reminders_enabled',
        ];
        if (array_diff($required, array_keys($settings)) !== []) {
            throw new \InvalidArgumentException('All system settings must be provided.');
        }
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !is_string($value)) {
                throw new \InvalidArgumentException('System setting values must be strings.');
            }
        }

        $this->pdo->beginTransaction();
        try {
            $update = $this->pdo->prepare(
                'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?'
            );
            $exists = $this->pdo->prepare('SELECT setting_key FROM system_settings WHERE setting_key = ?');
            foreach ($settings as $key => $value) {
                $update->execute([$value, $administratorId, $key]);
                if ($update->rowCount() === 0) {
                    $exists->execute([$key]);
                    if ($exists->fetchColumn() === false) {
                        throw new \RuntimeException('Required system setting is missing: ' . $key);
                    }
                }
            }
            AuditLogger::record($this->pdo, $administratorId, 'system_settings_updated', 'system_setting', null, [
                'setting_keys' => array_keys($settings),
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function hotelName(string $name, int $administratorId): void
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name, 'UTF-8') > 160) {
            throw new ApiException(422, 'Hotel name must contain 1 to 160 characters.');
        }
        $this->save('hotel_name', $name, $administratorId, 'hotel_name_updated');
    }

    private function save(string $key, string $value, int $actorId, string $action): void
    {
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?'
            );
            $query->execute([$value, $actorId, $key]);
            if ($query->rowCount() !== 1) {
                $exists = $this->pdo->prepare('SELECT setting_key FROM system_settings WHERE setting_key = ?');
                $exists->execute([$key]);
                if ($exists->fetchColumn() === false) {
                    throw new \RuntimeException('Required system setting is missing: ' . $key);
                }
            }
            AuditLogger::record($this->pdo, $actorId, $action, 'system_setting', null, [
                'setting_key' => $key,
                'setting_value' => $value,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }
}
