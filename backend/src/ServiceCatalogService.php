<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use Throwable;

final class ServiceCatalogService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function createCategory(string $name, int $administratorId): int
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name, 'UTF-8') > 100) {
            throw new ApiException(422, 'Category name must contain 1 to 100 characters.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare('INSERT INTO service_categories (name) VALUES (?)');
            $query->execute([$name]);
            $id = (int) $this->pdo->lastInsertId();
            AuditLogger::record($this->pdo, $administratorId, 'service_category_created', 'service_category', $id, [
                'name' => $name,
            ]);
            $this->pdo->commit();
            return $id;
        } catch (\PDOException $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception->getCode() === '23000') {
                throw new ApiException(409, 'A category with this name already exists.');
            }
            throw $exception;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function createService(
        int $categoryId,
        string $name,
        string $price,
        int $administratorId,
        bool $publishImmediately = false
    ): array {
        $name = trim($name);
        if ($name === '' || mb_strlen($name, 'UTF-8') > 160) {
            throw new ApiException(422, 'Service name must contain 1 to 160 characters.');
        }
        $query = $this->pdo->prepare(
            'INSERT INTO service_catalog (category_id, name, current_price, is_active, created_by)
             VALUES (?, ?, ?, ?, ?)'
        );
        $this->pdo->beginTransaction();
        try {
            $category = $this->pdo->prepare(
                'SELECT id FROM service_categories WHERE id = ? AND is_active = TRUE FOR UPDATE'
            );
            $category->execute([$categoryId]);
            if ($category->fetchColumn() === false) {
                throw new ApiException(422, 'Service category does not exist or is inactive.');
            }
            $query->execute([
                $categoryId,
                $name,
                $publishImmediately ? $price : '0.00',
                $publishImmediately,
                $administratorId,
            ]);
            $id = (int) $this->pdo->lastInsertId();
            if ($publishImmediately) {
                AuditLogger::record($this->pdo, $administratorId, 'service_created', 'service_catalog', $id, [
                    'category_id' => $categoryId,
                    'name' => $name,
                    'initial_price' => $price,
                    'available' => true,
                ]);
                $this->pdo->commit();
                return ['id' => $id, 'price_request_id' => null];
            }
            $priceRequest = $this->pdo->prepare(
                'INSERT INTO catalog_price_requests
                    (service_id, proposed_price, reason, requested_by)
                 VALUES (?, ?, ?, ?)'
            );
            $priceRequest->execute([$id, $price, 'Initial catalog price requires Finance approval.', $administratorId]);
            $priceRequestId = (int) $this->pdo->lastInsertId();
            AuditLogger::record($this->pdo, $administratorId, 'service_created', 'service_catalog', $id, [
                'category_id' => $categoryId,
                'name' => $name,
                'initial_price_request_id' => $priceRequestId,
            ]);
            $this->pdo->commit();
            return ['id' => $id, 'price_request_id' => $priceRequestId];
        } catch (\PDOException $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception->getCode() === '23000') {
                throw new ApiException(422, 'Category does not exist or service name is already in use.');
            }
            throw $exception;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function requestPriceChange(int $serviceId, string $price, string $reason, int $administratorId): int
    {
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000) {
            throw new ApiException(422, 'A reason for the price change is required.');
        }
        $this->pdo->beginTransaction();
        try {
            $exists = $this->pdo->prepare('SELECT id FROM service_catalog WHERE id = ? FOR UPDATE');
            $exists->execute([$serviceId]);
            if ($exists->fetchColumn() === false) {
                throw new ApiException(404, 'Service not found.');
            }
            $query = $this->pdo->prepare(
                "INSERT INTO catalog_price_requests (service_id, proposed_price, reason, requested_by)
                 VALUES (?, ?, ?, ?)"
            );
            $query->execute([$serviceId, $price, $reason, $administratorId]);
            $id = (int) $this->pdo->lastInsertId();
            AuditLogger::record($this->pdo, $administratorId, 'catalog_price_change_requested', 'catalog_price_request', $id, [
                'service_id' => $serviceId,
                'proposed_price' => $price,
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

    public function reviewPriceChange(int $requestId, int $financeManagerId, bool $approve, string $reason = ''): void
    {
        $reason = trim($reason);
        if (!$approve && ($reason === '' || mb_strlen($reason, 'UTF-8') > 1000)) {
            throw new ApiException(422, 'A reason is required to reject the price change.');
        }
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare('SELECT * FROM catalog_price_requests WHERE id = ? FOR UPDATE');
            $query->execute([$requestId]);
            $request = $query->fetch();
            if ($request === false) {
                throw new ApiException(404, 'Price change request not found.');
            }
            if ($request['status'] !== 'pending') {
                throw new ApiException(409, 'Price change request has already been reviewed.');
            }
            if ($approve) {
                $serviceQuery = $this->pdo->prepare(
                    'SELECT current_price, is_active FROM service_catalog WHERE id = ? FOR UPDATE'
                );
                $serviceQuery->execute([(int) $request['service_id']]);
                $service = $serviceQuery->fetch();
                if ($service === false) {
                    throw new ApiException(404, 'Service no longer exists.');
                }
                $oldPrice = $service['current_price'];
                $this->pdo->prepare('UPDATE service_catalog SET current_price = ? WHERE id = ?')
                    ->execute([$request['proposed_price'], $request['service_id']]);
                if (!(bool) $service['is_active']) {
                    $historyQuery = $this->pdo->prepare(
                        'SELECT id FROM service_price_history WHERE service_id = ? LIMIT 1'
                    );
                    $historyQuery->execute([(int) $request['service_id']]);
                    if ($historyQuery->fetchColumn() === false) {
                        $this->pdo->prepare('UPDATE service_catalog SET is_active = TRUE WHERE id = ?')
                            ->execute([$request['service_id']]);
                    }
                }
                $this->pdo->prepare(
                    'INSERT INTO service_price_history
                        (service_id, old_price, new_price, request_id, approved_by, approved_at)
                     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))'
                )->execute([
                    $request['service_id'],
                    $oldPrice,
                    $request['proposed_price'],
                    $requestId,
                    $financeManagerId,
                ]);
            }
            $status = $approve ? 'approved' : 'rejected';
            $this->pdo->prepare(
                'UPDATE catalog_price_requests
                 SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(6), review_reason = ?
                 WHERE id = ?'
            )->execute([$status, $financeManagerId, $reason !== '' ? $reason : null, $requestId]);
            AuditLogger::record($this->pdo, $financeManagerId, 'catalog_price_change_' . $status, 'catalog_price_request', $requestId, [
                'service_id' => (int) $request['service_id'],
                'proposed_price' => $request['proposed_price'],
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

    public function list(bool $includeInactive = false): array
    {
        $sql = 'SELECT s.id, s.name, s.category_id, c.name AS category, s.current_price,
                       s.is_active, c.is_active AS category_is_active
                FROM service_catalog s JOIN service_categories c ON c.id = s.category_id';
        if (!$includeInactive) {
            $sql .= ' WHERE s.is_active = TRUE AND c.is_active = TRUE';
        }
        return $this->pdo->query($sql . ' ORDER BY c.name, s.name')->fetchAll();
    }

    public function priceHistory(int $serviceId): array
    {
        $service = $this->pdo->prepare('SELECT id FROM service_catalog WHERE id = ?');
        $service->execute([$serviceId]);
        if ($service->fetchColumn() === false) {
            throw new ApiException(404, 'Service not found.');
        }
        $history = $this->pdo->prepare(
            'SELECT h.old_price, h.new_price, h.approved_at, u.username AS approved_by,
                    r.reason AS request_reason
             FROM service_price_history h
             JOIN users u ON u.id = h.approved_by
             JOIN catalog_price_requests r ON r.id = h.request_id
             WHERE h.service_id = ? ORDER BY h.approved_at DESC, h.id DESC LIMIT 500'
        );
        $history->execute([$serviceId]);
        return $history->fetchAll();
    }

    public function categories(bool $includeInactive = false): array
    {
        $sql = 'SELECT id, name, is_active FROM service_categories';
        if (!$includeInactive) {
            $sql .= ' WHERE is_active = TRUE';
        }
        return $this->pdo->query($sql . ' ORDER BY name')->fetchAll();
    }

    public function updateCategory(int $categoryId, array $data, int $administratorId): void
    {
        if ($data === [] || array_diff(array_keys($data), ['name', 'active']) !== []) {
            throw new ApiException(422, 'Provide name and/or active only.');
        }
        if (array_key_exists('active', $data) && !is_bool($data['active'])) {
            throw new ApiException(422, 'active must be a boolean.');
        }
        $fields = [];
        $values = [];
        if (array_key_exists('name', $data)) {
            $name = Http::text($data['name'], 'name', 100);
            $fields[] = 'name = ?';
            $values[] = $name;
        }
        if (array_key_exists('active', $data)) {
            $fields[] = 'is_active = ?';
            $values[] = $data['active'];
        }

        $this->pdo->beginTransaction();
        try {
            $values[] = $categoryId;
            $update = $this->pdo->prepare(
                'UPDATE service_categories SET ' . implode(', ', $fields) . ' WHERE id = ?'
            );
            $update->execute($values);
            if ($update->rowCount() === 0) {
                $exists = $this->pdo->prepare('SELECT id FROM service_categories WHERE id = ?');
                $exists->execute([$categoryId]);
                if ($exists->fetchColumn() === false) {
                    throw new ApiException(404, 'Service category not found.');
                }
            }
            AuditLogger::record($this->pdo, $administratorId, 'service_category_updated', 'service_category', $categoryId, [
                'changed_fields' => array_keys($data),
            ]);
            $this->pdo->commit();
        } catch (\PDOException $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception->getCode() === '23000') {
                throw new ApiException(409, 'A category with this name already exists.');
            }
            throw $exception;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function updateService(int $serviceId, array $data, int $administratorId): void
    {
        if ($data === [] || array_diff(array_keys($data), ['name', 'category_id']) !== []) {
            throw new ApiException(422, 'Provide name and/or category_id only; prices require Finance approval.');
        }
        $fields = [];
        $values = [];
        if (array_key_exists('name', $data)) {
            $name = Http::text($data['name'], 'name', 160);
            $fields[] = 'name = ?';
            $values[] = $name;
        }
        if (array_key_exists('category_id', $data)) {
            $categoryId = Http::idValue($data['category_id'], 'category_id');
            $fields[] = 'category_id = ?';
            $values[] = $categoryId;
        }

        $this->pdo->beginTransaction();
        try {
            $service = $this->pdo->prepare('SELECT id FROM service_catalog WHERE id = ? FOR UPDATE');
            $service->execute([$serviceId]);
            if ($service->fetchColumn() === false) {
                throw new ApiException(404, 'Service not found.');
            }
            if (array_key_exists('category_id', $data)) {
                $category = $this->pdo->prepare(
                    'SELECT id FROM service_categories WHERE id = ? AND is_active = TRUE FOR UPDATE'
                );
                $category->execute([$categoryId]);
                if ($category->fetchColumn() === false) {
                    throw new ApiException(422, 'Service category does not exist or is inactive.');
                }
            }
            $values[] = $serviceId;
            $this->pdo->prepare(
                'UPDATE service_catalog SET ' . implode(', ', $fields) . ' WHERE id = ?'
            )->execute($values);
            AuditLogger::record($this->pdo, $administratorId, 'service_metadata_updated', 'service_catalog', $serviceId, [
                'changed_fields' => array_keys($data),
            ]);
            $this->pdo->commit();
        } catch (\PDOException $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($exception->getCode() === '23000') {
                throw new ApiException(409, 'A service with this name already exists.');
            }
            throw $exception;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function pendingPriceChanges(): array
    {
        $catalog = $this->pdo->query(
            "SELECT CONCAT('catalog-', r.id) AS id, 'catalog' AS request_kind,
                    r.service_id, s.name AS service_name, s.current_price,
                    r.proposed_price, r.reason, r.requested_by, u.username AS requester,
                    r.created_at, r.status, reviewer.username AS decided_by, r.reviewed_at AS decided_at,
                    NULL AS transaction_id, NULL AS transaction_code
             FROM catalog_price_requests r
             JOIN service_catalog s ON s.id = r.service_id
             JOIN users u ON u.id = r.requested_by
             LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
             ORDER BY r.created_at DESC LIMIT 500"
        )->fetchAll();
        $transaction = $this->pdo->query(
            "SELECT CONCAT('transaction-', r.id) AS id, 'transaction' AS request_kind,
                    r.service_id, s.name AS service_name, r.catalog_price AS current_price,
                    r.requested_price AS proposed_price, r.reason, r.requested_by,
                    requester.username AS requester, r.created_at, r.status,
                    reviewer.username AS decided_by, r.reviewed_at AS decided_at,
                    t.id AS transaction_id, CONCAT('HH-', LPAD(t.id, 8, '0')) AS transaction_code
             FROM transaction_price_requests r
             JOIN credit_transactions t ON t.id = r.transaction_id
             JOIN service_catalog s ON s.id = r.service_id
             JOIN users requester ON requester.id = r.requested_by
             LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
             ORDER BY r.created_at DESC LIMIT 500"
        )->fetchAll();
        $requests = array_merge($catalog, $transaction);
        usort($requests, static fn(array $left, array $right): int => strcmp(
            (string) $right['created_at'],
            (string) $left['created_at']
        ));
        return array_slice($requests, 0, 500);
    }

    public function setAvailability(
        int $serviceId,
        bool $active,
        int $administratorId,
        bool $financeManager = false
    ): void
    {
        $this->pdo->beginTransaction();
        try {
            $query = $this->pdo->prepare(
                'SELECT s.id, s.current_price, c.is_active AS category_is_active
                 FROM service_catalog s
                 JOIN service_categories c ON c.id = s.category_id
                 WHERE s.id = ? FOR UPDATE'
            );
            $query->execute([$serviceId]);
            $service = $query->fetch();
            if ($service === false) {
                throw new ApiException(404, 'Service not found.');
            }
            if ($active) {
                if (!(bool) $service['category_is_active']) {
                    throw new ApiException(409, 'Activate the service category before activating this service.');
                }
                if ($financeManager) {
                    if (Money::minorUnits((string) $service['current_price']) <= 0) {
                        throw new ApiException(409, 'Set a catalog price before activating this service.');
                    }
                } else {
                    $approved = $this->pdo->prepare(
                        'SELECT id FROM service_price_history WHERE service_id = ? LIMIT 1'
                    );
                    $approved->execute([$serviceId]);
                    if ($approved->fetchColumn() === false) {
                        throw new ApiException(409, 'A Finance-approved catalog price is required before activating this service.');
                    }
                }
            }
            $this->pdo->prepare('UPDATE service_catalog SET is_active = ? WHERE id = ?')
                ->execute([$active, $serviceId]);
            AuditLogger::record($this->pdo, $administratorId, $active ? 'service_activated' : 'service_deactivated', 'service_catalog', $serviceId);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }
}
