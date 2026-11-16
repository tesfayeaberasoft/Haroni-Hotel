<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use JsonException;

final class Http
{
    public static function json(): array
    {
        $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
        if ($contentType !== 'application/json') {
            throw new ApiException(415, 'Content-Type must be application/json.');
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || strlen($raw) > 1_048_576) {
            throw new ApiException(413, 'Request body is missing or exceeds the 1 MB limit.');
        }
        try {
            $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            $object = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(400, 'Request body must contain valid JSON.');
        }
        if (!is_array($data) || !($object instanceof \stdClass)) {
            throw new ApiException(400, 'Request body must be a JSON object.');
        }
        return $data;
    }

    public static function requireFields(array $data, array $fields): void
    {
        foreach ($fields as $field) {
            if (!array_key_exists($field, $data)) {
                throw new ApiException(422, 'Missing required field: ' . $field);
            }
        }
    }

    public static function positiveId(string $value): int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) {
            throw new ApiException(400, 'Resource identifier must be a positive integer.');
        }
        return $id;
    }

    public static function idValue(mixed $value, string $field): int
    {
        if (!is_int($value) && !is_string($value)) {
            throw new ApiException(422, $field . ' must be a positive integer.');
        }
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) {
            throw new ApiException(422, $field . ' must be a positive integer.');
        }
        return $id;
    }

    public static function text(mixed $value, string $field, int $maxLength, bool $allowEmpty = false): string
    {
        if (!is_string($value)) {
            throw new ApiException(422, $field . ' must be text.');
        }
        $text = trim($value);
        $length = mb_strlen($text, 'UTF-8');
        if ((!$allowEmpty && $length === 0) || $length > $maxLength) {
            throw new ApiException(422, $field . ' must contain ' . ($allowEmpty ? 'at most ' : '1 to ')
                . $maxLength . ' characters.');
        }
        return $text;
    }

    public static function secret(mixed $value, string $field, int $maxLength = 4096): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > $maxLength) {
            throw new ApiException(422, $field . ' must be a non-empty string within the allowed length.');
        }
        return $value;
    }

    public static function csrf(): void
    {
        $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        $expected = $_SESSION['csrf_token'] ?? '';
        if (!is_string($expected) || $expected === '' || !is_string($provided) || !hash_equals($expected, $provided)) {
            throw new ApiException(403, 'CSRF token is missing or invalid.');
        }
    }

    public static function respond(array $body, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        try {
            echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (\JsonException $exception) {
            error_log('DCMS JSON response encoding failed: ' . $exception->getMessage());
            http_response_code(500);
            echo '{"error":"Response could not be encoded."}';
        }
        exit;
    }

    public static function money(mixed $value, string $field): string
    {
        if (!is_int($value) && !is_string($value)) {
            throw new ApiException(422, $field . ' must be a non-negative decimal amount.');
        }
        $amount = (string) $value;
        if (!preg_match('/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/D', $amount)) {
            throw new ApiException(422, $field . ' must be a non-negative decimal amount with at most two decimal places.');
        }
        return Money::formatMinor(Money::minorUnits($amount));
    }

    public static function signedMoney(mixed $value, string $field): string
    {
        if (!is_int($value) && !is_string($value)) {
            throw new ApiException(422, $field . ' must be a signed decimal amount.');
        }
        $amount = (string) $value;
        if (!preg_match('/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/D', $amount)
            || Money::minorUnits($amount) === 0) {
            throw new ApiException(422, $field . ' must be non-zero with at most two decimal places.');
        }
        return Money::formatMinor(Money::minorUnits($amount));
    }

    public static function positiveNumber(mixed $value, string $field): string
    {
        if (!is_int($value) && !is_string($value)) {
            throw new ApiException(422, $field . ' must be a positive number.');
        }
        $number = (string) $value;
        if (!preg_match('/^(0|[1-9]\d{0,8})(?:\.(\d{1,3}))?$/D', $number, $parts)
            || (int) $parts[1] === 0 && (int) ($parts[2] ?? '0') === 0) {
            throw new ApiException(422, $field . ' must be greater than zero and have at most three decimal places.');
        }
        return $parts[1] . '.' . str_pad($parts[2] ?? '', 3, '0');
    }
}
