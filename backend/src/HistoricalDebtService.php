<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class HistoricalDebtService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function enter(
        int $guestId,
        string $amount,
        string $applicableFrom,
        ?string $applicableTo,
        string $reference,
        int $financeManagerId
    ): int {
        $reference = trim($reference);
        if ($reference === '' || mb_strlen($reference, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A supporting paper-record reference is required.');
        }
        $this->validateDate($applicableFrom, 'applicable_from');
        if ($applicableTo !== null) {
            $this->validateDate($applicableTo, 'applicable_to');
            if ($applicableTo < $applicableFrom) {
                throw new ApiException(422, 'applicable_to cannot be earlier than applicable_from.');
            }
        }
        if (Money::minorUnits($amount) <= 0) {
            throw new ApiException(422, 'Historical debt amount must be greater than zero.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                "INSERT INTO opening_balances
                    (guest_id, amount, applicable_from, applicable_to, supporting_reference, entered_by)
                 VALUES (?, ?, ?, ?, ?, ?)"
            );
            $query->execute([$guestId, $amount, $applicableFrom, $applicableTo, $reference, $financeManagerId]);
            $id = (int) $this->pdo->lastInsertId();
            AuditLogger::record($this->pdo, $financeManagerId, 'historical_debt_entered', 'opening_balance', $id, [
                'guest_id' => $guestId,
                'amount' => $amount,
                'supporting_reference' => $reference,
            ]);
            $this->pdo->commit();
            return $id;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function enterBatch(array $records, int $financeManagerId): array
    {
        if ($records === [] || count($records) > 500 || !array_is_list($records)) {
            throw new ApiException(422, 'Historical debt import must contain between 1 and 500 records.');
        }
        $validated = [];
        foreach ($records as $record) {
            if (!is_array($record)
                || array_diff(array_keys($record), ['guest_id', 'guest_username', 'amount', 'applicable_from', 'applicable_to', 'supporting_reference']) !== []) {
                throw new ApiException(422, 'Each imported record must contain a guest_id or guest_username, amount, dates, and supporting_reference.');
            }
            Http::requireFields($record, ['amount', 'applicable_from', 'supporting_reference']);
            if (array_key_exists('guest_id', $record) === array_key_exists('guest_username', $record)) {
                throw new ApiException(422, 'Each imported record must contain exactly one of guest_id or guest_username.');
            }
            $guestId = array_key_exists('guest_id', $record)
                ? Http::idValue($record['guest_id'], 'guest_id')
                : 0;
            $guestUsername = array_key_exists('guest_username', $record)
                ? Http::text($record['guest_username'], 'guest_username', 80)
                : null;
            $amount = Http::money($record['amount'], 'amount');
            $applicableFrom = Http::text($record['applicable_from'], 'applicable_from', 10);
            $applicableTo = isset($record['applicable_to'])
                ? Http::text($record['applicable_to'], 'applicable_to', 10)
                : null;
            $reference = Http::text($record['supporting_reference'], 'supporting_reference', 1000);
            $this->validateDate($applicableFrom, 'applicable_from');
            if ($applicableTo !== null) {
                $this->validateDate($applicableTo, 'applicable_to');
                if ($applicableTo < $applicableFrom) {
                    throw new ApiException(422, 'applicable_to cannot be earlier than applicable_from.');
                }
            }
            if (Money::minorUnits($amount) <= 0) {
                throw new ApiException(422, 'Historical debt amounts must be greater than zero.');
            }
            $validated[] = [$guestId, $guestUsername, $amount, $applicableFrom, $applicableTo, $reference];
        }

        $this->pdo->beginTransaction();
        try {
            $insert = $this->pdo->prepare(
                'INSERT INTO opening_balances
                    (guest_id, amount, applicable_from, applicable_to, supporting_reference, entered_by)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $guestQuery = $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ?');
            $usernameQuery = $this->pdo->prepare(
                'SELECT g.user_id FROM guest_accounts g JOIN users u ON u.id = g.user_id WHERE u.username = ?'
            );
            $ids = [];
            foreach ($validated as [$guestId, $guestUsername, $amount, $from, $to, $reference]) {
                if ($guestUsername !== null) {
                    $usernameQuery->execute([$guestUsername]);
                    $resolvedId = $usernameQuery->fetchColumn();
                    if ($resolvedId === false) {
                        throw new ApiException(404, 'Guest account not found for username: ' . $guestUsername);
                    }
                    $guestId = (int) $resolvedId;
                }
                $guestQuery->execute([$guestId]);
                if ($guestQuery->fetchColumn() === false) {
                    throw new ApiException(404, 'Guest account not found: ' . $guestId);
                }
                $insert->execute([$guestId, $amount, $from, $to, $reference, $financeManagerId]);
                $id = (int) $this->pdo->lastInsertId();
                $ids[] = $id;
                AuditLogger::record($this->pdo, $financeManagerId, 'historical_debt_imported_pending_verification', 'opening_balance', $id, [
                    'guest_id' => $guestId,
                    'amount' => $amount,
                    'supporting_reference' => $reference,
                ]);
            }
            $this->pdo->commit();
            return $ids;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function verify(int $balanceId, int $financeManagerId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A historical debt verification note is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare('SELECT * FROM opening_balances WHERE id = ? FOR UPDATE');
            $query->execute([$balanceId]);
            $balance = $query->fetch();
            if ($balance === false) {
                throw new ApiException(404, 'Opening balance not found.');
            }
            if ($balance['status'] !== 'pending_verification') {
                throw new ApiException(409, 'Opening balance is not awaiting verification.');
            }
            $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ? FOR UPDATE')
                ->execute([(int) $balance['guest_id']]);
            $this->pdo->prepare(
                "UPDATE opening_balances SET status = 'verified', verified_by = ?,
                    verified_at = UTC_TIMESTAMP(6), verification_reason = ? WHERE id = ?"
            )->execute([$financeManagerId, $reason, $balanceId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'historical_debt_verified', 'opening_balance', $balanceId, [
                'guest_id' => (int) $balance['guest_id'],
                'amount' => $balance['amount'],
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function reject(int $balanceId, int $financeManagerId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A rejection reason is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                "UPDATE opening_balances SET status = 'rejected', verified_by = ?,
                    verified_at = UTC_TIMESTAMP(6), verification_reason = ?
                 WHERE id = ? AND status = 'pending_verification'"
            );
            $query->execute([$financeManagerId, $reason, $balanceId]);
            if ($query->rowCount() !== 1) {
                throw new ApiException(409, 'Opening balance is not awaiting verification.');
            }
            AuditLogger::record($this->pdo, $financeManagerId, 'historical_debt_rejected', 'opening_balance', $balanceId, [
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function reconciliation(): array
    {
        $query = $this->pdo->query(
            "SELECT COALESCE(SUM(amount), 0) FROM opening_balances WHERE status = 'verified'"
        );
        $actual = (string) $query->fetchColumn();
        $expectedQuery = $this->pdo->query(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'historical_debt_expected_total'"
        );
        $expected = $expectedQuery->fetchColumn();
        if (!is_string($expected)) {
            throw new \RuntimeException('Expected historical debt total is not configured.');
        }
        return [
            'expected_total' => Money::formatMinor(Money::minorUnits($expected)),
            'verified_opening_balances_total' => Money::formatMinor(Money::minorUnits($actual)),
            'difference' => Money::formatMinor(Money::minorUnits($expected) - Money::minorUnits($actual)),
            'reconciled' => Money::minorUnits($expected) === Money::minorUnits($actual),
        ];
    }

    public function listAll(): array
    {
        return $this->pdo->query(
            'SELECT ob.id, ob.guest_id, ga.full_name, ob.amount, ob.applicable_from, ob.applicable_to,
                    ob.supporting_reference, ob.status, entrant.username AS entered_by,
                    verifier.username AS verified_by, ob.verified_at, ob.created_at
             FROM opening_balances ob
             JOIN guest_accounts ga ON ga.user_id = ob.guest_id
             JOIN users entrant ON entrant.id = ob.entered_by
             LEFT JOIN users verifier ON verifier.id = ob.verified_by
             ORDER BY ob.created_at DESC LIMIT 1000'
        )->fetchAll();
    }

    private function validateDate(string $value, string $field): void
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new ApiException(422, $field . ' must be a valid YYYY-MM-DD date.');
        }
    }
}
