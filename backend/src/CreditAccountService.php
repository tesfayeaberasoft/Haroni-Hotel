<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;

final class CreditAccountService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function summary(int $guestId): array
    {
        $query = $this->pdo->prepare(
            "SELECT
                g.user_id AS guest_id,
                g.full_name,
                u.username,
                u.phone,
                g.credit_limit,
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0) AS historical_debt,
                COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0) AS approved_credit,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0) AS total_payments,
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0) AS outstanding_debt,
                COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status IN
                    ('pending_guest_confirmation','disputed','pending_price_approval','pending_finance_approval','pending_exceptional_approval')
                    AND (ct.status <> 'pending_guest_confirmation' OR ct.confirmation_deadline > UTC_TIMESTAMP(6))), 0) AS pending_reservations
             FROM guest_accounts g
             JOIN users u ON u.id = g.user_id
             WHERE g.user_id = :guest_id"
        );
        $query->execute(['guest_id' => $guestId]);
        $row = $query->fetch();
        if ($row === false) {
            throw new ApiException(404, 'Guest account not found.');
        }
        return $this->normalize($row);
    }

    public function summaryExcludingTransaction(int $guestId, int $transactionId): array
    {
        $query = $this->pdo->prepare(
            "SELECT
                g.user_id AS guest_id,
                g.full_name,
                u.username,
                u.phone,
                g.credit_limit,
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0) AS historical_debt,
                COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0) AS approved_credit,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0) AS total_payments,
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0) AS outstanding_debt,
                COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status IN
                    ('pending_guest_confirmation','disputed','pending_price_approval','pending_finance_approval','pending_exceptional_approval')
                    AND ct.id <> :exclude_id
                    AND (ct.status <> 'pending_guest_confirmation' OR ct.confirmation_deadline > UTC_TIMESTAMP(6))), 0) AS pending_reservations
             FROM guest_accounts g
             JOIN users u ON u.id = g.user_id
             WHERE g.user_id = :guest_id"
        );
        $query->execute(['exclude_id' => $transactionId, 'guest_id' => $guestId]);
        $row = $query->fetch();
        if ($row === false) {
            throw new ApiException(404, 'Guest account not found.');
        }
        return $this->normalize($row);
    }

    public function setCreditLimit(int $guestId, string $limit, int $financeManagerId): void
    {
        $this->pdo->beginTransaction();
        try {
            $lock = $this->pdo->prepare('SELECT credit_limit FROM guest_accounts WHERE user_id = ? FOR UPDATE');
            $lock->execute([$guestId]);
            $previous = $lock->fetchColumn();
            if ($previous === false) {
                throw new ApiException(404, 'Guest account not found.');
            }
            $this->pdo->prepare('UPDATE guest_accounts SET credit_limit = ? WHERE user_id = ?')
                ->execute([$limit, $guestId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'credit_limit_updated', 'guest_account', $guestId, [
                'previous_credit_limit' => (string) $previous,
                'new_credit_limit' => $limit,
            ]);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function normalize(array $row): array
    {
        $creditLimit = Money::minorUnits((string) $row['credit_limit']);
        $debt = Money::minorUnits((string) $row['outstanding_debt']);
        $reservations = Money::minorUnits((string) $row['pending_reservations']);
        $historicalDebt = Money::minorUnits((string) $row['historical_debt']);
        $approvedCredit = Money::minorUnits((string) $row['approved_credit']);
        $totalPayments = Money::minorUnits((string) $row['total_payments']);
        return [
            'guest_id' => (int) $row['guest_id'],
            'full_name' => $row['full_name'],
            'username' => $row['username'],
            'phone' => $row['phone'],
            'credit_limit' => Money::formatMinor($creditLimit),
            'historical_debt' => Money::formatMinor($historicalDebt),
            'approved_credit' => Money::formatMinor($approvedCredit),
            'total_payments' => Money::formatMinor($totalPayments),
            'outstanding_debt' => Money::formatMinor($debt),
            'pending_reservations' => Money::formatMinor($reservations),
            'available_credit' => Money::formatMinor(max(0, $creditLimit - $debt - $reservations)),
            'over_limit' => $debt > $creditLimit,
        ];
    }
}
