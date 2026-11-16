<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use PDO;
use JsonException;

final class AuditLogger
{
    public static function record(
        PDO $pdo,
        ?int $actorId,
        string $action,
        string $entityType,
        ?int $entityId,
        array $details = []
    ): void {
        try {
            $json = $details === [] ? null : json_encode($details, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $exception) {
            throw new \RuntimeException('Audit details could not be encoded.', 0, $exception);
        }
        $ip = filter_var($_SERVER['REMOTE_ADDR'] ?? '', FILTER_VALIDATE_IP)
            ? inet_pton($_SERVER['REMOTE_ADDR'])
            : null;
        $statement = $pdo->prepare(
            'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
             VALUES (:actor, :action, :entity, :entity_id, :details, :ip)'
        );
        $statement->execute([
            'actor' => $actorId,
            'action' => $action,
            'entity' => $entityType,
            'entity_id' => $entityId,
            'details' => $json,
            'ip' => $ip,
        ]);
    }
}
