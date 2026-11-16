<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class FinancialAdjustmentService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(int $guestId, string $amount, string $reason, int $financeManagerId): int
    {
        return $this->post($guestId, $amount, $reason, 'adjustment', null, $financeManagerId);
    }

    public function reverse(int $adjustmentId, string $reason, int $financeManagerId): int
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000) {
            throw new ApiException(422, 'A reason of 1 to 2000 characters is required for a reversal.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare('SELECT * FROM financial_adjustments WHERE id = ? FOR UPDATE');
            $query->execute([$adjustmentId]);
            $original = $query->fetch();
            if ($original === false) {
                throw new ApiException(404, 'Financial adjustment not found.');
            }
            if ($original['reverses_adjustment_id'] !== null) {
                throw new ApiException(409, 'A reversal cannot itself be reversed.');
            }
            $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ? FOR UPDATE')
                ->execute([(int) $original['guest_id']]);
            $amount = -Money::minorUnits((string) $original['amount']);
            if ($amount < 0) {
                $summary = (new CreditAccountService($this->pdo))->summary((int) $original['guest_id']);
                if (-$amount > Money::minorUnits($summary['outstanding_debt'])) {
                    throw new ApiException(422, 'Reversing this adjustment would reduce outstanding debt below zero.');
                }
            }
            $id = $this->insert(
                (int) $original['guest_id'],
                Money::formatMinor($amount),
                $reason,
                'reversal',
                $adjustmentId,
                $financeManagerId
            );
            AuditLogger::record($this->pdo, $financeManagerId, 'financial_adjustment_reversed', 'financial_adjustment', $id, [
                'reverses_adjustment_id' => $adjustmentId,
                'guest_id' => (int) $original['guest_id'],
                'amount' => Money::formatMinor($amount),
                'reason' => $reason,
            ]);
            $this->pdo->commit();
            return $id;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception instanceof \PDOException && $exception->getCode() === '23000') {
                throw new ApiException(409, 'This adjustment has already been reversed.');
            }
            throw $exception;
        }
    }

    private function post(
        int $guestId,
        string $amount,
        string $reason,
        string $type,
        ?int $reversesId,
        int $financeManagerId
    ): int {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000) {
            throw new ApiException(422, 'A reason of 1 to 2000 characters is required for an adjustment.');
        }
        $amountMinor = Money::minorUnits($amount);
        if ($amountMinor === 0) {
            throw new ApiException(422, 'Adjustment amount cannot be zero.');
        }
        $this->pdo->beginTransaction();
        try {
            $guest = $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ? FOR UPDATE');
            $guest->execute([$guestId]);
            if ($guest->fetchColumn() === false) {
                throw new ApiException(404, 'Guest account not found.');
            }
            $summary = (new CreditAccountService($this->pdo))->summary($guestId);
            if ($amountMinor < 0 && -$amountMinor > Money::minorUnits($summary['outstanding_debt'])) {
                throw new ApiException(422, 'A negative adjustment cannot reduce outstanding debt below zero.');
            }
            $id = $this->insert($guestId, $amount, $reason, $type, $reversesId, $financeManagerId);
            AuditLogger::record($this->pdo, $financeManagerId, 'financial_adjustment_created', 'financial_adjustment', $id, [
                'guest_id' => $guestId,
                'amount' => $amount,
                'reason' => $reason,
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

    private function insert(
        int $guestId,
        string $amount,
        string $reason,
        string $type,
        ?int $reversesId,
        int $financeManagerId
    ): int {
        $query = $this->pdo->prepare(
            'INSERT INTO financial_adjustments
                (guest_id, amount, reason, adjustment_type, reverses_adjustment_id, approved_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $query->execute([$guestId, $amount, $reason, $type, $reversesId, $financeManagerId]);
        return (int) $this->pdo->lastInsertId();
    }
}
