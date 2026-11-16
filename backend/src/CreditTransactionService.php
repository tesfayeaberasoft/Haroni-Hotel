<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class CreditTransactionService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function createDraft(int $guestId, int $cashierId, string $consumptionDate, array $items): int
    {
        $this->validateItems($items);
        $this->validateSpecialPriceSchema($items);
        $this->validateDate($consumptionDate);
        $this->pdo->beginTransaction();
        try {
            $this->lockGuest($guestId);
            $insert = $this->pdo->prepare(
                "INSERT INTO credit_transactions (guest_id, cashier_id, consumption_date, status)
                 VALUES (?, ?, ?, 'draft')"
            );
            $insert->execute([$guestId, $cashierId, $consumptionDate]);
            $transactionId = (int) $this->pdo->lastInsertId();
            $total = $this->replaceItems($transactionId, $items, $cashierId);
            $itemSnapshot = $this->itemsSnapshot($transactionId);
            $this->pdo->prepare('UPDATE credit_transactions SET total_amount = ? WHERE id = ?')
                ->execute([$total, $transactionId]);
            AuditLogger::record($this->pdo, $cashierId, 'transaction_created', 'credit_transaction', $transactionId, [
                'guest_id' => $guestId,
                'total_amount' => $total,
                'consumption_date' => $consumptionDate,
                'items' => $itemSnapshot,
            ]);
            $this->pdo->commit();
            return $transactionId;
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function submit(int $transactionId, int $cashierId): array
    {
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ((int) $transaction['cashier_id'] !== $cashierId) {
                throw new ApiException(403, 'Only the creating Cashier can submit this transaction.');
            }
            if ($transaction['status'] !== 'draft') {
                throw new ApiException(409, 'Only draft transactions can be submitted.');
            }
            $this->lockGuest((int) $transaction['guest_id']);
            $account = (new CreditAccountService($this->pdo))->summary((int) $transaction['guest_id']);
            $requiresPriceApproval = $this->hasPendingPriceRequests($transactionId);
            $settings = $this->pdo->query(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'confirmation_deadline_hours'"
            )->fetchColumn();
            $hours = filter_var($settings, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 168]]);
            if ($hours === false) {
                throw new \RuntimeException('Confirmation deadline setting is invalid.');
            }
            $exception = !$requiresPriceApproval
                && Money::minorUnits((string) $transaction['total_amount'])
                    > Money::minorUnits($account['available_credit']);
            $status = $requiresPriceApproval ? 'pending_price_approval' : 'pending_guest_confirmation';
            $update = $this->pdo->prepare(
                'UPDATE credit_transactions
                 SET status = ?, requires_exception = ?, confirmation_deadline = ?,
                     dispute_reason = NULL
                 WHERE id = ?'
            );
            $deadline = $requiresPriceApproval ? null : gmdate('Y-m-d H:i:s', time() + ($hours * 3600));
            $update->execute([$status, (int) $exception, $deadline, $transactionId]);
            if ($requiresPriceApproval) {
                NotificationService::financeManagers($this->pdo, $transactionId, $status);
            } else {
                NotificationService::transaction(
                    $this->pdo,
                    (int) $transaction['guest_id'],
                    $transactionId,
                    'transaction_confirmation',
                    'deadline_' . gmdate('YmdHis', time() + ($hours * 3600)),
                    'Credit transaction #' . $transactionId . ' is ready for your review and confirmation.'
                );
            }
            AuditLogger::record($this->pdo, $cashierId, 'transaction_submitted', 'credit_transaction', $transactionId, [
                'requires_exception' => $exception,
                'requires_price_approval' => $requiresPriceApproval,
                'confirmation_deadline_hours' => $hours,
            ]);
            $this->pdo->commit();
            return ['id' => $transactionId, 'status' => $status, 'requires_exception' => $exception];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function updateDraft(
        int $transactionId,
        int $cashierId,
        array $items,
        string $consumptionDate
    ): array {
        $this->validateItems($items);
        $this->validateSpecialPriceSchema($items);
        $this->validateDate($consumptionDate);
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ((int) $transaction['cashier_id'] !== $cashierId) {
                throw new ApiException(403, 'Only the creating Cashier can edit this transaction.');
            }
            if ($transaction['status'] !== 'draft') {
                throw new ApiException(409, 'Only draft transactions can be edited.');
            }
            $this->lockGuest((int) $transaction['guest_id']);
            $previousItems = $this->itemsSnapshot($transactionId);
            $total = $this->replaceItems($transactionId, $items, $cashierId);
            $currentItems = $this->itemsSnapshot($transactionId);
            $this->pdo->prepare(
                'UPDATE credit_transactions SET total_amount = ?, consumption_date = ? WHERE id = ?'
            )->execute([$total, $consumptionDate, $transactionId]);
            AuditLogger::record($this->pdo, $cashierId, 'draft_transaction_updated', 'credit_transaction', $transactionId, [
                'total_amount' => $total,
                'consumption_date' => $consumptionDate,
                'previous_items' => $previousItems,
                'current_items' => $currentItems,
            ]);
            $this->pdo->commit();
            return ['id' => $transactionId, 'status' => 'draft', 'total_amount' => $total];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function confirmByGuest(int $transactionId, int $guestId): array
    {
        return $this->confirm($transactionId, $guestId, 'portal', null, null);
    }

    public function confirmInPerson(int $transactionId, int $guestId, int $cashierId, string $pin): array
    {
        if (!preg_match('/^\d{6,12}$/D', $pin)) {
            throw new ApiException(422, 'The guest confirmation PIN is invalid.');
        }
        $this->checkPinRateLimit($guestId);
        $query = $this->pdo->prepare('SELECT pin_hash FROM guest_confirmation_pins WHERE guest_id = ?');
        $query->execute([$guestId]);
        $hash = $query->fetchColumn();
        if (!is_string($hash) || !password_verify($pin, $hash)) {
            $this->recordPinFailure($guestId);
            throw new ApiException(403, 'Guest confirmation PIN is invalid.');
        }
        $this->pdo->prepare('DELETE FROM confirmation_pin_attempts WHERE guest_id = ? AND ip_key = ?')
            ->execute([$guestId, hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown')]);
        return $this->confirm($transactionId, $guestId, 'pin', $cashierId, $cashierId);
    }

    public function dispute(int $transactionId, int $guestId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000) {
            throw new ApiException(422, 'A dispute reason of 1 to 2000 characters is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ((int) $transaction['guest_id'] !== $guestId) {
                throw new ApiException(404, 'Transaction not found.');
            }
            if ($transaction['status'] !== 'pending_guest_confirmation') {
                throw new ApiException(409, 'Only transactions awaiting guest confirmation can be disputed.');
            }
            $this->pdo->prepare(
                "UPDATE credit_transactions SET status = 'disputed', dispute_reason = ? WHERE id = ?"
            )->execute([$reason, $transactionId]);
            AuditLogger::record($this->pdo, $guestId, 'transaction_disputed', 'credit_transaction', $transactionId, [
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function correctAndResubmit(
        int $transactionId,
        int $cashierId,
        array $items,
        ?string $consumptionDate = null,
        string $note = ''
    ): array {
        $this->validateItems($items);
        $this->validateSpecialPriceSchema($items);
        if ($consumptionDate !== null) {
            $this->validateDate($consumptionDate);
        }
        $note = trim($note);
        if (mb_strlen($note, 'UTF-8') > 2000) {
            throw new ApiException(422, 'The correction note cannot exceed 2000 characters.');
        }
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ((int) $transaction['cashier_id'] !== $cashierId) {
                throw new ApiException(403, 'Only the creating Cashier can correct this transaction.');
            }
            if (!in_array($transaction['status'], ['disputed', 'pending_guest_confirmation', 'pending_price_approval'], true)) {
                throw new ApiException(409, 'Only disputed or unconfirmed transactions can be corrected.');
            }
            $this->lockGuest((int) $transaction['guest_id']);
            $previousItems = $this->itemsSnapshot($transactionId);
            $total = $this->replaceItems($transactionId, $items, $cashierId);
            $currentItems = $this->itemsSnapshot($transactionId);
            $requiresPriceApproval = $this->hasPendingPriceRequests($transactionId);
            $account = (new CreditAccountService($this->pdo))
                ->summaryExcludingTransaction((int) $transaction['guest_id'], $transactionId);
            $exception = !$requiresPriceApproval
                && Money::minorUnits($total) > Money::minorUnits($account['available_credit']);
            $setting = $this->pdo->query(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'confirmation_deadline_hours'"
            )->fetchColumn();
            $hours = filter_var($setting, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 168]]);
            if ($hours === false) {
                throw new \RuntimeException('Confirmation deadline setting is invalid.');
            }
            $status = $requiresPriceApproval ? 'pending_price_approval' : 'pending_guest_confirmation';
            $deadline = $requiresPriceApproval ? null : gmdate('Y-m-d H:i:s', time() + ($hours * 3600));
            $this->pdo->prepare(
                'UPDATE credit_transactions
                 SET total_amount = ?, consumption_date = COALESCE(?, consumption_date),
                     status = ?, requires_exception = ?, confirmation_deadline = ?,
                     guest_confirmed_at = NULL, confirmation_method = NULL,
                     confirmation_assisted_by = NULL, dispute_reason = NULL
                 WHERE id = ?'
            )->execute([$total, $consumptionDate, $status, (int) $exception, $deadline, $transactionId]);
            if ($requiresPriceApproval) {
                NotificationService::financeManagers($this->pdo, $transactionId, $status);
            } else {
                NotificationService::transaction(
                    $this->pdo,
                    (int) $transaction['guest_id'],
                    $transactionId,
                    'transaction_confirmation',
                    'resubmission_' . gmdate('YmdHis'),
                    'Corrected credit transaction #' . $transactionId . ' is ready for your review.'
                );
            }
            AuditLogger::record($this->pdo, $cashierId, 'transaction_corrected_resubmitted', 'credit_transaction', $transactionId, [
                'total_amount' => $total,
                'requires_exception' => $exception,
                'requires_price_approval' => $requiresPriceApproval,
                'consumption_date' => $consumptionDate,
                'reason' => $note,
                'previous_items' => $previousItems,
                'current_items' => $currentItems,
            ]);
            $this->pdo->commit();
            return ['id' => $transactionId, 'status' => $status, 'requires_exception' => $exception];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function reviewPriceRequest(int $requestId, int $financeManagerId, bool $approve, string $reason = ''): void
    {
        $reason = trim($reason);
        if (!$approve && ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000)) {
            throw new ApiException(422, 'A reason is required to reject the special price request.');
        }
        $this->pdo->beginTransaction();
        try {
            $transactionIdQuery = $this->pdo->prepare(
                'SELECT transaction_id FROM transaction_price_requests WHERE id = ?'
            );
            $transactionIdQuery->execute([$requestId]);
            $transactionId = $transactionIdQuery->fetchColumn();
            if ($transactionId === false) {
                throw new ApiException(404, 'Transaction price request not found.');
            }
            $transaction = $this->lockTransaction((int) $transactionId);
            $query = $this->pdo->prepare(
                'SELECT r.*, i.quantity, t.guest_id, t.status AS transaction_status
                 FROM transaction_price_requests r
                 JOIN credit_transaction_items i ON i.id = r.transaction_item_id
                 JOIN credit_transactions t ON t.id = r.transaction_id
                 WHERE r.id = ? FOR UPDATE'
            );
            $query->execute([$requestId]);
            $request = $query->fetch();
            if ($request === false) {
                throw new ApiException(404, 'Transaction price request not found.');
            }
            if ($request['status'] !== 'pending' || $request['transaction_status'] !== 'pending_price_approval') {
                throw new ApiException(409, 'Transaction price request is no longer awaiting review.');
            }

            if (!$approve) {
                $this->pdo->prepare(
                    'UPDATE credit_transaction_items
                     SET unit_price = ?, line_total = ROUND(quantity * ?, 2)
                     WHERE id = ?'
                )->execute([$request['catalog_price'], $request['catalog_price'], $request['transaction_item_id']]);
            }
            $status = $approve ? 'approved' : 'rejected';
            $this->pdo->prepare(
                'UPDATE transaction_price_requests
                 SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(6), review_reason = ?
                 WHERE id = ?'
            )->execute([$status, $financeManagerId, $reason !== '' ? $reason : null, $requestId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'transaction_special_price_' . $status, 'transaction_price_request', $requestId, [
                'transaction_id' => (int) $request['transaction_id'],
                'service_id' => (int) $request['service_id'],
                'requested_price' => $request['requested_price'],
                'reason' => $reason,
            ]);

            $transactionId = (int) $request['transaction_id'];
            $totalQuery = $this->pdo->prepare(
                'SELECT COALESCE(SUM(line_total), 0) FROM credit_transaction_items WHERE transaction_id = ?'
            );
            $totalQuery->execute([$transactionId]);
            $total = (string) $totalQuery->fetchColumn();
            $this->pdo->prepare('UPDATE credit_transactions SET total_amount = ? WHERE id = ?')
                ->execute([$total, $transactionId]);
            if ($this->hasPendingPriceRequests($transactionId)) {
                $this->pdo->commit();
                return;
            }
            $this->lockGuest((int) $request['guest_id'], false);
            $account = (new CreditAccountService($this->pdo))
                ->summaryExcludingTransaction((int) $request['guest_id'], $transactionId);
            $exception = Money::minorUnits($total) > Money::minorUnits($account['available_credit']);
            $setting = $this->pdo->query(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'confirmation_deadline_hours'"
            )->fetchColumn();
            $hours = filter_var($setting, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 168]]);
            if ($hours === false) {
                throw new \RuntimeException('Confirmation deadline setting is invalid.');
            }
            $this->pdo->prepare(
                "UPDATE credit_transactions
                 SET total_amount = ?, status = 'pending_guest_confirmation', requires_exception = ?,
                     confirmation_deadline = TIMESTAMPADD(HOUR, ?, UTC_TIMESTAMP(6))
                 WHERE id = ?"
            )->execute([$total, (int) $exception, $hours, $transactionId]);
            NotificationService::transaction(
                $this->pdo,
                (int) $request['guest_id'],
                $transactionId,
                'transaction_confirmation',
                'price_reviewed_' . gmdate('YmdHis'),
                'Credit transaction #' . $transactionId . ' is ready for your review and confirmation.'
            );
            AuditLogger::record($this->pdo, $financeManagerId, 'transaction_special_price_reviewed', 'credit_transaction', $transactionId, [
                'total_amount' => $total,
                'requires_exception' => $exception,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function approve(int $transactionId, int $financeManagerId, ?string $exceptionReason): array
    {
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if (!in_array($transaction['status'], ['pending_finance_approval', 'pending_exceptional_approval'], true)) {
                throw new ApiException(409, 'Transaction is not awaiting Finance approval.');
            }
            $exceptionRequired = (bool) $transaction['requires_exception']
                || $transaction['status'] === 'pending_exceptional_approval';
            $reason = trim((string) $exceptionReason);
            if ($exceptionRequired && ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000)) {
                throw new ApiException(422, 'A reason of 1 to 2000 characters is required for exceptional approval.');
            }
            $this->lockGuest((int) $transaction['guest_id'], false);
            $account = (new CreditAccountService($this->pdo))
                ->summaryExcludingTransaction((int) $transaction['guest_id'], $transactionId);
            $exceeds = Money::minorUnits((string) $transaction['total_amount'])
                > Money::minorUnits($account['available_credit']);
            if ($exceeds && !$exceptionRequired) {
                $this->pdo->prepare(
                    "UPDATE credit_transactions SET status = 'pending_exceptional_approval', requires_exception = TRUE
                     WHERE id = ?"
                )->execute([$transactionId]);
                NotificationService::financeManagers($this->pdo, $transactionId, 'pending_exceptional_approval');
                AuditLogger::record($this->pdo, $financeManagerId, 'exceptional_approval_required', 'credit_transaction', $transactionId, [
                    'available_credit_before_transaction' => $account['available_credit'],
                    'transaction_amount' => $transaction['total_amount'],
                ]);
                $this->pdo->commit();
                return ['id' => $transactionId, 'status' => 'pending_exceptional_approval'];
            }
            $this->pdo->prepare(
                "UPDATE credit_transactions
                 SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(6), exception_reason = ?
                 WHERE id = ?"
            )->execute([$financeManagerId, $exceptionRequired ? $reason : null, $transactionId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'transaction_approved', 'credit_transaction', $transactionId, [
                'total_amount' => $transaction['total_amount'],
                'exceptional_approval' => $exceptionRequired,
                'reason' => $exceptionRequired ? $reason : null,
            ]);
            $this->pdo->commit();
            return ['id' => $transactionId, 'status' => 'approved'];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function reject(int $transactionId, int $financeManagerId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000) {
            throw new ApiException(422, 'A rejection reason of 1 to 2000 characters is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if (!in_array($transaction['status'], ['pending_finance_approval', 'pending_exceptional_approval'], true)) {
                throw new ApiException(409, 'Transaction is not awaiting Finance approval.');
            }
            $this->pdo->prepare(
                "UPDATE credit_transactions
                 SET status = 'rejected', rejected_by = ?, rejection_reason = ?
                 WHERE id = ?"
            )->execute([$financeManagerId, $reason, $transactionId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'transaction_rejected', 'credit_transaction', $transactionId, [
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function cancel(int $transactionId, int $actorId, string $role, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 2000) {
            throw new ApiException(422, 'A cancellation reason of 1 to 2000 characters is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ($role === 'cashier' && (int) $transaction['cashier_id'] !== $actorId) {
                throw new ApiException(403, 'Only the creating Cashier can cancel this transaction.');
            }
            if (!in_array($transaction['status'], ['draft', 'pending_guest_confirmation', 'disputed', 'pending_price_approval'], true)) {
                throw new ApiException(409, 'This transaction cannot be cancelled in its current state.');
            }
            $this->pdo->prepare(
                "UPDATE credit_transactions
                 SET status = 'cancelled', cancelled_by = ?, cancellation_reason = ?
                 WHERE id = ?"
            )->execute([$actorId, $reason, $transactionId]);
            $hasPriceRequestTable = $this->pdo->query(
                "SELECT EXISTS(
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = DATABASE() AND table_name = 'transaction_price_requests'
                )"
            )->fetchColumn();
            if ((bool) $hasPriceRequestTable) {
                $this->pdo->prepare(
                    "UPDATE transaction_price_requests
                     SET status = 'rejected'
                     WHERE transaction_id = ? AND status = 'pending'"
                )->execute([$transactionId]);
            }
            AuditLogger::record($this->pdo, $actorId, 'transaction_cancelled', 'credit_transaction', $transactionId, [
                'reason' => $reason,
            ]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    public function expirePending(): int
    {
        $expired = $this->pdo->query(
            "SELECT id, cashier_id FROM credit_transactions
             WHERE status = 'pending_guest_confirmation' AND confirmation_deadline <= UTC_TIMESTAMP(6)
             ORDER BY confirmation_deadline LIMIT 500"
        )->fetchAll();
        $count = 0;
        foreach ($expired as $row) {
            $this->pdo->beginTransaction();
            try {
                $query = $this->pdo->prepare(
                    "UPDATE credit_transactions SET status = 'expired'
                     WHERE id = ? AND status = 'pending_guest_confirmation'
                       AND confirmation_deadline <= UTC_TIMESTAMP(6)"
                );
                $query->execute([(int) $row['id']]);
                if ($query->rowCount() === 1) {
                    $notify = $this->pdo->prepare(
                        "INSERT INTO notifications
                            (user_id, related_transaction_id, notification_type, event_key, message)
                         SELECT guest_id, id, 'transaction_expired', 'expired', ?
                         FROM credit_transactions WHERE id = ?
                         ON DUPLICATE KEY UPDATE message = VALUES(message)"
                    );
                    $notify->execute(['Credit transaction #' . (int) $row['id'] . ' expired without confirmation.', (int) $row['id']]);
                    AuditLogger::record($this->pdo, (int) $row['cashier_id'], 'transaction_expired', 'credit_transaction', (int) $row['id']);
                    $count++;
                }
                $this->pdo->commit();
            } catch (Throwable $exception) {
                $this->rollback();
                throw $exception;
            }
        }
        return $count;
    }

    public function details(int $transactionId, array $user): array
    {
        $query = $this->pdo->prepare(
            'SELECT ct.*, ga.full_name, cashier.username AS cashier_username
             FROM credit_transactions ct
             JOIN guest_accounts ga ON ga.user_id = ct.guest_id
             JOIN users cashier ON cashier.id = ct.cashier_id
             WHERE ct.id = ?'
        );
        $query->execute([$transactionId]);
        $transaction = $query->fetch();
        if ($transaction === false) {
            throw new ApiException(404, 'Transaction not found.');
        }
        if ($user['role'] === 'guest' && (int) $transaction['guest_id'] !== (int) $user['id']) {
            throw new ApiException(404, 'Transaction not found.');
        }
        if ($user['role'] === 'cashier' && (int) $transaction['cashier_id'] !== (int) $user['id']) {
            throw new ApiException(404, 'Transaction not found.');
        }
        if (!in_array($user['role'], ['guest', 'cashier', 'finance_manager'], true)) {
            throw new ApiException(403, 'Your role cannot view transaction details.');
        }
        $items = $this->pdo->prepare(
            'SELECT i.service_id, i.service_name_snapshot AS service_name, i.quantity,
                    i.unit_price, i.line_total, COALESCE(r.catalog_price, i.unit_price) AS catalog_price,
                    r.requested_price, r.reason AS price_reason, r.status AS price_status
             FROM credit_transaction_items i
             LEFT JOIN transaction_price_requests r ON r.transaction_item_id = i.id
             WHERE i.transaction_id = ? ORDER BY i.id'
        );
        $items->execute([$transactionId]);
        $transaction['items'] = $items->fetchAll();
        $transaction['history'] = $this->history($transactionId);
        return $transaction;
    }

    public function listFor(array $user, ?string $status = null): array
    {
        $parameters = [];
        $where = [];
        if ($user['role'] === 'guest') {
            $where[] = 'ct.guest_id = ?';
            $parameters[] = (int) $user['id'];
        } elseif ($user['role'] === 'cashier') {
            $where[] = 'ct.cashier_id = ?';
            $parameters[] = (int) $user['id'];
        } elseif ($user['role'] !== 'finance_manager') {
            throw new ApiException(403, 'Your role cannot view transactions.');
        }
        $allowedStatuses = [
            'draft', 'pending_guest_confirmation', 'disputed', 'pending_price_approval', 'pending_finance_approval',
            'pending_exceptional_approval', 'approved', 'rejected', 'cancelled', 'expired',
        ];
        if ($status !== null) {
            if (!in_array($status, $allowedStatuses, true)) {
                throw new ApiException(422, 'Unknown transaction status.');
            }
            $where[] = 'ct.status = ?';
            $parameters[] = $status;
        }
        $sql = 'SELECT ct.id, ct.guest_id, ga.full_name, ct.cashier_id, ct.consumption_date,
                       ct.status, ct.total_amount, ct.requires_exception, ct.confirmation_deadline,
                       ct.created_at
                FROM credit_transactions ct JOIN guest_accounts ga ON ga.user_id = ct.guest_id';
        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY ct.created_at DESC LIMIT 500';
        $query = $this->pdo->prepare($sql);
        $query->execute($parameters);
        $transactions = $query->fetchAll();
        if ($transactions === []) {
            return [];
        }

        $transactionIds = array_map('intval', array_column($transactions, 'id'));
        $placeholders = implode(', ', array_fill(0, count($transactionIds), '?'));
        $itemsQuery = $this->pdo->prepare(
            'SELECT i.transaction_id, i.service_id, i.service_name_snapshot AS service_name,
                    i.quantity, i.unit_price, i.line_total,
                    COALESCE(r.catalog_price, i.unit_price) AS catalog_price,
                    r.requested_price, r.reason AS price_reason, r.status AS price_status
             FROM credit_transaction_items i
             LEFT JOIN transaction_price_requests r ON r.transaction_item_id = i.id
             WHERE i.transaction_id IN (' . $placeholders . ')
             ORDER BY i.transaction_id, i.id'
        );
        $itemsQuery->execute($transactionIds);
        $itemsByTransaction = [];
        foreach ($itemsQuery->fetchAll() as $item) {
            $transactionId = (int) $item['transaction_id'];
            unset($item['transaction_id']);
            $itemsByTransaction[$transactionId][] = $item;
        }
        foreach ($transactions as &$transaction) {
            $transaction['items'] = $itemsByTransaction[(int) $transaction['id']] ?? [];
        }
        unset($transaction);

        return $transactions;
    }

    private function confirm(
        int $transactionId,
        int $guestId,
        string $method,
        ?int $cashierId,
        ?int $actorId
    ): array {
        $this->pdo->beginTransaction();
        try {
            $transaction = $this->lockTransaction($transactionId);
            if ((int) $transaction['guest_id'] !== $guestId) {
                throw new ApiException(404, 'Transaction not found.');
            }
            if ($transaction['status'] !== 'pending_guest_confirmation') {
                throw new ApiException(409, 'Transaction is not awaiting guest confirmation.');
            }
            $deadlineCheck = $this->pdo->prepare(
                'SELECT confirmation_deadline IS NOT NULL AND confirmation_deadline > UTC_TIMESTAMP(6)
                 FROM credit_transactions WHERE id = ?'
            );
            $deadlineCheck->execute([$transactionId]);
            if (!(bool) $deadlineCheck->fetchColumn()) {
                $this->pdo->prepare("UPDATE credit_transactions SET status = 'expired' WHERE id = ?")
                    ->execute([$transactionId]);
                NotificationService::transaction(
                    $this->pdo,
                    $guestId,
                    $transactionId,
                    'transaction_expired',
                    'expired',
                    'Credit transaction #' . $transactionId . ' expired without confirmation.'
                );
                AuditLogger::record($this->pdo, $actorId ?? $guestId, 'transaction_expired', 'credit_transaction', $transactionId);
                $this->pdo->commit();
                throw new ApiException(409, 'Confirmation deadline has passed; the reservation was released.');
            }
            $status = (bool) $transaction['requires_exception']
                ? 'pending_exceptional_approval'
                : 'pending_finance_approval';
            $this->pdo->prepare(
                'UPDATE credit_transactions
                 SET status = ?, guest_confirmed_at = UTC_TIMESTAMP(6), confirmation_method = ?,
                     confirmation_assisted_by = ?
                 WHERE id = ?'
            )->execute([$status, $method, $cashierId, $transactionId]);
            if (in_array($status, ['pending_finance_approval', 'pending_exceptional_approval'], true)) {
                NotificationService::financeManagers($this->pdo, $transactionId, $status);
            }
            AuditLogger::record($this->pdo, $actorId ?? $guestId, 'transaction_confirmed', 'credit_transaction', $transactionId, [
                'confirmation_method' => $method,
                'assisting_cashier_id' => $cashierId,
            ]);
            $this->pdo->commit();
            return ['id' => $transactionId, 'status' => $status];
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    private function replaceItems(int $transactionId, array $items, int $cashierId): string
    {
        $this->pdo->prepare('DELETE FROM credit_transaction_items WHERE transaction_id = ?')
            ->execute([$transactionId]);
        $sum = $this->pdo->prepare(
            'SELECT COALESCE(SUM(line_total), 0) FROM credit_transaction_items WHERE transaction_id = ?'
        );
        $serviceQuery = $this->pdo->prepare(
            'SELECT name, current_price FROM service_catalog
             WHERE id = ? AND is_active = TRUE FOR UPDATE'
        );
        $insert = $this->pdo->prepare(
            'INSERT INTO credit_transaction_items
                (transaction_id, service_id, service_name_snapshot, quantity, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ROUND(? * ?, 2))'
        );
        $priceRequest = $this->pdo->prepare(
            'INSERT INTO transaction_price_requests
                (transaction_id, transaction_item_id, service_id, catalog_price, requested_price, reason, requested_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($items as $item) {
            if (!is_array($item) || !isset($item['service_id'], $item['quantity'])) {
                throw new ApiException(422, 'Each item must contain service_id and quantity.');
            }
            $serviceId = filter_var($item['service_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($serviceId === false) {
                throw new ApiException(422, 'service_id must be a positive integer.');
            }
            $quantity = Http::positiveNumber($item['quantity'], 'quantity');
            $serviceQuery->execute([$serviceId]);
            $service = $serviceQuery->fetch();
            if ($service === false) {
                throw new ApiException(422, 'A selected service does not exist or is inactive.');
            }
            $catalogPrice = (string) $service['current_price'];
            $unitPrice = $catalogPrice;
            $requestReason = null;
            if (array_key_exists('requested_price', $item)) {
                $requestedPrice = Http::money($item['requested_price'], 'requested_price');
                if (Money::minorUnits($requestedPrice) <= 0) {
                    throw new ApiException(422, 'requested_price must be greater than zero.');
                }
                $requestReason = Http::text($item['price_reason'] ?? null, 'price_reason', 1000);
                if (Money::minorUnits($requestedPrice) !== Money::minorUnits($catalogPrice)) {
                    $unitPrice = $requestedPrice;
                } else {
                    $requestReason = null;
                }
            }
            $insert->execute([
                $transactionId,
                $serviceId,
                $service['name'],
                $quantity,
                $unitPrice,
                $quantity,
                $unitPrice,
            ]);
            if ($requestReason !== null) {
                $priceRequest->execute([
                    $transactionId,
                    (int) $this->pdo->lastInsertId(),
                    $serviceId,
                    $catalogPrice,
                    $unitPrice,
                    $requestReason,
                    $cashierId,
                ]);
            }
        }
        $sum->execute([$transactionId]);
        return (string) $sum->fetchColumn();
    }

    private function itemsSnapshot(int $transactionId): array
    {
        $query = $this->pdo->prepare(
            'SELECT service_id, service_name_snapshot AS service_name, quantity, unit_price, line_total
             FROM credit_transaction_items WHERE transaction_id = ? ORDER BY id'
        );
        $query->execute([$transactionId]);
        return $query->fetchAll();
    }

    private function validateItems(array $items): void
    {
        if ($items === [] || count($items) > 100 || !array_is_list($items)) {
            throw new ApiException(422, 'A transaction must contain between 1 and 100 service items.');
        }
        foreach ($items as $item) {
            if (!is_array($item)
                || array_diff(array_keys($item), ['service_id', 'quantity', 'requested_price', 'price_reason']) !== []
                || !array_key_exists('service_id', $item)
                || !array_key_exists('quantity', $item)
                || array_key_exists('requested_price', $item) !== array_key_exists('price_reason', $item)) {
                throw new ApiException(422, 'Service items must contain service_id and quantity, with requested_price and price_reason together.');
            }
        }
    }

    private function validateSpecialPriceSchema(array $items): void
    {
        foreach ($items as $item) {
            if (!array_key_exists('requested_price', $item)) {
                continue;
            }
            $schema = $this->pdo->query(
                "SELECT EXISTS(
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = DATABASE() AND table_name = 'transaction_price_requests'
                ) AS has_request_table,
                (
                    SELECT column_type FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = 'credit_transactions'
                      AND column_name = 'status'
                ) AS transaction_status_type"
            )->fetch();
            if ($schema === false
                || !(bool) $schema['has_request_table']
                || !is_string($schema['transaction_status_type'])
                || !str_contains($schema['transaction_status_type'], "'pending_price_approval'")) {
                throw new ApiException(
                    503,
                    'Special-price requests are unavailable until database migration 003 is applied to the active database.'
                );
            }
            return;
        }
    }

    private function hasPendingPriceRequests(int $transactionId): bool
    {
        $query = $this->pdo->prepare(
            "SELECT EXISTS(
                SELECT 1 FROM transaction_price_requests
                WHERE transaction_id = ? AND status = 'pending'
            )"
        );
        $query->execute([$transactionId]);
        return (bool) $query->fetchColumn();
    }

    private function validateDate(string $date): void
    {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($parsed === false || $parsed->format('Y-m-d') !== $date) {
            throw new ApiException(422, 'consumption_date must be a valid YYYY-MM-DD date.');
        }
    }

    private function lockGuest(int $guestId, bool $requireActive = true): void
    {
        $query = $this->pdo->prepare(
            'SELECT g.user_id, u.is_active FROM guest_accounts g
             JOIN users u ON u.id = g.user_id WHERE g.user_id = ? FOR UPDATE'
        );
        $query->execute([$guestId]);
        $guest = $query->fetch();
        if ($guest === false) {
            throw new ApiException(404, 'Guest account not found.');
        }
        if ($requireActive && !(bool) $guest['is_active']) {
            throw new ApiException(409, 'Credit transactions cannot be created for an inactive guest account.');
        }
    }

    private function lockTransaction(int $transactionId): array
    {
        $query = $this->pdo->prepare('SELECT * FROM credit_transactions WHERE id = ? FOR UPDATE');
        $query->execute([$transactionId]);
        $transaction = $query->fetch();
        if ($transaction === false) {
            throw new ApiException(404, 'Transaction not found.');
        }
        return $transaction;
    }

    private function checkPinRateLimit(int $guestId): void
    {
        $ipKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $query = $this->pdo->prepare(
            'SELECT locked_until > UTC_TIMESTAMP(6) FROM confirmation_pin_attempts
             WHERE guest_id = ? AND ip_key = ?'
        );
        $query->execute([$guestId, $ipKey]);
        $lockedUntil = $query->fetchColumn();
        if ((bool) $lockedUntil) {
            throw new ApiException(429, 'Too many PIN attempts. Try again later.');
        }
    }

    private function recordPinFailure(int $guestId): void
    {
        $ipKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $query = $this->pdo->prepare(
            'INSERT INTO confirmation_pin_attempts (guest_id, ip_key, attempts, locked_until)
             VALUES (?, ?, 1, NULL)
             ON DUPLICATE KEY UPDATE
                attempts = IF(
                    locked_until IS NOT NULL AND locked_until <= UTC_TIMESTAMP(6),
                    1,
                    attempts + 1
                ),
                locked_until = IF(
                    attempts >= 5,
                    UTC_TIMESTAMP(6) + INTERVAL 15 MINUTE,
                    NULL
                )'
        );
        $query->execute([$guestId, $ipKey]);
    }

    private function history(int $transactionId): array
    {
        $query = $this->pdo->prepare(
            'SELECT a.action, a.details, a.created_at, u.full_name AS actor_name
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.entity_type = \'credit_transaction\' AND a.entity_id = ?
             ORDER BY a.created_at, a.id'
        );
        $query->execute([$transactionId]);
        $events = [];
        $sequence = 0;
        foreach ($query->fetchAll() as $row) {
            $details = is_string($row['details'])
                ? json_decode($row['details'], true)
                : [];
            if (!is_array($details)) {
                $details = [];
            }
            $action = (string) $row['action'];
            $label = match ($action) {
                'transaction_created' => 'Recorded',
                'transaction_submitted' => 'Recorded and submitted to guest',
                'draft_transaction_updated' => 'Draft updated',
                'transaction_confirmed' => 'Confirmed by guest',
                'transaction_disputed' => 'Disputed by guest',
                'disputed_transaction_corrected_resubmitted',
                'transaction_corrected_resubmitted' => 'Corrected and resubmitted to guest',
                'exceptional_approval_required' => 'Exceptional approval requested',
                'transaction_approved' => !empty($details['exceptional_approval'])
                    ? 'Exceptional credit approved — added to debt'
                    : 'Approved — added to debt',
                'transaction_rejected' => 'Rejected by Finance',
                'transaction_cancelled' => 'Cancelled',
                'transaction_expired' => 'Expired — confirmation deadline passed; reservation released',
                default => ucwords(str_replace('_', ' ', $action)),
            };
            $note = match ($action) {
                'transaction_disputed', 'transaction_rejected', 'transaction_cancelled',
                'transaction_corrected_resubmitted' =>
                    is_string($details['reason'] ?? null) ? trim($details['reason']) : '',
                'transaction_approved' =>
                    is_string($details['reason'] ?? null) ? trim($details['reason']) : '',
                default => '',
            };
            $events[] = [
                'at' => (string) $row['created_at'],
                'by' => $action === 'transaction_expired'
                    ? 'System'
                    : (is_string($row['actor_name']) && $row['actor_name'] !== '' ? $row['actor_name'] : 'System'),
                'action' => $label,
                'note' => $note,
                'sequence' => $sequence++,
            ];
        }

        $reminders = $this->pdo->prepare(
            "SELECT created_at
             FROM notifications
             WHERE related_transaction_id = ? AND notification_type = 'confirmation_reminder'
             ORDER BY created_at, id"
        );
        $reminders->execute([$transactionId]);
        foreach ($reminders->fetchAll() as $reminder) {
            $events[] = [
                'at' => (string) $reminder['created_at'],
                'by' => 'System',
                'action' => 'Reminder sent to guest',
                'note' => '',
                'sequence' => $sequence++,
            ];
        }
        usort($events, static function (array $left, array $right): int {
            $dateOrder = strcmp($left['at'], $right['at']);
            return $dateOrder !== 0 ? $dateOrder : $left['sequence'] <=> $right['sequence'];
        });
        foreach ($events as &$event) {
            unset($event['sequence']);
            if ($event['note'] === '') {
                unset($event['note']);
            }
        }
        unset($event);
        return $events;
    }

    private function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }
}
