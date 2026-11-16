<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;

final class ReportService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function financialSummary(string $period): array
    {
        [$startLocalDate, $endLocalDate, $startUtc, $endUtc] = $this->periodBounds($period);
        $query = $this->pdo->prepare(
            "SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM payments
                    WHERE status = 'verified' AND DATE(payment_date) >= ? AND DATE(payment_date) < ?) AS payments_received,
                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'verified') AS total_verified_payments,
                (SELECT COALESCE(SUM(total_amount), 0) FROM credit_transactions
                    WHERE status = 'approved' AND approved_at >= ? AND approved_at < ?) AS approved_credits,
                (SELECT COALESCE(SUM(total_amount), 0) FROM credit_transactions WHERE status = 'approved') AS total_approved_credits,
                (SELECT COUNT(*) FROM credit_transactions
                    WHERE status IN ('pending_finance_approval','pending_exceptional_approval')) AS pending_approvals,
                (SELECT COUNT(*) FROM credit_transactions
                    WHERE status = 'pending_guest_confirmation') AS pending_guest_confirmations,
                (SELECT COUNT(*) FROM credit_transactions WHERE status = 'disputed') AS disputed_transactions,
                (SELECT COUNT(*) FROM credit_transactions WHERE status = 'pending_exceptional_approval') AS pending_exceptional_approvals,
                (SELECT COUNT(*) FROM credit_transactions WHERE status = 'rejected'
                    AND updated_at >= ? AND updated_at < ?) AS rejected_transactions,
                (SELECT COUNT(*) FROM guest_accounts) AS guest_count,
                (SELECT COALESCE(SUM(amount), 0) FROM opening_balances WHERE status = 'verified') AS historical_debt,
                (SELECT COALESCE(SUM(g.credit_limit), 0) FROM guest_accounts g) AS total_credit_limit"
        );
        $query->execute([$startLocalDate, $endLocalDate, $startUtc, $endUtc, $startUtc, $endUtc]);
        $summary = $query->fetch();
        $debt = $this->pdo->query(
            "SELECT COALESCE(SUM(
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0)
            ), 0) FROM guest_accounts g"
        )->fetchColumn();
        $summary['outstanding_debt'] = $debt;
        $summary['guests_over_limit'] = $this->pdo->query(
            "SELECT COUNT(*) FROM guest_accounts g
             WHERE
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0) > g.credit_limit"
        )->fetchColumn();
        $summary['from'] = $startLocalDate;
        $summary['to'] = (new \DateTimeImmutable($endLocalDate))
            ->modify('-1 day')
            ->format('Y-m-d');
        $summary['period'] = $period;
        $summary['generated_at_utc'] = gmdate('c');
        return $summary;
    }

    public function guestStatement(int $guestId): array
    {
        $account = (new CreditAccountService($this->pdo))->summary($guestId);
        $opening = $this->pdo->prepare(
            "SELECT 'opening_balance' AS entry_type, amount, created_at AS entry_date,
                    'Historical opening balance' AS description
             FROM opening_balances WHERE guest_id = ? AND status = 'verified'"
        );
        $opening->execute([$guestId]);
        $credits = $this->pdo->prepare(
            "SELECT 'approved_credit' AS entry_type, total_amount AS amount, approved_at AS entry_date,
                    CONCAT('Credit transaction #', id) AS description
             FROM credit_transactions WHERE guest_id = ? AND status = 'approved'"
        );
        $credits->execute([$guestId]);
        $payments = $this->pdo->prepare(
            "SELECT 'verified_payment' AS entry_type, -amount AS amount, verified_at AS entry_date,
                    CONCAT('Receipt ', receipt_number) AS description
             FROM payments WHERE guest_id = ? AND status = 'verified'"
        );
        $payments->execute([$guestId]);
        $adjustments = $this->pdo->prepare(
            "SELECT adjustment_type AS entry_type, amount, created_at AS entry_date, reason AS description
             FROM financial_adjustments WHERE guest_id = ?"
        );
        $adjustments->execute([$guestId]);
        $transactions = $this->pdo->prepare(
            'SELECT id, consumption_date, status, total_amount, created_at
             FROM credit_transactions WHERE guest_id = ? ORDER BY created_at DESC LIMIT 500'
        );
        $transactions->execute([$guestId]);
        $transactionRows = $transactions->fetchAll();
        $transactionIds = array_map(static fn(array $transaction): int => (int) $transaction['id'], $transactionRows);
        $itemsByTransaction = [];
        if ($transactionIds !== []) {
            $items = $this->pdo->prepare(
                'SELECT transaction_id, service_name_snapshot AS service_name, quantity, line_total
                 FROM credit_transaction_items
                 WHERE transaction_id IN (' . implode(',', array_fill(0, count($transactionIds), '?')) . ')
                 ORDER BY transaction_id, id'
            );
            $items->execute($transactionIds);
            foreach ($items->fetchAll() as $item) {
                $itemsByTransaction[(int) $item['transaction_id']][] = $item;
            }
        }
        foreach ($transactionRows as &$transaction) {
            $transaction['items'] = $itemsByTransaction[(int) $transaction['id']] ?? [];
        }
        unset($transaction);

        $historicalRows = $this->pdo->prepare(
            'SELECT amount, supporting_reference AS source_reference, applicable_from AS original_date
             FROM opening_balances
             WHERE guest_id = ? AND status = \'verified\'
             ORDER BY applicable_from, id'
        );
        $historicalRows->execute([$guestId]);
        $paymentsRows = $this->pdo->prepare(
            "SELECT payment_date, receipt_number, method, amount, remaining_balance
             FROM payments WHERE guest_id = ? AND status = 'verified'
             ORDER BY payment_date DESC LIMIT 500"
        );
        $paymentsRows->execute([$guestId]);
        $reservations = $this->pdo->prepare(
            "SELECT id, status, total_amount, confirmation_deadline
             FROM credit_transactions WHERE guest_id = ? AND status IN
                ('pending_guest_confirmation','disputed','pending_finance_approval','pending_exceptional_approval')
             ORDER BY created_at DESC LIMIT 500"
        );
        $reservations->execute([$guestId]);
        $ledger = array_merge($opening->fetchAll(), $credits->fetchAll(), $payments->fetchAll(), $adjustments->fetchAll());
        usort($ledger, static fn(array $left, array $right): int => strcmp($right['entry_date'], $left['entry_date']));
        return [
            'account' => $account,
            'ledger' => $ledger,
            'historical' => $historicalRows->fetchAll(),
            'transactions' => $transactionRows,
            'payments' => $paymentsRows->fetchAll(),
            'pending_reservations' => $reservations->fetchAll(),
        ];
    }

    public function financialReport(string $type, string $period): array
    {
        if ($type === 'guest-debts') {
            [$startLocalDate, $endLocalDate] = $this->periodBounds($period);
            $summary = $this->financialSummary($period);
            $query = $this->pdo->query(
                "WITH opening AS (
                    SELECT guest_id, SUM(amount) AS amount FROM opening_balances
                    WHERE status = 'verified' GROUP BY guest_id
                 ), credits AS (
                    SELECT guest_id, SUM(total_amount) AS amount FROM credit_transactions
                    WHERE status = 'approved' GROUP BY guest_id
                 ), verified_payments AS (
                    SELECT guest_id, SUM(amount) AS amount FROM payments
                    WHERE status = 'verified' GROUP BY guest_id
                 ), adjustments AS (
                    SELECT guest_id, SUM(amount) AS amount FROM financial_adjustments GROUP BY guest_id
                 ), reservations AS (
                    SELECT guest_id, SUM(total_amount) AS amount FROM credit_transactions
                    WHERE status IN ('pending_guest_confirmation','disputed','pending_finance_approval','pending_exceptional_approval')
                      AND (status <> 'pending_guest_confirmation' OR confirmation_deadline > UTC_TIMESTAMP(6))
                    GROUP BY guest_id
                 )
                 SELECT g.user_id AS guest_id, g.full_name AS guest, u.phone, g.credit_limit,
                    COALESCE(o.amount, 0) + COALESCE(c.amount, 0) - COALESCE(p.amount, 0)
                      + COALESCE(a.amount, 0) AS outstanding_debt,
                    COALESCE(r.amount, 0) AS pending_reservations,
                    GREATEST(0, g.credit_limit
                      - (COALESCE(o.amount, 0) + COALESCE(c.amount, 0) - COALESCE(p.amount, 0)
                        + COALESCE(a.amount, 0))
                      - COALESCE(r.amount, 0)) AS available_credit,
                    ((COALESCE(o.amount, 0) + COALESCE(c.amount, 0) - COALESCE(p.amount, 0)
                      + COALESCE(a.amount, 0)) > g.credit_limit) AS over_limit
                 FROM guest_accounts g
                 JOIN users u ON u.id = g.user_id
                 LEFT JOIN opening o ON o.guest_id = g.user_id
                 LEFT JOIN credits c ON c.guest_id = g.user_id
                 LEFT JOIN verified_payments p ON p.guest_id = g.user_id
                 LEFT JOIN adjustments a ON a.guest_id = g.user_id
                 LEFT JOIN reservations r ON r.guest_id = g.user_id
                 ORDER BY outstanding_debt DESC, g.full_name LIMIT 5000"
            );
            return [
                'title' => 'Guest Outstanding Debt Report',
                'period' => $period,
                'from' => $startLocalDate,
                'to' => (new \DateTimeImmutable($endLocalDate))->modify('-1 day')->format('Y-m-d'),
                'generated_at_utc' => gmdate('c'),
                'totals' => [
                    ['label' => 'Total outstanding', 'value' => $summary['outstanding_debt']],
                    ['label' => 'Guests over limit', 'value' => $summary['guests_over_limit']],
                ],
                'columns' => [
                    'guest_id', 'guest', 'phone', 'credit_limit', 'outstanding_debt',
                    'pending_reservations', 'available_credit', 'over_limit',
                ],
                'rows' => $query->fetchAll(),
            ];
        }
        [$startLocalDate, $endLocalDate, $startUtc, $endUtc] = $this->periodBounds($period);
        $reports = [
            'payments' => [
                'title' => 'Payment Report',
                'columns' => ['date', 'guest', 'amount', 'method', 'status', 'receipt_number', 'recorded_by', 'verified_by'],
                'sql' => "SELECT p.payment_date AS date, ga.full_name AS guest, p.amount,
                                 p.method, p.status, p.receipt_number, recorder.username AS recorded_by,
                                 verifier.username AS verified_by
                          FROM payments p
                          JOIN guest_accounts ga ON ga.user_id = p.guest_id
                          JOIN users recorder ON recorder.id = p.recorded_by
                          LEFT JOIN users verifier ON verifier.id = p.verified_by
                          WHERE p.payment_date >= ? AND p.payment_date < ?
                          ORDER BY p.payment_date DESC, p.id DESC LIMIT 5000",
            ],
            'transactions' => [
                'title' => 'Credit Transaction Report',
                'columns' => ['date', 'transaction_id', 'guest', 'amount', 'status', 'cashier', 'finance_approver'],
                'sql' => "SELECT ct.consumption_date AS date, ct.id AS transaction_id,
                                 ga.full_name AS guest, ct.total_amount AS amount, ct.status,
                                 cashier.username AS cashier, approver.username AS finance_approver
                          FROM credit_transactions ct
                          JOIN guest_accounts ga ON ga.user_id = ct.guest_id
                          JOIN users cashier ON cashier.id = ct.cashier_id
                          LEFT JOIN users approver ON approver.id = ct.approved_by
                          WHERE ct.created_at >= ? AND ct.created_at < ?
                          ORDER BY ct.created_at DESC, ct.id DESC LIMIT 5000",
            ],
            'historical-debts' => [
                'title' => 'Historical Debt Report',
                'columns' => ['entered_at', 'guest', 'amount', 'applicable_from', 'applicable_to', 'status', 'entered_by', 'verified_by', 'supporting_reference'],
                'sql' => "SELECT ob.created_at AS entered_at, ga.full_name AS guest, ob.amount,
                                 ob.applicable_from, ob.applicable_to, ob.status,
                                 entrant.username AS entered_by, verifier.username AS verified_by,
                                 ob.supporting_reference
                          FROM opening_balances ob
                          JOIN guest_accounts ga ON ga.user_id = ob.guest_id
                          JOIN users entrant ON entrant.id = ob.entered_by
                          LEFT JOIN users verifier ON verifier.id = ob.verified_by
                          WHERE ob.created_at >= ? AND ob.created_at < ?
                          ORDER BY ob.created_at DESC, ob.id DESC LIMIT 5000",
            ],
        ];
        if (!isset($reports[$type])) {
            throw new ApiException(422, 'Report type must be payments, transactions, or historical-debts.');
        }
        $query = $this->pdo->prepare($reports[$type]['sql']);
        if ($type === 'payments') {
            $query->execute([$startLocalDate . ' 00:00:00', $endLocalDate . ' 00:00:00']);
        } else {
            $query->execute([$startUtc, $endUtc]);
        }
        $rows = $query->fetchAll();
        return [
            'title' => $reports[$type]['title'],
            'period' => $period,
            'from' => $startLocalDate,
            'to' => (new \DateTimeImmutable($endLocalDate))->modify('-1 day')->format('Y-m-d'),
            'generated_at_utc' => gmdate('c'),
            'columns' => $reports[$type]['columns'],
            'rows' => $rows,
            'totals' => $this->financialReportTotals(
                $type,
                $startLocalDate,
                $endLocalDate,
                $startUtc,
                $endUtc
            ),
        ];
    }

    private function financialReportTotals(
        string $type,
        string $startLocalDate,
        string $endLocalDate,
        string $startUtc,
        string $endUtc
    ): array {
        if ($type === 'payments') {
            $query = $this->pdo->prepare(
                "SELECT
                    COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS total_received,
                    COALESCE(SUM(CASE WHEN status = 'verified' AND method = 'cash' THEN amount ELSE 0 END), 0) AS cash,
                    COALESCE(SUM(CASE WHEN status = 'verified' AND method = 'bank_transfer' THEN amount ELSE 0 END), 0) AS bank_transfer
                 FROM payments WHERE payment_date >= ? AND payment_date < ?"
            );
            $query->execute([$startLocalDate . ' 00:00:00', $endLocalDate . ' 00:00:00']);
            $row = $query->fetch();
            return [
                ['label' => 'Total received', 'value' => $row['total_received']],
                ['label' => 'Cash', 'value' => $row['cash']],
                ['label' => 'Bank transfer', 'value' => $row['bank_transfer']],
            ];
        }

        if ($type === 'transactions') {
            $query = $this->pdo->prepare(
                "SELECT
                    COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) AS approved,
                    COALESCE(SUM(CASE WHEN status IN
                        ('pending_price_approval','pending_guest_confirmation','disputed',
                         'pending_finance_approval','pending_exceptional_approval')
                        THEN total_amount ELSE 0 END), 0) AS pending,
                    COALESCE(SUM(CASE WHEN status = 'rejected' THEN total_amount ELSE 0 END), 0) AS rejected
                 FROM credit_transactions WHERE created_at >= ? AND created_at < ?"
            );
            $query->execute([$startUtc, $endUtc]);
            $row = $query->fetch();
            return [
                ['label' => 'Approved', 'value' => $row['approved']],
                ['label' => 'Pending', 'value' => $row['pending']],
                ['label' => 'Rejected', 'value' => $row['rejected']],
            ];
        }

        $query = $this->pdo->prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'verified' THEN amount ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN status = 'pending_verification' THEN amount ELSE 0 END), 0) AS pending
             FROM opening_balances WHERE created_at >= ? AND created_at < ?"
        );
        $query->execute([$startUtc, $endUtc]);
        $row = $query->fetch();
        $reconciliation = $this->pdo->query(
            "SELECT
                (SELECT setting_value FROM system_settings
                 WHERE setting_key = 'historical_debt_expected_total')
                - COALESCE((SELECT SUM(amount) FROM opening_balances WHERE status = 'verified'), 0)"
        )->fetchColumn();
        return [
            ['label' => 'Approved opening balances', 'value' => $row['approved']],
            ['label' => 'Pending verification', 'value' => $row['pending']],
            ['label' => 'Unreconciled vs target', 'value' => $reconciliation],
        ];
    }

    private function periodBounds(string $period): array
    {
        $timezone = new \DateTimeZone(date_default_timezone_get());
        $today = new \DateTimeImmutable('today', $timezone);
        [$start, $end] = match ($period) {
            'daily' => [$today, $today->modify('+1 day')],
            'weekly' => [$today->modify('-6 days'), $today->modify('+1 day')],
            'monthly' => [
                $today->modify('first day of this month'),
                $today->modify('first day of next month'),
            ],
            'yearly' => [
                $today->setDate((int) $today->format('Y'), 1, 1),
                $today->setDate((int) $today->format('Y') + 1, 1, 1),
            ],
            default => throw new ApiException(422, 'period must be daily, weekly, monthly, or yearly.'),
        };
        $utc = new \DateTimeZone('UTC');
        return [
            $start->format('Y-m-d'),
            $end->format('Y-m-d'),
            $start->setTimezone($utc)->format('Y-m-d H:i:s'),
            $end->setTimezone($utc)->format('Y-m-d H:i:s'),
        ];
    }
}
