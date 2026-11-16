<?php
declare(strict_types=1);

namespace Haroni\Dcms;

final class Money
{
    public static function minorUnits(string|int|float $amount): int
    {
        $value = (string) $amount;
        if (!preg_match('/^(-?)(\d+)(?:\.(\d{1,2}))?$/D', $value, $parts)) {
            throw new \RuntimeException('Database returned an invalid monetary amount.');
        }
        $fraction = str_pad($parts[3] ?? '', 2, '0');
        $minor = ((int) $parts[2] * 100) + (int) $fraction;
        return ($parts[1] ?? '') === '-' ? -$minor : $minor;
    }

    public static function formatMinor(int $minor): string
    {
        $negative = $minor < 0;
        $absolute = abs($minor);
        return ($negative ? '-' : '') . intdiv($absolute, 100) . '.' . str_pad((string) ($absolute % 100), 2, '0', STR_PAD_LEFT);
    }
}
