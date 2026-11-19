<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;

final class DashboardService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function forUser(array $user, ?string $view = null): array
    {
        if ($user['role'] === 'owner') {
            return match ($view) {
                null, 'finance' => $this->finance(),
                'cashier' => $this->cashier(null, (int) $user['id']),
                default => throw new ApiException(422, 'Unknown dashboard view.'),
            };
        }
        return match ($user['role']) {
            'system_administrator' => $this->administrator(),
            'cashier' => $this->cashier((int) $user['id']),
            'finance_manager' => $this->finance(),
            'guest' => $this->guest((int) $user['id']),
            default => throw new ApiException(403, 'No dashboard is available for this role.'),
        };
    }

    private function administrator(): array
    {
        $summary = $this->pdo->query(
            "SELECT
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COUNT(*) FROM guest_accounts) AS total_guests,
                (SELECT COUNT(*) FROM guest_accounts g JOIN users u ON u.id = g.user_id WHERE u.is_active = TRUE) AS active_guests,
                (SELECT COUNT(*) FROM users WHERE role = 'cashier') AS cashiers,
                (SELECT COUNT(*) FROM users WHERE role = 'finance_manager') AS finance_managers,
                (SELECT COUNT(*) FROM credit_transactions) AS total_transactions,
                (SELECT COUNT(*) FROM service_catalog) AS services"
        )->fetch();
        $summary['recent_activity'] = $this->pdo->query(
            'SELECT a.id, a.action, a.entity_type, a.created_at, u.username AS actor
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.created_at DESC LIMIT 20'
        )->fetchAll();
        $today = new \DateTimeImmutable(
            (string) $this->pdo->query('SELECT UTC_DATE()')->fetchColumn(),
            new \DateTimeZone('UTC')
        );
        $start = $today->modify('-13 days');
        $end = $today->modify('+1 day');
        $activityQuery = $this->pdo->prepare(
            'SELECT activity_date, SUM(transactions) AS transactions, SUM(logins) AS logins
             FROM (
                SELECT DATE(created_at) AS activity_date, COUNT(*) AS transactions, 0 AS logins
                FROM credit_transactions
                WHERE created_at >= ? AND created_at < ?
                GROUP BY DATE(created_at)
                UNION ALL
                SELECT DATE(created_at) AS activity_date, 0 AS transactions, COUNT(*) AS logins
                FROM audit_logs
                WHERE action = \'login\' AND created_at >= ? AND created_at < ?
                GROUP BY DATE(created_at)
             ) daily_activity
             GROUP BY activity_date'
        );
        $activityQuery->execute([
            $start->format('Y-m-d'),
            $end->format('Y-m-d'),
            $start->format('Y-m-d'),
            $end->format('Y-m-d'),
        ]);
        $activityByDate = [];
        foreach ($activityQuery->fetchAll() as $activity) {
            $activityByDate[$activity['activity_date']] = $activity;
        }
        $summary['activity'] = [];
        for ($offset = 0; $offset < 14; $offset++) {
            $day = $start->modify("+{$offset} days");
            $date = $day->format('Y-m-d');
            $activity = $activityByDate[$date] ?? [];
            $summary['activity'][] = [
                'label' => $day->format('M j'),
                'transactions' => (int) ($activity['transactions'] ?? 0),
                'logins' => (int) ($activity['logins'] ?? 0),
            ];
        }
        return ['dashboard' => $summary];
    }

    private function cashier(?int $cashierId, ?int $recordedById = null): array
    {
        $filter = $cashierId === null ? '' : ' WHERE cashier_id = ?';
        $query = $this->pdo->prepare(
            "SELECT COUNT(*) AS total_transactions,
                COALESCE(SUM(status = 'pending_guest_confirmation'), 0) AS pending_guest_confirmations,
                COALESCE(SUM(status = 'pending_price_approval'), 0) AS pending_price_approval,
                COALESCE(SUM(status IN ('pending_finance_approval','pending_exceptional_approval')), 0) AS awaiting_finance,
                COALESCE(SUM(status = 'pending_exceptional_approval'), 0) AS pending_exceptional_approvals,
                COALESCE(SUM(status = 'approved'), 0) AS approved,
                COALESCE(SUM(status = 'rejected'), 0) AS rejected,
                COALESCE(SUM(status = 'disputed'), 0) AS disputed,
                COALESCE(SUM(status = 'draft'), 0) AS drafts,
                COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
                COALESCE(SUM(status = 'expired'), 0) AS expired
             FROM credit_transactions" . $filter
        );
        $query->execute($cashierId === null ? [] : [$cashierId]);
        $summary = $query->fetch();
        if ($recordedById !== null) {
            $recorded = $this->pdo->prepare('SELECT COUNT(*) FROM credit_transactions WHERE cashier_id = ?');
            $recorded->execute([$recordedById]);
            $summary['recorded_by_me'] = (int) $recorded->fetchColumn();
        }
        $recent = $this->pdo->prepare(
            'SELECT ct.id, ct.consumption_date, ct.status, ct.total_amount, ct.created_at,
                    ga.user_id AS guest_id, ga.full_name AS guest_name
             FROM credit_transactions ct JOIN guest_accounts ga ON ga.user_id = ct.guest_id' .
                ($cashierId === null ? '' : ' WHERE ct.cashier_id = ?') .
                ' ORDER BY ct.created_at DESC LIMIT 20'
        );
        $recent->execute($cashierId === null ? [] : [$cashierId]);
        $summary['recent_transactions'] = $recent->fetchAll();
        return ['dashboard' => $summary];
    }

    private function finance(): array
    {
        $summary = (new ReportService($this->pdo))->financialSummary('daily');
        $summary['series'] = $this->creditPaymentsSeries();
        $summary['approved_transaction_count'] = $this->pdo->query(
            "SELECT COUNT(*) FROM credit_transactions WHERE status = 'approved'"
        )->fetchColumn();
        $summary['guests_over_limit_list'] = $this->pdo->query(
            "SELECT g.user_id AS guest_id, g.full_name, g.credit_limit,
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0) AS outstanding_debt
             FROM guest_accounts g
             WHERE
                COALESCE((SELECT SUM(ob.amount) FROM opening_balances ob
                    WHERE ob.guest_id = g.user_id AND ob.status = 'verified'), 0)
                + COALESCE((SELECT SUM(ct.total_amount) FROM credit_transactions ct
                    WHERE ct.guest_id = g.user_id AND ct.status = 'approved'), 0)
                - COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.guest_id = g.user_id AND p.status = 'verified'), 0)
                + COALESCE((SELECT SUM(fa.amount) FROM financial_adjustments fa
                    WHERE fa.guest_id = g.user_id), 0) > g.credit_limit
             ORDER BY outstanding_debt DESC LIMIT 100"
        )->fetchAll();
        return ['dashboard' => $summary];
    }

    private function creditPaymentsSeries(): array
    {
        $timezone = new \DateTimeZone(date_default_timezone_get());
        $currentMonth = (new \DateTimeImmutable('first day of this month', $timezone))->setTime(0, 0);
        $start = $currentMonth->modify('-5 months');
        $end = $currentMonth->modify('+1 month');
        $utc = new \DateTimeZone('UTC');
        $query = $this->pdo->prepare(
            "SELECT month, SUM(credit) AS credit, SUM(payments) AS payments
             FROM (
                SELECT DATE_FORMAT(approved_at, '%Y-%m') AS month,
                       SUM(total_amount) AS credit, 0 AS payments
                FROM credit_transactions
                WHERE status = 'approved' AND approved_at >= ? AND approved_at < ?
                GROUP BY DATE_FORMAT(approved_at, '%Y-%m')
                UNION ALL
                SELECT DATE_FORMAT(payment_date, '%Y-%m') AS month,
                       0 AS credit, SUM(amount) AS payments
                FROM payments
                WHERE status = 'verified' AND payment_date >= ? AND payment_date < ?
                GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
             ) monthly_activity
             GROUP BY month"
        );
        $query->execute([
            $start->setTimezone($utc)->format('Y-m-d H:i:s'),
            $end->setTimezone($utc)->format('Y-m-d H:i:s'),
            $start->format('Y-m-d'),
            $end->format('Y-m-d'),
        ]);
        $totals = [];
        foreach ($query->fetchAll() as $row) {
            $totals[$row['month']] = $row;
        }

        $series = [];
        for ($offset = 0; $offset < 6; $offset++) {
            $month = $start->modify("+{$offset} months");
            $totalsForMonth = $totals[$month->format('Y-m')] ?? [];
            $series[] = [
                'label' => $month->format('M'),
                'credit' => $totalsForMonth['credit'] ?? 0,
                'payments' => $totalsForMonth['payments'] ?? 0,
            ];
        }
        return $series;
    }

    private function guest(int $guestId): array
    {
        $summary = (new CreditAccountService($this->pdo))->summary($guestId);
        $payments = $this->pdo->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM payments
             WHERE guest_id = ? AND status = 'verified'"
        );
        $payments->execute([$guestId]);
        $summary['total_payments'] = (string) $payments->fetchColumn();
        $pending = $this->pdo->prepare(
            "SELECT COUNT(*) FROM credit_transactions
             WHERE guest_id = ? AND status = 'pending_guest_confirmation'"
        );
        $pending->execute([$guestId]);
        $summary['pending_transactions'] = (int) $pending->fetchColumn();
        $transactions = $this->pdo->prepare(
            'SELECT id, consumption_date, status, total_amount, created_at
             FROM credit_transactions WHERE guest_id = ?
             ORDER BY created_at DESC LIMIT 20'
        );
        $transactions->execute([$guestId]);
        $summary['recent_transactions'] = $transactions->fetchAll();
        $recentPayments = $this->pdo->prepare(
            "SELECT id, amount, method, payment_date, receipt_number, remaining_balance
             FROM payments WHERE guest_id = ? AND status = 'verified'
             ORDER BY payment_date DESC LIMIT 10"
        );
        $recentPayments->execute([$guestId]);
        $summary['recent_payments'] = $recentPayments->fetchAll();
        return ['dashboard' => $summary];
    }
}
