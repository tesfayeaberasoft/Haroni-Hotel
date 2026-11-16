<?php
declare(strict_types=1);

use Haroni\Dcms\AuditLogger;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

$options = array_slice($argv, 1);
$unknownOptions = array_diff($options, ['--apply', '--validate']);
if ($unknownOptions !== [] || count($options) > 1) {
    fwrite(STDERR, "Usage: php seed-sample-data.php [--validate|--apply]\n");
    exit(2);
}
$apply = $options === ['--apply'];
$validate = $options === ['--validate'];

try {
    $pdo = dcms_db();
    $database = (string) $pdo->query('SELECT DATABASE()')->fetchColumn();
    if ($database !== 'haroni_dcms') {
        throw new RuntimeException('Refusing to seed database "' . $database . '"; expected haroni_dcms.');
    }

    $adminQuery = $pdo->query(
        "SELECT id FROM users WHERE role = 'system_administrator' AND is_active = TRUE ORDER BY id LIMIT 1"
    );
    $administratorId = $adminQuery->fetchColumn();
    if ($administratorId === false) {
        throw new RuntimeException('No active administrator exists. Run create-first-admin.php first.');
    }
    $administratorId = (int) $administratorId;

    $marker = $pdo->prepare(
        "SELECT id FROM audit_logs WHERE action = 'sample_data_seeded'
         AND entity_type = 'sample_data' LIMIT 1"
    );
    $marker->execute();
    if ($marker->fetchColumn() !== false) {
        throw new RuntimeException('Sample data has already been seeded; refusing to create duplicates.');
    }

    $sampleUsernames = ['demo_cashier', 'demo_finance', 'demo_guest_01', 'demo_guest_02', 'demo_guest_03'];
    $userPlaceholders = implode(', ', array_fill(0, count($sampleUsernames), '?'));
    $usernameCheck = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username IN (' . $userPlaceholders . ')');
    $usernameCheck->execute($sampleUsernames);
    if ((int) $usernameCheck->fetchColumn() !== 0) {
        throw new RuntimeException('A demo username already exists; refusing to create duplicate sample accounts.');
    }

    $sampleServiceNames = ['DEMO Breakfast', 'DEMO Bottled Water', 'DEMO Room Night', 'DEMO Laundry'];
    $servicePlaceholders = implode(', ', array_fill(0, count($sampleServiceNames), '?'));
    $serviceCheck = $pdo->prepare('SELECT COUNT(*) FROM service_catalog WHERE name IN (' . $servicePlaceholders . ')');
    $serviceCheck->execute($sampleServiceNames);
    if ((int) $serviceCheck->fetchColumn() !== 0) {
        throw new RuntimeException('A demo service already exists; refusing to create duplicate sample catalog entries.');
    }

    $expectedTotal = $pdo->query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'historical_debt_expected_total'"
    )->fetchColumn();
    if ($expectedTotal === false || (string) $expectedTotal !== '11000000.00') {
        throw new RuntimeException('The expected historical-debt total is not the standard 11,000,000.00 ETB.');
    }

    $categories = [];
    foreach ($pdo->query('SELECT id, name FROM service_categories WHERE is_active = TRUE')->fetchAll() as $row) {
        $categories[(string) $row['name']] = (int) $row['id'];
    }
    foreach (['Food', 'Drinks', 'Accommodation', 'Other'] as $requiredCategory) {
        if (!isset($categories[$requiredCategory])) {
            throw new RuntimeException('Required active service category is missing: ' . $requiredCategory);
        }
    }

    if (!$apply && !$validate) {
        fwrite(STDOUT, "Dry run passed for database haroni_dcms.\n");
        fwrite(STDOUT, "Would add isolated demo users, guests, catalog services, five workflow transactions,\n");
        fwrite(STDOUT, "two payments, and 11,000,000.00 ETB of clearly marked pending opening balances.\n");
        fwrite(STDOUT, "Existing user and financial records will not be modified. No records were written.\n");
        fwrite(STDOUT, "Use --validate to test all inserts and triggers with a rollback, or --apply to seed.\n");
        exit(0);
    }

    $samplePassword = getenv('DCMS_SAMPLE_PASSWORD');
    putenv('DCMS_SAMPLE_PASSWORD');
    unset($_ENV['DCMS_SAMPLE_PASSWORD']);
    if (!is_string($samplePassword) || strlen($samplePassword) < 12 || strlen($samplePassword) > 72) {
        throw new RuntimeException('DCMS_SAMPLE_PASSWORD must be 12 to 72 bytes; use at least 12 ASCII characters.');
    }
    $passwordHash = password_hash($samplePassword, PASSWORD_DEFAULT);
    unset($samplePassword);
    if (!is_string($passwordHash)) {
        throw new RuntimeException('Could not hash the sample-user password.');
    }

    $users = [
        'cashier' => ['demo_cashier', 'DEMO Cashier', 'cashier', '+251900000201'],
        'finance' => ['demo_finance', 'DEMO Finance Manager', 'finance_manager', '+251900000202'],
        'guest_1' => ['demo_guest_01', 'DEMO Guest One', 'guest', '+251900000211'],
        'guest_2' => ['demo_guest_02', 'DEMO Guest Two', 'guest', '+251900000212'],
        'guest_3' => ['demo_guest_03', 'DEMO Guest Three', 'guest', '+251900000213'],
    ];
    $services = [
        'breakfast' => ['DEMO Breakfast', 'Food', '450.00'],
        'bottled_water' => ['DEMO Bottled Water', 'Drinks', '120.00'],
        'room_night' => ['DEMO Room Night', 'Accommodation', '4500.00'],
        'laundry' => ['DEMO Laundry', 'Other', '280.00'],
    ];

    $pdo->beginTransaction();
    try {
        $insertUser = $pdo->prepare(
            'INSERT INTO users (username, full_name, password_hash, role, phone, must_change_password)
             VALUES (?, ?, ?, ?, ?, TRUE)'
        );
        $userIds = [];
        foreach ($users as $key => [$username, $fullName, $role, $phone]) {
            $insertUser->execute([$username, $fullName, $passwordHash, $role, $phone]);
            $userIds[$key] = (int) $pdo->lastInsertId();
            AuditLogger::record($pdo, $administratorId, 'sample_user_created', 'user', $userIds[$key], [
                'username' => $username,
                'role' => $role,
                'sample_data_only' => true,
            ]);
            if ($role === 'guest') {
                $pdo->prepare(
                    'INSERT INTO guest_accounts (user_id, full_name, credit_limit, created_by)
                     VALUES (?, ?, 0.00, ?)'
                )->execute([$userIds[$key], $fullName, $administratorId]);
            }
        }

        $creditLimits = [
            'guest_1' => '100000.00',
            'guest_2' => '75000.00',
            'guest_3' => '50000.00',
        ];
        $setLimit = $pdo->prepare('UPDATE guest_accounts SET credit_limit = ? WHERE user_id = ?');
        foreach ($creditLimits as $guestKey => $limit) {
            $setLimit->execute([$limit, $userIds[$guestKey]]);
            AuditLogger::record($pdo, $userIds['finance'], 'credit_limit_updated', 'guest', $userIds[$guestKey], [
                'previous_credit_limit' => '0.00',
                'new_credit_limit' => $limit,
                'full_name' => $users[$guestKey][1],
                'reason' => 'DEMO DATA ONLY - initial test account limit.',
            ]);
        }

        $serviceIds = [];
        $insertService = $pdo->prepare(
            'INSERT INTO service_catalog (category_id, name, current_price, is_active, created_by)
             VALUES (?, ?, 0.00, FALSE, ?)'
        );
        $insertPriceRequest = $pdo->prepare(
            "INSERT INTO catalog_price_requests
                (service_id, proposed_price, reason, requested_by, status, reviewed_by, reviewed_at, review_reason)
             VALUES (?, ?, 'DEMO DATA ONLY - initial sample price.', ?, 'approved', ?, UTC_TIMESTAMP(6),
                     'Approved for local sample data only.')"
        );
        $insertPriceHistory = $pdo->prepare(
            'INSERT INTO service_price_history
                (service_id, old_price, new_price, request_id, approved_by, approved_at)
             VALUES (?, 0.00, ?, ?, ?, UTC_TIMESTAMP(6))'
        );
        $activateService = $pdo->prepare(
            'UPDATE service_catalog SET current_price = ?, is_active = TRUE WHERE id = ?'
        );
        foreach ($services as $key => [$name, $category, $price]) {
            $insertService->execute([$categories[$category], $name, $administratorId]);
            $serviceId = (int) $pdo->lastInsertId();
            $serviceIds[$key] = $serviceId;
            $insertPriceRequest->execute([$serviceId, $price, $administratorId, $userIds['finance']]);
            $requestId = (int) $pdo->lastInsertId();
            $insertPriceHistory->execute([$serviceId, $price, $requestId, $userIds['finance']]);
            $activateService->execute([$price, $serviceId]);
            AuditLogger::record($pdo, $userIds['finance'], 'catalog_price_change_approved', 'catalog_price_request', $requestId, [
                'service_id' => $serviceId,
                'proposed_price' => $price,
                'sample_data_only' => true,
            ]);
        }

        $transactions = [
            [
                'key' => 'pending_guest',
                'guest' => 'guest_1',
                'status' => 'pending_guest_confirmation',
                'items' => [['breakfast', '1.000'], ['bottled_water', '2.000']],
            ],
            [
                'key' => 'pending_finance',
                'guest' => 'guest_2',
                'status' => 'pending_finance_approval',
                'items' => [['room_night', '1.000']],
            ],
            [
                'key' => 'approved',
                'guest' => 'guest_1',
                'status' => 'approved',
                'items' => [['room_night', '1.000']],
            ],
            [
                'key' => 'disputed',
                'guest' => 'guest_3',
                'status' => 'disputed',
                'items' => [['laundry', '2.000']],
            ],
            [
                'key' => 'rejected',
                'guest' => 'guest_2',
                'status' => 'rejected',
                'items' => [['breakfast', '1.000']],
            ],
        ];

        $insertTransaction = $pdo->prepare(
            "INSERT INTO credit_transactions (guest_id, cashier_id, consumption_date, status)
             VALUES (?, ?, ?, 'draft')"
        );
        $insertItem = $pdo->prepare(
            'INSERT INTO credit_transaction_items
                (transaction_id, service_id, service_name_snapshot, quantity, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $setTotal = $pdo->prepare('UPDATE credit_transactions SET total_amount = ? WHERE id = ?');
        $submitTransaction = $pdo->prepare(
            "UPDATE credit_transactions
             SET status = 'pending_guest_confirmation', requires_exception = FALSE,
                 confirmation_deadline = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR)
             WHERE id = ?"
        );
        $confirmTransaction = $pdo->prepare(
            "UPDATE credit_transactions
             SET status = 'pending_finance_approval', guest_confirmed_at = UTC_TIMESTAMP(6),
                 confirmation_method = 'portal'
             WHERE id = ?"
        );
        $transactionIds = [];
        foreach ($transactions as $transaction) {
            $guestId = $userIds[$transaction['guest']];
            $insertTransaction->execute([$guestId, $userIds['cashier'], gmdate('Y-m-d')]);
            $transactionId = (int) $pdo->lastInsertId();
            $transactionIds[$transaction['key']] = $transactionId;
            $total = 0.0;
            foreach ($transaction['items'] as [$serviceKey, $quantity]) {
                [$serviceName, , $price] = $services[$serviceKey];
                $lineTotal = round((float) $price * (float) $quantity, 2);
                $insertItem->execute([
                    $transactionId,
                    $serviceIds[$serviceKey],
                    $serviceName,
                    $quantity,
                    $price,
                    number_format($lineTotal, 2, '.', ''),
                ]);
                $total += $lineTotal;
            }
            $setTotal->execute([number_format($total, 2, '.', ''), $transactionId]);
            $submitTransaction->execute([$transactionId]);
            AuditLogger::record($pdo, $userIds['cashier'], 'transaction_submitted', 'credit_transaction', $transactionId, [
                'total_amount' => number_format($total, 2, '.', ''),
                'sample_data_only' => true,
            ]);

            if ($transaction['status'] === 'pending_guest_confirmation') {
                $pdo->prepare(
                    "INSERT INTO notifications
                        (user_id, related_transaction_id, notification_type, event_key, message)
                     VALUES (?, ?, 'transaction_confirmation', 'demo_seed', ?)"
                )->execute([
                    $guestId,
                    $transactionId,
                    'DEMO DATA ONLY - review sample credit transaction #' . $transactionId . '.',
                ]);
                continue;
            }

            if ($transaction['status'] !== 'disputed') {
                $confirmTransaction->execute([$transactionId]);
                AuditLogger::record($pdo, $guestId, 'transaction_confirmed', 'credit_transaction', $transactionId, [
                    'confirmation_method' => 'portal',
                    'sample_data_only' => true,
                ]);
            }

            if ($transaction['status'] === 'approved') {
                $pdo->prepare(
                    "UPDATE credit_transactions SET status = 'approved', approved_by = ?,
                        approved_at = UTC_TIMESTAMP(6) WHERE id = ?"
                )->execute([$userIds['finance'], $transactionId]);
                AuditLogger::record($pdo, $userIds['finance'], 'transaction_approved', 'credit_transaction', $transactionId, [
                    'total_amount' => number_format($total, 2, '.', ''),
                    'sample_data_only' => true,
                ]);
            } elseif ($transaction['status'] === 'rejected') {
                $pdo->prepare(
                    "UPDATE credit_transactions SET status = 'rejected', rejected_by = ?,
                        rejection_reason = 'DEMO DATA ONLY - sample rejection.' WHERE id = ?"
                )->execute([$userIds['finance'], $transactionId]);
                AuditLogger::record($pdo, $userIds['finance'], 'transaction_rejected', 'credit_transaction', $transactionId, [
                    'reason' => 'DEMO DATA ONLY - sample rejection.',
                ]);
            } elseif ($transaction['status'] === 'disputed') {
                $pdo->prepare(
                    "UPDATE credit_transactions SET status = 'disputed',
                        dispute_reason = 'DEMO DATA ONLY - sample guest dispute.' WHERE id = ?"
                )->execute([$transactionId]);
                AuditLogger::record($pdo, $guestId, 'transaction_disputed', 'credit_transaction', $transactionId, [
                    'reason' => 'DEMO DATA ONLY - sample guest dispute.',
                ]);
            }
        }

        $approvedTransactionId = $transactionIds['approved'];
        $approvedAmountQuery = $pdo->prepare(
            "SELECT total_amount FROM credit_transactions WHERE id = ? AND status = 'approved'"
        );
        $approvedAmountQuery->execute([$approvedTransactionId]);
        $previousBalance = (string) $approvedAmountQuery->fetchColumn();

        $insertPayment = $pdo->prepare(
            'INSERT INTO payments (guest_id, amount, method, reference_number, payment_date, recorded_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $insertPayment->execute([
            $userIds['guest_1'],
            '500.00',
            'bank_transfer',
            'DEMO-TRANSFER-001',
            gmdate('Y-m-d') . ' 00:00:00',
            $userIds['finance'],
        ]);
        $pendingPaymentId = (int) $pdo->lastInsertId();
        AuditLogger::record($pdo, $userIds['finance'], 'payment_recorded_pending_verification', 'payment', $pendingPaymentId, [
            'amount' => '500.00',
            'sample_data_only' => true,
        ]);

        $insertPayment->execute([
            $userIds['guest_1'],
            '300.00',
            'cash',
            'DEMO-CASH-001',
            gmdate('Y-m-d') . ' 00:00:00',
            $userIds['finance'],
        ]);
        $verifiedPaymentId = (int) $pdo->lastInsertId();
        $receipt = 'HH-' . gmdate('Ymd') . '-' . str_pad((string) $verifiedPaymentId, 8, '0', STR_PAD_LEFT);
        $remainingBalance = number_format((float) $previousBalance - 300.00, 2, '.', '');
        $pdo->prepare(
            "UPDATE payments SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP(6),
                verification_reason = 'DEMO DATA ONLY - sample payment verification.',
                receipt_number = ?, previous_balance = ?, remaining_balance = ?
             WHERE id = ?"
        )->execute([
            $userIds['finance'],
            $receipt,
            $previousBalance,
            $remainingBalance,
            $verifiedPaymentId,
        ]);
        AuditLogger::record($pdo, $userIds['finance'], 'payment_verified', 'payment', $verifiedPaymentId, [
            'amount' => '300.00',
            'previous_balance' => $previousBalance,
            'remaining_balance' => $remainingBalance,
            'receipt_number' => $receipt,
            'sample_data_only' => true,
        ]);

        $openingBalances = [
            ['guest_1', '3500000.00', 'DEMO ONLY - fictional opening balance, not real evidence.'],
            ['guest_2', '3000000.00', 'DEMO ONLY - fictional opening balance, not real evidence.'],
            ['guest_3', '4500000.00', 'DEMO ONLY - fictional opening balance, not real evidence.'],
        ];
        $insertBalance = $pdo->prepare(
            'INSERT INTO opening_balances
                (guest_id, amount, applicable_from, supporting_reference, entered_by)
             VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($openingBalances as [$guestKey, $amount, $reference]) {
            $insertBalance->execute([
                $userIds[$guestKey],
                $amount,
                '2020-01-01',
                $reference,
                $userIds['finance'],
            ]);
            $balanceId = (int) $pdo->lastInsertId();
            AuditLogger::record($pdo, $userIds['finance'], 'historical_debt_entered', 'opening_balance', $balanceId, [
                'guest_id' => $userIds[$guestKey],
                'amount' => $amount,
                'status' => 'pending_verification',
                'sample_data_only' => true,
            ]);
        }

        AuditLogger::record($pdo, $administratorId, 'sample_data_seeded', 'sample_data', null, [
            'dataset' => 'haroni_workflow_and_historical_demo_v1',
            'sample_users' => array_column($users, 0),
            'opening_balances_total' => '11000000.00',
            'opening_balances_status' => 'pending_verification',
        ]);
        if ($validate) {
            $pdo->rollBack();
            fwrite(STDOUT, "Validation passed; all sample inserts and workflow transitions were rolled back.\n");
            exit(0);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    fwrite(STDOUT, "Sample data was added to haroni_dcms.\n");
    fwrite(STDOUT, "Demo users all use the supplied sample password and must change it at first sign-in:\n");
    foreach ($users as [$username, $fullName, $role]) {
        fwrite(STDOUT, '  ' . $username . ' (' . $role . ')' . PHP_EOL);
    }
    fwrite(STDOUT, "All sample records are marked DEMO. The 11,000,000.00 ETB opening balances remain pending verification.\n");
} catch (Throwable $exception) {
    fwrite(STDERR, 'Sample data seed failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
