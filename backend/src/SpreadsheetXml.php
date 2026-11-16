<?php
declare(strict_types=1);

namespace Haroni\Dcms;

final class SpreadsheetXml
{
    public static function render(array $rows): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>'
            . '<?mso-application progid="Excel.Sheet"?>'
            . '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
            . ' xmlns:o="urn:schemas-microsoft-com:office:office"'
            . ' xmlns:x="urn:schemas-microsoft-com:office:excel"'
            . ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
            . '<Worksheet ss:Name="Haroni DCMS"><Table>';
        foreach ($rows as $row) {
            $xml .= '<Row>';
            foreach ($row as $value) {
                $text = self::xmlText((string) $value);
                $xml .= '<Cell><Data ss:Type="String">' . htmlspecialchars(
                    $text,
                    ENT_XML1 | ENT_QUOTES,
                    'UTF-8'
                ) . '</Data></Cell>';
            }
            $xml .= '</Row>';
        }
        return $xml . '</Table></Worksheet></Workbook>';
    }

    private static function xmlText(string $value): string
    {
        return preg_replace(
            '/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u',
            '',
            $value
        ) ?? '';
    }
}
