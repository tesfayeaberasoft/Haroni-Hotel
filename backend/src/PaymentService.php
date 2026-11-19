<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class PaymentService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function record(
        int $guestId,
        string $amount,
        string $method,
        ?string $reference,
        string $paymentDate,
        int $financeManagerId
    ): int {
        if (!in_array($method, ['cash', 'bank_transfer'], true)) {
            throw new ApiException(422, 'Payment method must be cash or bank_transfer.');
        }
        $reference = $reference === null ? null : trim($reference);
        if ($method === 'bank_transfer' && ($reference === null || $reference === '')) {
            throw new ApiException(422, 'A bank transfer reference number is required.');
        }
        if ($reference !== null && mb_strlen($reference, 'UTF-8') > 160) {
            throw new ApiException(422, 'Payment reference number cannot exceed 160 characters.');
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $paymentDate);
        if ($date === false || $date->format('Y-m-d') !== $paymentDate) {
            throw new ApiException(422, 'payment_date must be a valid YYYY-MM-DD date.');
        }
        $this->pdo->beginTransaction();
        try {
            $guest = $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ? FOR UPDATE');
            $guest->execute([$guestId]);
            if ($guest->fetchColumn() === false) {
                throw new ApiException(404, 'Guest account not found.');
            }
            $query = $this->pdo->prepare(
                "INSERT INTO payments (guest_id, amount, method, reference_number, payment_date, recorded_by)
                 VALUES (?, ?, ?, ?, CONCAT(?, ' 00:00:00'), ?)"
            );
            $query->execute([$guestId, $amount, $method, $reference, $paymentDate, $financeManagerId]);
            $paymentId = (int) $this->pdo->lastInsertId();
            AuditLogger::record($this->pdo, $financeManagerId, 'payment_recorded_pending_verification', 'payment', $paymentId, [
                'guest_id' => $guestId,
                'amount' => $amount,
                'method' => $method,
            ]);
            $this->pdo->commit();
            return $paymentId;
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function verify(int $paymentId, int $financeManagerId, string $reason = 'Funds received and verified'): array
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A verification note of 1 to 1000 characters is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare('SELECT * FROM payments WHERE id = ? FOR UPDATE');
            $query->execute([$paymentId]);
            $payment = $query->fetch();
            if ($payment === false) {
                throw new ApiException(404, 'Payment not found.');
            }
            if ($payment['status'] !== 'pending_verification') {
                throw new ApiException(409, 'Only payments awaiting verification can be verified.');
            }
            $guest = $this->pdo->prepare('SELECT user_id FROM guest_accounts WHERE user_id = ? FOR UPDATE');
            $guest->execute([(int) $payment['guest_id']]);
            $account = (new CreditAccountService($this->pdo))->summary((int) $payment['guest_id']);
            if (Money::minorUnits((string) $payment['amount']) > Money::minorUnits($account['outstanding_debt'])) {
                throw new ApiException(422, 'Payment exceeds the current outstanding debt; record a corrected amount.');
            }
            $previous = $account['outstanding_debt'];
            $remaining = Money::formatMinor(
                Money::minorUnits($previous) - Money::minorUnits((string) $payment['amount'])
            );
            $receipt = 'HH-' . gmdate('Ymd') . '-' . str_pad((string) $paymentId, 8, '0', STR_PAD_LEFT);
            $update = $this->pdo->prepare(
                "UPDATE payments
                 SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP(6),
                     verification_reason = ?, receipt_number = ?, previous_balance = ?, remaining_balance = ?
                 WHERE id = ? AND status = 'pending_verification'"
            );
            $update->execute([$financeManagerId, $reason, $receipt, $previous, $remaining, $paymentId]);
            if ($update->rowCount() !== 1) {
                throw new ApiException(409, 'Payment status changed; reload and try again.');
            }
            AuditLogger::record($this->pdo, $financeManagerId, 'payment_verified', 'payment', $paymentId, [
                'amount' => $payment['amount'],
                'previous_balance' => $previous,
                'remaining_balance' => $remaining,
                'receipt_number' => $receipt,
                'verification_reason' => $reason,
            ]);
            $this->pdo->commit();
            return ['id' => $paymentId, 'status' => 'verified', 'receipt_number' => $receipt];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function reject(int $paymentId, int $financeManagerId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A payment rejection reason is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                "UPDATE payments SET status = 'rejected', verified_by = ?, verified_at = UTC_TIMESTAMP(6),
                    verification_reason = ? WHERE id = ? AND status = 'pending_verification'"
            );
            $query->execute([$financeManagerId, $reason, $paymentId]);
            if ($query->rowCount() !== 1) {
                throw new ApiException(409, 'Payment is not awaiting verification.');
            }
            AuditLogger::record($this->pdo, $financeManagerId, 'payment_rejected', 'payment', $paymentId, [
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function listFor(array $user): array
    {
        if ($user['role'] === 'guest') {
            $query = $this->pdo->prepare(
                'SELECT p.id, p.amount, p.method, p.reference_number, p.payment_date, p.status,
                        p.receipt_number, p.previous_balance, p.remaining_balance
                 FROM payments p WHERE p.guest_id = ? AND p.status = \'verified\'
                 ORDER BY p.payment_date DESC LIMIT 500'
            );
            $query->execute([(int) $user['id']]);
        } elseif (in_array($user['role'], ['finance_manager', 'owner'], true)) {
            $query = $this->pdo->query(
                'SELECT p.id, p.guest_id, ga.full_name, p.amount, p.method, p.reference_number,
                        p.payment_date, p.status, p.receipt_number, p.previous_balance, p.remaining_balance,
                        recorder.username AS recorded_by, verifier.username AS verified_by
                 FROM payments p JOIN guest_accounts ga ON ga.user_id = p.guest_id
                 JOIN users recorder ON recorder.id = p.recorded_by
                 LEFT JOIN users verifier ON verifier.id = p.verified_by
                 ORDER BY p.payment_date DESC LIMIT 500'
            );
        } else {
            throw new ApiException(403, 'Your role cannot view payment records.');
        }
        return $query->fetchAll();
    }

    public function receiptData(int $paymentId, array $user): array
    {
        $query = $this->pdo->prepare(
            "SELECT p.id, p.guest_id, p.amount, p.method, p.reference_number, p.payment_date,
                    p.status, p.receipt_number, p.previous_balance, p.remaining_balance,
                    ga.full_name, u.phone, recorder.full_name AS recorded_by,
                    verifier.full_name AS finance_manager,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_name') AS hotel_name,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_address') AS hotel_address,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_phone') AS hotel_phone,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_email') AS hotel_email,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_tin') AS hotel_tin,
                    (SELECT setting_value FROM system_settings WHERE setting_key = 'receipt_footer') AS receipt_footer
             FROM payments p
             JOIN guest_accounts ga ON ga.user_id = p.guest_id
             JOIN users u ON u.id = ga.user_id
             JOIN users recorder ON recorder.id = p.recorded_by
             LEFT JOIN users verifier ON verifier.id = p.verified_by
             WHERE p.id = ?"
        );
        $query->execute([$paymentId]);
        $payment = $query->fetch();
        if ($payment === false || $payment['status'] !== 'verified') {
            throw new ApiException(404, 'Verified payment receipt not found.');
        }
        if ($user['role'] === 'guest' && (int) $payment['guest_id'] !== (int) $user['id']) {
            throw new ApiException(404, 'Verified payment receipt not found.');
        }
        if (!in_array($user['role'], ['guest', 'finance_manager', 'owner'], true)) {
            throw new ApiException(403, 'Your role cannot access payment receipts.');
        }
        return $payment;
    }

    private function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }
}
