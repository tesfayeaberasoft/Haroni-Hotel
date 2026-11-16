<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use RuntimeException;

final class ApiException extends RuntimeException
{
    public function __construct(
        public readonly int $httpStatus,
        string $message,
        public readonly array $details = []
    ) {
        parent::__construct($message);
    }
}
