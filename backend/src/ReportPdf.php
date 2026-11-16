<?php
declare(strict_types=1);

namespace Haroni\Dcms;

final class ReportPdf
{
    public static function render(
        string $title,
        array $columns,
        array $rows,
        string $period,
        string $hotelName = 'Haroni Hotel'
    ): string
    {
        $lines = [
            self::ascii($title . ' - ' . $hotelName),
            self::ascii('Period: ' . $period . ' | Generated: ' . gmdate('Y-m-d H:i:s') . ' UTC'),
            self::ascii(implode(' | ', $columns)),
            str_repeat('-', 100),
        ];
        foreach ($rows as $row) {
            $values = [];
            foreach ($columns as $column) {
                $value = $row[$column] ?? '';
                $values[] = $value === null ? '' : (string) $value;
            }
            $wrapped = wordwrap(self::ascii(implode(' | ', $values)), 100, "\n", true);
            foreach (explode("\n", $wrapped) as $line) {
                $lines[] = $line;
            }
        }
        if (count($lines) === 4) {
            $lines[] = 'No records found for this period.';
        }

        $pages = array_chunk($lines, 47);
        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
        ];
        $pageReferences = [];
        foreach ($pages as $pageIndex => $pageLines) {
            $pageObject = 4 + ($pageIndex * 2);
            $contentObject = $pageObject + 1;
            $pageReferences[] = $pageObject . ' 0 R';
            $stream = "BT\n/F1 8 Tf\n40 800 Td\n";
            foreach ($pageLines as $lineIndex => $line) {
                if ($lineIndex > 0) {
                    $stream .= "0 -16 Td\n";
                }
                if ($pageIndex === 0 && $lineIndex === 0) {
                    $stream .= "/F1 13 Tf\n";
                } elseif ($pageIndex === 0 && $lineIndex === 1) {
                    $stream .= "/F1 8 Tf\n";
                }
                $stream .= '(' . self::escape($line) . ") Tj\n";
            }
            $stream .= "ET\n";
            $objects[] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842]'
                . ' /Resources << /Font << /F1 3 0 R >> >> /Contents ' . $contentObject . ' 0 R >>';
            $objects[] = '<< /Length ' . strlen($stream) . " >>\nstream\n" . $stream . 'endstream';
        }
        $objects[1] = '<< /Type /Pages /Kids [' . implode(' ', $pageReferences)
            . '] /Count ' . count($pageReferences) . ' >>';

        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [0];
        foreach ($objects as $index => $object) {
            $offsets[] = strlen($pdf);
            $pdf .= ($index + 1) . " 0 obj\n" . $object . "\nendobj\n";
        }
        $xrefOffset = strlen($pdf);
        $pdf .= "xref\n0 " . (count($objects) + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($index = 1; $index <= count($objects); $index++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$index]);
        }
        return $pdf . "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R >>\n"
            . "startxref\n" . $xrefOffset . "\n%%EOF\n";
    }

    private static function ascii(string $value): string
    {
        if (function_exists('iconv')) {
            $converted = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
            if ($converted !== false) {
                return preg_replace('/[^\x20-\x7E]/', '?', $converted) ?? '';
            }
        }
        return preg_replace('/[^\x20-\x7E]/', '?', $value) ?? '';
    }

    private static function escape(string $value): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
    }
}
