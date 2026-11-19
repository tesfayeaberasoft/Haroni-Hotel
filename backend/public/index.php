<?php
declare(strict_types=1);

use Haroni\Dcms\ApiException;
use Haroni\Dcms\AuthService;
use Haroni\Dcms\AuditLogger;
use Haroni\Dcms\CreditAccountService;
use Haroni\Dcms\CreditTransactionService;
use Haroni\Dcms\DashboardService;
use Haroni\Dcms\DatabaseMaintenance;
use Haroni\Dcms\FinancialAdjustmentService;
use Haroni\Dcms\GuestStatementPdf;
use Haroni\Dcms\Http;
use Haroni\Dcms\HistoricalDebtService;
use Haroni\Dcms\Money;
use Haroni\Dcms\NotificationService;
use Haroni\Dcms\PaymentService;
use Haroni\Dcms\ReceiptPdf;
use Haroni\Dcms\ReportService;
use Haroni\Dcms\ReportPdf;
use Haroni\Dcms\ServiceCatalogService;
use Haroni\Dcms\SpreadsheetXml;
use Haroni\Dcms\SystemSettingsService;
use Haroni\Dcms\UserManagementService;

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

ini_set('display_errors', '0');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Content-Security-Policy: default-src \'none\'; frame-ancestors \'none\'');

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (!is_string($path)) {
        throw new ApiException(400, 'Invalid request path.');
    }
    $path = rtrim($path, '/') ?: '/';
    if ($method === 'GET' && $path === '/api/health') {
        dcms_db()->query('SELECT 1');
        Http::respond(['status' => 'ok']);
    }

    $pdo = dcms_db();
    $auth = new AuthService($pdo);
    $transactions = new CreditTransactionService($pdo);

    if ($method === 'POST' && $path === '/api/login') {
        $body = Http::json();
        $user = $auth->login(
            Http::text($body['username'] ?? null, 'username', 80),
            Http::secret($body['password'] ?? null, 'password', 72)
        );
        Http::respond(['user' => $user]);
    }

    if ($method === 'POST' && $path === '/api/logout') {
        Http::csrf();
        $user = $auth->currentUser();
        $auth->logout($user['id'] ?? null);
        Http::respond(['message' => 'Logged out.']);
    }

    $user = $auth->currentUser();
    if ($user === null) {
        throw new ApiException(401, 'Authentication is required.');
    }
    if ($method !== 'GET' && $method !== 'HEAD') {
        Http::csrf();
    }
    if ($user['must_change_password']
        && !in_array($path, ['/api/profile/password', '/api/logout'], true)) {
        throw new ApiException(403, 'Change your temporary password before using the system.');
    }

    if ($method === 'GET' && $path === '/api/me') {
        Http::respond(['user' => $user, 'csrf_token' => $_SESSION['csrf_token'] ?? null]);
    }
    if ($method === 'GET' && $path === '/api/dashboard') {
        Http::respond((new DashboardService($pdo))->forUser($user));
    }
    if ($method === 'GET' && $path === '/api/notifications') {
        Http::respond(['notifications' => (new NotificationService($pdo))->listFor((int) $user['id'])]);
    }
    if ($method === 'GET' && $path === '/api/backups') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $createdQuery = $pdo->query(
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(a.details, '$.filename')) AS filename,
                    a.created_at, u.full_name AS created_by
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.action = 'database_backup_created'
               AND a.entity_type = 'database_backup'
             ORDER BY a.created_at DESC LIMIT 500"
        );
        $createdByFilename = [];
        foreach ($createdQuery->fetchAll() as $row) {
            if (is_string($row['filename']) && !isset($createdByFilename[$row['filename']])) {
                $createdByFilename[$row['filename']] = [
                    'created_at' => $row['created_at'],
                    'created_by' => $row['created_by'] ?? 'System',
                ];
            }
        }
        $backups = array_map(static function (array $backup) use ($createdByFilename): array {
            $metadata = $createdByFilename[$backup['filename']] ?? null;
            return [
                'id' => $backup['filename'],
                'filename' => $backup['filename'],
                'created_at' => $metadata['created_at'] ?? $backup['created_at'],
                'created_by' => $metadata['created_by'] ?? 'Server',
                'size_bytes' => $backup['size_bytes'],
            ];
        }, DatabaseMaintenance::listBackups());
        Http::respond(['backups' => $backups]);
    }
    if ($method === 'POST' && $path === '/api/backups') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        set_time_limit(0);
        $backup = DatabaseMaintenance::backup();
        AuditLogger::record($pdo, (int) $user['id'], 'database_backup_created', 'database_backup', null, [
            'filename' => $backup['filename'],
            'size_bytes' => $backup['bytes'],
            'sha256' => $backup['sha256'],
        ]);
        Http::respond([
            'backup' => [
                'id' => $backup['filename'],
                'filename' => $backup['filename'],
                'created_at' => gmdate(DATE_ATOM),
                'created_by' => $user['full_name'],
                'size_bytes' => $backup['bytes'],
            ],
        ], 201);
    }
    if (preg_match('#^/api/backups/(haroni-dcms-\d{8}-\d{6}-[a-f0-9]{8}\.sql)$#D', $path, $match) === 1
        && $method === 'GET') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $filename = $match[1];
        $backupPath = DatabaseMaintenance::backupPath($filename);
        $stream = fopen($backupPath, 'rb');
        if ($stream === false) {
            throw new \RuntimeException('Could not open the requested backup file.');
        }
        $size = filesize($backupPath);
        if ($size === false) {
            fclose($stream);
            throw new \RuntimeException('Could not determine the requested backup file size.');
        }
        AuditLogger::record($pdo, (int) $user['id'], 'database_backup_downloaded', 'database_backup', null, [
            'filename' => $filename,
        ]);
        header('Content-Type: application/sql; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . $size);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        fpassthru($stream);
        fclose($stream);
        exit;
    }
    if (preg_match('#^/api/notifications/(\d+)/read$#D', $path, $match) === 1 && $method === 'POST') {
        (new NotificationService($pdo))->markRead(Http::positiveId($match[1]), (int) $user['id']);
        Http::respond(['message' => 'Notification marked as read.']);
    }
    if ($method === 'DELETE' && $path === '/api/notifications') {
        (new NotificationService($pdo))->deleteAllFor((int) $user['id']);
        Http::respond(['ok' => true]);
    }
    if (preg_match('#^/api/notifications/(\d+)$#D', $path, $match) === 1 && $method === 'DELETE') {
        (new NotificationService($pdo))->deleteFor(Http::positiveId($match[1]), (int) $user['id']);
        Http::respond(['ok' => true]);
    }
    if ($method === 'POST' && $path === '/api/notifications/clear') {
        (new NotificationService($pdo))->deleteAllFor((int) $user['id']);
        Http::respond(['ok' => true]);
    }
    if (preg_match('#^/api/notifications/(\d+)/delete$#D', $path, $match) === 1 && $method === 'POST') {
        (new NotificationService($pdo))->deleteFor(Http::positiveId($match[1]), (int) $user['id']);
        Http::respond(['ok' => true]);
    }
    if ($method === 'POST' && $path === '/api/profile/password') {
        $body = Http::json();
        $auth->changePassword(
            (int) $user['id'],
            Http::secret($body['current_password'] ?? null, 'current_password', 72),
            Http::secret($body['new_password'] ?? null, 'new_password', 72)
        );
        Http::respond(['message' => 'Password changed.', 'csrf_token' => $_SESSION['csrf_token']]);
    }

    if ($method === 'GET' && $path === '/api/service-catalog') {
        Http::respond(['services' => (new ServiceCatalogService($pdo))->list(
            in_array($user['role'], ['system_administrator', 'finance_manager'], true)
        )]);
    }
    if ($method === 'GET' && $path === '/api/service-categories') {
        AuthService::requireRole($user, 'system_administrator', 'cashier', 'finance_manager');
        Http::respond([
            'categories' => (new ServiceCatalogService($pdo))->categories(
                in_array($user['role'], ['system_administrator', 'finance_manager'], true)
            ),
        ]);
    }
    if ($method === 'GET' && $path === '/api/guests') {
        AuthService::requireRole($user, 'cashier', 'finance_manager');
        $term = Http::text($_GET['q'] ?? '', 'q', 100, true);
        $search = $pdo->prepare(
            'SELECT ga.user_id, ga.full_name, u.phone, u.username, u.is_active, u.created_at
             FROM guest_accounts ga JOIN users u ON u.id = ga.user_id
             WHERE ga.full_name LIKE ? OR u.phone LIKE ? OR u.username LIKE ?
             ORDER BY ga.full_name LIMIT 50'
        );
        $search->execute(['%' . $term . '%', '%' . $term . '%', '%' . $term . '%']);
        $guests = [];
        foreach ($search->fetchAll() as $guest) {
            $identity = [
                'guest_id' => (int) $guest['user_id'],
                'full_name' => $guest['full_name'],
                'phone' => $guest['phone'],
                'username' => $guest['username'],
                'is_active' => (bool) $guest['is_active'],
                'created_at' => $guest['created_at'],
            ];
            $guests[] = $user['role'] === 'cashier'
                ? $identity
                : array_merge($identity, (new CreditAccountService($pdo))->summary((int) $guest['user_id']));
        }
        Http::respond(['guests' => $guests]);
    }

    if ($method === 'POST' && $path === '/api/users') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $id = (new UserManagementService($pdo))->create((int) $user['id'], Http::json());
        Http::respond(['id' => $id], 201);
    }
    if ($method === 'GET' && $path === '/api/users') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        Http::respond(['users' => (new UserManagementService($pdo))->list()]);
    }
    if (preg_match('#^/api/users/(\d+)/profile$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        if ($user['role'] === 'finance_manager'
            && (($body['role'] ?? null) === 'system_administrator')) {
            throw new ApiException(403, 'Finance Managers cannot assign the System Administrator role.');
        }
        if ($user['role'] === 'finance_manager') {
            $targetId = Http::positiveId($match[1]);
            $targetRole = $pdo->prepare('SELECT role FROM users WHERE id = ?');
            $targetRole->execute([$targetId]);
            $role = $targetRole->fetchColumn();
            if ($role === 'system_administrator') {
                throw new ApiException(403, 'Finance Managers cannot manage System Administrator accounts.');
            }
        }
        (new UserManagementService($pdo))->updateProfile(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $body
        );
        Http::respond(['message' => 'User profile updated.']);
    }
    if (preg_match('#^/api/users/(\d+)/status$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        if (!is_bool($body['active'] ?? null)) {
            throw new ApiException(422, 'active must be a boolean.');
        }
        if ($user['role'] === 'finance_manager') {
            $targetId = Http::positiveId($match[1]);
            $targetRole = $pdo->prepare('SELECT role FROM users WHERE id = ?');
            $targetRole->execute([$targetId]);
            if ($targetRole->fetchColumn() === 'system_administrator') {
                throw new ApiException(403, 'Finance Managers cannot manage System Administrator accounts.');
            }
        }
        (new UserManagementService($pdo))->setActive(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $body['active']
        );
        Http::respond(['message' => 'Account status updated.']);
    }
    if (preg_match('#^/api/users/(\d+)/password$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        if ($user['role'] === 'finance_manager') {
            $targetId = Http::positiveId($match[1]);
            $targetRole = $pdo->prepare('SELECT role FROM users WHERE id = ?');
            $targetRole->execute([$targetId]);
            if ($targetRole->fetchColumn() === 'system_administrator') {
                throw new ApiException(403, 'Finance Managers cannot manage System Administrator accounts.');
            }
        }
        $temporaryPassword = (new UserManagementService($pdo))->resetPassword(
            Http::positiveId($match[1]),
            (int) $user['id']
        );
        Http::respond(['temporary_password' => $temporaryPassword]);
    }
    if ($method === 'POST' && $path === '/api/profile/confirmation-pin') {
        AuthService::requireRole($user, 'guest');
        $body = Http::json();
        (new UserManagementService($pdo))->setOwnGuestPin(
            (int) $user['id'],
            Http::text($body['pin'] ?? null, 'pin', 12),
            Http::secret($body['current_password'] ?? null, 'current_password', 72)
        );
        Http::respond(['message' => 'In-person confirmation PIN updated.']);
    }

    if ($method === 'POST' && $path === '/api/service-categories') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        $id = (new ServiceCatalogService($pdo))->createCategory(
            Http::text($body['name'] ?? null, 'name', 100),
            (int) $user['id']
        );
        Http::respond(['id' => $id], 201);
    }
    if (preg_match('#^/api/service-categories/(\d+)$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        (new ServiceCatalogService($pdo))->updateCategory(
            Http::positiveId($match[1]),
            Http::json(),
            (int) $user['id']
        );
        Http::respond(['message' => 'Service category updated.']);
    }
    if ($method === 'POST' && $path === '/api/service-catalog') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        $created = (new ServiceCatalogService($pdo))->createService(
            Http::idValue($body['category_id'] ?? null, 'category_id'),
            Http::text($body['name'] ?? null, 'name', 160),
            Http::money($body['price'] ?? null, 'price'),
            (int) $user['id'],
            $user['role'] === 'finance_manager'
        );
        Http::respond([
            'id' => $created['id'],
            'price_request_id' => $created['price_request_id'],
            'status' => $created['price_request_id'] === null ? 'active' : 'pending_finance_approval',
        ], 201);
    }
    if (preg_match('#^/api/service-catalog/(\d+)/status$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        if (!is_bool($body['active'] ?? null)) {
            throw new ApiException(422, 'active must be a boolean.');
        }
        (new ServiceCatalogService($pdo))->setAvailability(
            Http::positiveId($match[1]),
            $body['active'],
            (int) $user['id'],
            $user['role'] === 'finance_manager'
        );
        Http::respond(['message' => 'Service availability updated.']);
    }
    if (preg_match('#^/api/service-catalog/(\d+)/profile$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        (new ServiceCatalogService($pdo))->updateService(
            Http::positiveId($match[1]),
            Http::json(),
            (int) $user['id']
        );
        Http::respond(['message' => 'Service details updated.']);
    }
    if (preg_match('#^/api/service-catalog/(\d+)/price-history$#D', $path, $match) === 1 && $method === 'GET') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        Http::respond([
            'price_history' => (new ServiceCatalogService($pdo))->priceHistory(Http::positiveId($match[1])),
        ]);
    }
    if ($method === 'POST' && preg_match('#^/api/service-catalog/(\d+)/price-requests$#D', $path, $match) === 1) {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        $id = (new ServiceCatalogService($pdo))->requestPriceChange(
            Http::positiveId($match[1]),
            Http::money($body['proposed_price'] ?? null, 'proposed_price'),
            Http::text($body['reason'] ?? null, 'reason', 1000),
            (int) $user['id']
        );
        Http::respond(['id' => $id, 'status' => 'pending'], 201);
    }
    if ($method === 'GET' && $path === '/api/service-price-requests') {
        AuthService::requireRole($user, 'finance_manager');
        Http::respond(['requests' => (new ServiceCatalogService($pdo))->pendingPriceChanges()]);
    }
    if (preg_match('#^/api/service-price-requests/(\d+)/(approve|reject)$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $reason = isset($body['reason']) ? Http::text($body['reason'], 'reason', 1000) : '';
        (new ServiceCatalogService($pdo))->reviewPriceChange(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $match[2] === 'approve',
            $reason
        );
        Http::respond(['message' => $match[2] === 'approve' ? 'Price change request approved.' : 'Price change request rejected.']);
    }
    if (preg_match('#^/api/transaction-price-requests/(\d+)/(approve|reject)$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $reason = isset($body['reason']) ? Http::text($body['reason'], 'reason', 1000, true) : '';
        $transactions->reviewPriceRequest(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $match[2] === 'approve',
            $reason
        );
        Http::respond(['message' => $match[2] === 'approve' ? 'Special price request approved.' : 'Special price request rejected.']);
    }

    if ($method === 'GET' && $path === '/api/credit-account') {
        if ($user['role'] !== 'guest') {
            throw new ApiException(422, 'Provide a guest account identifier.');
        }
        Http::respond((new CreditAccountService($pdo))->summary((int) $user['id']));
    }
    if (preg_match('#^/api/credit-account/(\d+)$#D', $path, $match) === 1 && $method === 'GET') {
        AuthService::requireRole($user, 'finance_manager');
        Http::respond((new CreditAccountService($pdo))->summary(Http::positiveId($match[1])));
    }
    if (preg_match('#^/api/guests/(\d+)/credit-limit$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        (new CreditAccountService($pdo))->setCreditLimit(
            Http::positiveId($match[1]),
            Http::money($body['credit_limit'] ?? null, 'credit_limit'),
            (int) $user['id']
        );
        Http::respond(['message' => 'Credit limit updated.']);
    }

    if ($method === 'GET' && $path === '/api/transactions') {
        $status = isset($_GET['status']) ? Http::text($_GET['status'], 'status', 40) : null;
        $transactions->expirePending();
        (new NotificationService($pdo))->reminders();
        Http::respond(['transactions' => $transactions->listFor($user, $status)]);
    }
    if ($method === 'POST' && $path === '/api/transactions') {
        AuthService::requireRole($user, 'cashier');
        $body = Http::json();
        $id = $transactions->createDraft(
            Http::idValue($body['guest_id'] ?? null, 'guest_id'),
            (int) $user['id'],
            Http::text($body['consumption_date'] ?? null, 'consumption_date', 10),
            is_array($body['items'] ?? null) ? $body['items'] : []
        );
        Http::respond(['id' => $id, 'status' => 'draft'], 201);
    }
    if (preg_match('#^/api/transactions/(\d+)$#D', $path, $match) === 1 && $method === 'GET') {
        Http::respond(['transaction' => $transactions->details(Http::positiveId($match[1]), $user)]);
    }
    if (preg_match('#^/api/transactions/(\d+)/submit$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'cashier');
        Http::respond($transactions->submit(Http::positiveId($match[1]), (int) $user['id']));
    }
    if (preg_match('#^/api/transactions/(\d+)/draft$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'cashier');
        $body = Http::json();
        Http::respond($transactions->updateDraft(
            Http::positiveId($match[1]),
            (int) $user['id'],
            is_array($body['items'] ?? null) ? $body['items'] : [],
            Http::text($body['consumption_date'] ?? null, 'consumption_date', 10)
        ));
    }
    if (preg_match('#^/api/transactions/(\d+)/confirm$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'guest');
        Http::respond($transactions->confirmByGuest(Http::positiveId($match[1]), (int) $user['id']));
    }
    if (preg_match('#^/api/transactions/(\d+)/dispute$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'guest');
        $body = Http::json();
        $transactions->dispute(
            Http::positiveId($match[1]),
            (int) $user['id'],
            Http::text($body['reason'] ?? null, 'reason', 2000)
        );
        Http::respond(['message' => 'Transaction disputed and returned to the Cashier.']);
    }
    if (preg_match('#^/api/transactions/(\d+)/resubmit$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'cashier');
        $body = Http::json();
        $date = isset($body['consumption_date'])
            ? Http::text($body['consumption_date'], 'consumption_date', 10)
            : null;
        Http::respond($transactions->correctAndResubmit(
            Http::positiveId($match[1]),
            (int) $user['id'],
            is_array($body['items'] ?? null) ? $body['items'] : [],
            $date,
            isset($body['note']) ? Http::text($body['note'], 'note', 2000, true) : ''
        ));
    }
    if ($method === 'POST' && $path === '/api/transactions/confirm-in-person') {
        AuthService::requireRole($user, 'cashier');
        $body = Http::json();
        Http::respond($transactions->confirmInPerson(
            Http::idValue($body['transaction_id'] ?? null, 'transaction_id'),
            Http::idValue($body['guest_id'] ?? null, 'guest_id'),
            (int) $user['id'],
            Http::text($body['pin'] ?? null, 'pin', 12)
        ));
    }
    if (preg_match('#^/api/transactions/(\d+)/approve$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $reason = isset($body['exception_reason'])
            ? Http::text($body['exception_reason'], 'exception_reason', 2000)
            : null;
        Http::respond($transactions->approve(Http::positiveId($match[1]), (int) $user['id'], $reason));
    }
    if (preg_match('#^/api/transactions/(\d+)/reject$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $transactions->reject(
            Http::positiveId($match[1]),
            (int) $user['id'],
            Http::text($body['reason'] ?? null, 'reason', 2000)
        );
        Http::respond(['message' => 'Transaction rejected.']);
    }
    if (preg_match('#^/api/transactions/(\d+)/cancel$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'cashier', 'finance_manager');
        $body = Http::json();
        $transactions->cancel(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $user['role'],
            Http::text($body['reason'] ?? null, 'reason', 2000)
        );
        Http::respond(['message' => 'Transaction cancelled.']);
    }

    if ($method === 'GET' && $path === '/api/payments') {
        Http::respond(['payments' => (new PaymentService($pdo))->listFor($user)]);
    }
    if ($method === 'POST' && $path === '/api/payments') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $id = (new PaymentService($pdo))->record(
            Http::idValue($body['guest_id'] ?? null, 'guest_id'),
            Http::money($body['amount'] ?? null, 'amount'),
            Http::text($body['method'] ?? null, 'method', 20),
            isset($body['reference_number']) ? Http::text($body['reference_number'], 'reference_number', 160) : null,
            Http::text($body['payment_date'] ?? null, 'payment_date', 10),
            (int) $user['id']
        );
        Http::respond(['id' => $id, 'status' => 'pending_verification'], 201);
    }
    if (preg_match('#^/api/payments/(\d+)/verify$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $reason = isset($body['reason'])
            ? Http::text($body['reason'], 'reason', 1000)
            : 'Funds received and verified';
        Http::respond((new PaymentService($pdo))->verify(
            Http::positiveId($match[1]),
            (int) $user['id'],
            $reason
        ));
    }
    if (preg_match('#^/api/payments/(\d+)/reject$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        (new PaymentService($pdo))->reject(
            Http::positiveId($match[1]),
            (int) $user['id'],
            Http::text($body['reason'] ?? null, 'reason', 1000)
        );
        Http::respond(['message' => 'Payment rejected.']);
    }
    if (preg_match('#^/api/payments/(\d+)/receipt$#D', $path, $match) === 1 && $method === 'GET') {
        $payment = (new PaymentService($pdo))->receiptData(Http::positiveId($match[1]), $user);
        $pdf = ReceiptPdf::render($payment);
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '', $payment['receipt_number']) . '.pdf"');
        header('Content-Length: ' . strlen($pdf));
        header('Cache-Control: private, no-store');
        echo $pdf;
        exit;
    }

    if ($method === 'POST' && $path === '/api/historical-debts') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $id = (new HistoricalDebtService($pdo))->enter(
            Http::idValue($body['guest_id'] ?? null, 'guest_id'),
            Http::money($body['amount'] ?? null, 'amount'),
            Http::text($body['applicable_from'] ?? null, 'applicable_from', 10),
            isset($body['applicable_to']) ? Http::text($body['applicable_to'], 'applicable_to', 10) : null,
            Http::text($body['supporting_reference'] ?? null, 'supporting_reference', 1000),
            (int) $user['id']
        );
        Http::respond(['id' => $id, 'status' => 'pending_verification'], 201);
    }
    if ($method === 'POST' && $path === '/api/historical-debts/import') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        if (!is_array($body['records'] ?? null)) {
            throw new ApiException(422, 'records must be an array.');
        }
        $ids = (new HistoricalDebtService($pdo))->enterBatch($body['records'], (int) $user['id']);
        Http::respond(['ids' => $ids, 'count' => count($ids), 'status' => 'pending_verification'], 201);
    }
    if ($method === 'GET' && $path === '/api/historical-debts') {
        AuthService::requireRole($user, 'finance_manager');
        Http::respond(['opening_balances' => (new HistoricalDebtService($pdo))->listAll()]);
    }
    if (preg_match('#^/api/historical-debts/(\d+)/(verify|reject)$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $reason = Http::text($body['reason'] ?? null, 'reason', 1000);
        $service = new HistoricalDebtService($pdo);
        if ($match[2] === 'verify') {
            $service->verify(Http::positiveId($match[1]), (int) $user['id'], $reason);
        } else {
            $service->reject(Http::positiveId($match[1]), (int) $user['id'], $reason);
        }
        Http::respond(['message' => $match[2] === 'verify' ? 'Historical debt verified.' : 'Historical debt rejected.']);
    }
    if ($method === 'GET' && $path === '/api/historical-debts/reconciliation') {
        AuthService::requireRole($user, 'finance_manager');
        Http::respond((new HistoricalDebtService($pdo))->reconciliation());
    }

    if ($method === 'POST' && $path === '/api/financial-adjustments') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $id = (new FinancialAdjustmentService($pdo))->create(
            Http::idValue($body['guest_id'] ?? null, 'guest_id'),
            Http::signedMoney($body['amount'] ?? null, 'amount'),
            Http::text($body['reason'] ?? null, 'reason', 2000),
            (int) $user['id']
        );
        Http::respond(['id' => $id], 201);
    }
    if (preg_match('#^/api/financial-adjustments/(\d+)/reverse$#D', $path, $match) === 1 && $method === 'POST') {
        AuthService::requireRole($user, 'finance_manager');
        $body = Http::json();
        $id = (new FinancialAdjustmentService($pdo))->reverse(
            Http::positiveId($match[1]),
            Http::text($body['reason'] ?? null, 'reason', 2000),
            (int) $user['id']
        );
        Http::respond(['id' => $id, 'reversal_of' => Http::positiveId($match[1])], 201);
    }

    if ($method === 'GET' && $path === '/api/reports/financial-summary') {
        AuthService::requireRole($user, 'finance_manager');
        $period = Http::text($_GET['period'] ?? 'daily', 'period', 10);
        Http::respond((new ReportService($pdo))->financialSummary($period));
    }
    if ($method === 'GET' && $path === '/api/reports/financial-summary.xls') {
        AuthService::requireRole($user, 'finance_manager');
        $period = Http::text($_GET['period'] ?? 'daily', 'period', 10);
        $summary = (new ReportService($pdo))->financialSummary($period);
        $hotelName = (new SystemSettingsService($pdo))->list()['hotel_name'];
        $rows = [[$hotelName . ' Financial Summary', 'Value'], ['Period', $period]];
        foreach ($summary as $key => $value) {
            if (!in_array($key, ['period', 'from', 'to', 'generated_at_utc'], true)) {
                $rows[] = [(string) $key, is_scalar($value) ? (string) $value : ''];
            }
        }
        $output = SpreadsheetXml::render($rows);
        header('Content-Type: application/vnd.ms-excel; charset=utf-8');
        header('Content-Disposition: attachment; filename="financial-summary-' . $period . '.xls"');
        header('Content-Length: ' . strlen($output));
        header('Cache-Control: private, no-store');
        echo $output;
        exit;
    }
    if ($method === 'GET' && $path === '/api/reports/financial-summary.pdf') {
        AuthService::requireRole($user, 'finance_manager');
        $period = Http::text($_GET['period'] ?? 'daily', 'period', 10);
        $summary = (new ReportService($pdo))->financialSummary($period);
        $rows = [];
        foreach ($summary as $key => $value) {
            if (!in_array($key, ['period', 'from', 'to', 'generated_at_utc'], true)) {
                $rows[] = ['metric' => (string) $key, 'value' => is_scalar($value) ? (string) $value : ''];
            }
        }
        $hotelName = (new SystemSettingsService($pdo))->list()['hotel_name'];
        $pdf = ReportPdf::render('Financial Summary', ['metric', 'value'], $rows, $period, $hotelName);
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="financial-summary-' . $period . '.pdf"');
        header('Content-Length: ' . strlen($pdf));
        header('Cache-Control: private, no-store');
        echo $pdf;
        exit;
    }
    if (preg_match('#^/api/reports/(payments|transactions|historical-debts|guest-debts)(\.xls|\.pdf)?$#D', $path, $match) === 1
        && $method === 'GET') {
        AuthService::requireRole($user, 'finance_manager');
        $period = Http::text($_GET['period'] ?? 'daily', 'period', 10);
        $report = (new ReportService($pdo))->financialReport($match[1], $period);
        if (($match[2] ?? '') === '.pdf') {
            $hotelName = (new SystemSettingsService($pdo))->list()['hotel_name'];
            $pdf = ReportPdf::render($report['title'], $report['columns'], $report['rows'], $period, $hotelName);
            header('Content-Type: application/pdf');
            header('Content-Disposition: attachment; filename="' . $match[1] . '-' . $period . '.pdf"');
            header('Content-Length: ' . strlen($pdf));
            header('Cache-Control: private, no-store');
            echo $pdf;
            exit;
        }
        if (($match[2] ?? '') === '.xls') {
            $rows = [$report['columns']];
            foreach ($report['rows'] as $record) {
                $rows[] = array_map(
                    static fn(string $column): string => (string) ($record[$column] ?? ''),
                    $report['columns']
                );
            }
            $output = SpreadsheetXml::render($rows);
            header('Content-Type: application/vnd.ms-excel; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $match[1] . '-' . $period . '.xls"');
            header('Content-Length: ' . strlen($output));
            header('Cache-Control: private, no-store');
            echo $output;
            exit;
        }
        Http::respond($report);
    }
    if (preg_match('#^/api/guests/(\d+)/statement$#D', $path, $match) === 1 && $method === 'GET') {
        $guestId = Http::positiveId($match[1]);
        if ($user['role'] === 'guest' && (int) $user['id'] !== $guestId) {
            throw new ApiException(404, 'Guest statement not found.');
        }
        AuthService::requireRole($user, 'guest', 'finance_manager');
        Http::respond((new ReportService($pdo))->guestStatement($guestId));
    }
    if (preg_match('#^/api/guests/(\d+)/statement\.pdf$#D', $path, $match) === 1 && $method === 'GET') {
        $guestId = Http::positiveId($match[1]);
        if ($user['role'] === 'guest' && (int) $user['id'] !== $guestId) {
            throw new ApiException(404, 'Guest statement not found.');
        }
        AuthService::requireRole($user, 'guest', 'finance_manager');
        $statement = (new ReportService($pdo))->guestStatement($guestId);
        $pdf = GuestStatementPdf::render($statement, (new SystemSettingsService($pdo))->list());
        $username = strtolower((string) ($statement['account']['username'] ?? ''));
        $username = trim(preg_replace('/[^a-z0-9._-]+/', '-', $username) ?? '', '.-_');
        if ($username === '') {
            $username = 'guest-' . $guestId;
        }
        $filename = 'Statement-' . $username . '-' . date('Y-m-d') . '.pdf';
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($pdf));
        header('Cache-Control: private, no-store');
        echo $pdf;
        exit;
    }
    if (preg_match('#^/api/guests/(\d+)/statement\.xls$#D', $path, $match) === 1 && $method === 'GET') {
        $guestId = Http::positiveId($match[1]);
        if ($user['role'] === 'guest' && (int) $user['id'] !== $guestId) {
            throw new ApiException(404, 'Guest statement not found.');
        }
        AuthService::requireRole($user, 'guest', 'finance_manager');
        $statement = (new ReportService($pdo))->guestStatement($guestId);
        $hotelName = (new SystemSettingsService($pdo))->list()['hotel_name'];
        $rows = [
            [$hotelName . ' Guest Debt Statement'],
            ['Guest', $statement['account']['full_name']],
            ['Credit limit (ETB)', $statement['account']['credit_limit']],
            ['Outstanding debt (ETB)', $statement['account']['outstanding_debt']],
            ['Available credit (ETB)', $statement['account']['available_credit']],
            [],
            ['Date', 'Entry type', 'Amount (ETB)', 'Description'],
        ];
        foreach ($statement['ledger'] as $entry) {
            $rows[] = [$entry['entry_date'], $entry['entry_type'], $entry['amount'], $entry['description']];
        }
        $filename = 'guest-statement-' . $guestId . '.xls';
        $output = SpreadsheetXml::render($rows);
        header('Content-Type: application/vnd.ms-excel; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($output));
        header('Cache-Control: private, no-store');
        echo $output;
        exit;
    }

    if ($method === 'GET' && $path === '/api/audit-logs') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $financialMask = $user['role'] === 'system_administrator'
            ? "CASE WHEN a.entity_type IN ('credit_transaction','payment','opening_balance','financial_adjustment','guest_account')
                    THEN NULL ELSE a.entity_id END"
            : 'a.entity_id';
        $detailsMask = $user['role'] === 'system_administrator'
            ? "CASE WHEN a.entity_type IN ('credit_transaction','payment','opening_balance','financial_adjustment','guest_account')
                    THEN NULL ELSE a.details END"
            : 'a.details';
        $query = $pdo->query(
            'SELECT a.id, a.actor_id, u.username AS actor, a.action, a.entity_type,
                    ' . $financialMask . ' AS entity_id, ' . $detailsMask . ' AS details, a.created_at
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.created_at DESC LIMIT 500'
        );
        Http::respond(['audit_logs' => $query->fetchAll()]);
    }
    if ($method === 'POST' && $path === '/api/system-settings') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        Http::requireFields($body, [
            'hotel_name',
            'hotel_address',
            'hotel_phone',
            'hotel_email',
            'hotel_tin',
            'confirmation_deadline_hours',
            'reminder_before_hours',
            'historical_debt_expected_total',
            'receipt_footer',
            'sms_reminders_enabled',
        ]);
        $deadlineHours = filter_var(
            $body['confirmation_deadline_hours'],
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1, 'max_range' => 168]]
        );
        $reminderHours = filter_var(
            $body['reminder_before_hours'],
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 0, 'max_range' => 167]]
        );
        if ($deadlineHours === false) {
            throw new ApiException(422, 'Confirmation deadline must be between 1 and 168 hours.');
        }
        if ($reminderHours === false || $reminderHours >= $deadlineHours) {
            throw new ApiException(422, 'Reminder must be between 0 and fewer hours than the confirmation deadline.');
        }
        if (!is_bool($body['sms_reminders_enabled'])) {
            throw new ApiException(422, 'sms_reminders_enabled must be a boolean.');
        }
        $email = Http::text($body['hotel_email'], 'hotel_email', 254, true);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new ApiException(422, 'hotel_email must be a valid email address.');
        }
        $historicalDebtTarget = Http::money($body['historical_debt_expected_total'], 'historical_debt_expected_total');
        if (Money::minorUnits($historicalDebtTarget) <= 0) {
            throw new ApiException(422, 'Historical debt reconciliation target must be greater than zero.');
        }
        (new SystemSettingsService($pdo))->update([
            'hotel_name' => Http::text($body['hotel_name'], 'hotel_name', 160),
            'hotel_address' => Http::text($body['hotel_address'], 'hotel_address', 300, true),
            'hotel_phone' => Http::text($body['hotel_phone'], 'hotel_phone', 32, true),
            'hotel_email' => $email,
            'hotel_tin' => Http::text($body['hotel_tin'], 'hotel_tin', 80, true),
            'currency' => 'ETB',
            'confirmation_deadline_hours' => (string) $deadlineHours,
            'reminder_before_hours' => (string) $reminderHours,
            'historical_debt_expected_total' => $historicalDebtTarget,
            'receipt_footer' => Http::text($body['receipt_footer'], 'receipt_footer', 300, true),
            'sms_reminders_enabled' => $body['sms_reminders_enabled'] ? '1' : '0',
        ], (int) $user['id']);
        Http::respond(['message' => 'System settings updated.']);
    }
    if ($method === 'POST' && $path === '/api/system-settings/confirmation-deadline') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        $hours = filter_var($body['hours'] ?? null, FILTER_VALIDATE_INT);
        if ($hours === false) {
            throw new ApiException(422, 'hours must be an integer.');
        }
        (new SystemSettingsService($pdo))->confirmationDeadline($hours, (int) $user['id']);
        Http::respond(['message' => 'Confirmation deadline updated.']);
    }
    if ($method === 'GET' && $path === '/api/system-settings') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        Http::respond(['settings' => (new SystemSettingsService($pdo))->list()]);
    }
    if ($method === 'POST' && $path === '/api/system-settings/hotel-profile') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        (new SystemSettingsService($pdo))->hotelName(
            Http::text($body['hotel_name'] ?? null, 'hotel_name', 160),
            (int) $user['id']
        );
        Http::respond(['message' => 'Hotel profile updated.']);
    }
    if ($method === 'POST' && $path === '/api/system-settings/historical-debt-target') {
        AuthService::requireRole($user, 'system_administrator', 'finance_manager');
        $body = Http::json();
        (new SystemSettingsService($pdo))->historicalDebtTarget(
            Http::money($body['amount'] ?? null, 'amount'),
            (int) $user['id']
        );
        Http::respond(['message' => 'Historical debt reconciliation target updated.']);
    }

    throw new ApiException(404, 'Endpoint not found.');
} catch (ApiException $exception) {
    Http::respond(['error' => $exception->getMessage(), 'details' => $exception->details], $exception->httpStatus);
} catch (Throwable $exception) {
    error_log('DCMS request failed: ' . $exception);
    Http::respond(['error' => 'An unexpected server error occurred.'], 500);
}
