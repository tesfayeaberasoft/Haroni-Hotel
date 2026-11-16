<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use RuntimeException;

final class GuestStatementPdf
{
    private const PAGE_WIDTH = 595.0;
    private const TABLE_LEFT = 42.0;
    private const TABLE_WIDTH = 511.0;
    private const BODY_BOTTOM = 62.0;
    private const INK = [28, 25, 20];
    private const GOLD = [184, 146, 62];
    private const MUTED = [110, 104, 92];
    private const CREAM = [248, 245, 238];
    private const PALE_GOLD = [248, 242, 226];

    public static function render(array $statement, array $settings): string
    {
        $logoPath = DCMS_ROOT . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'haroni-emblem.jpg';
        if (!is_file($logoPath)) {
            throw new RuntimeException('The Haroni Hotel statement logo could not be loaded.');
        }
        $logo = file_get_contents($logoPath);
        $imageInfo = getimagesize($logoPath);
        if (!is_string($logo) || !is_array($imageInfo) || ($imageInfo['mime'] ?? null) !== 'image/jpeg') {
            throw new RuntimeException('The Haroni Hotel statement logo could not be loaded.');
        }

        $account = is_array($statement['account'] ?? null) ? $statement['account'] : [];
        $hotel = [
            'name' => self::value($settings, 'hotel_name', 'Haroni Hotel'),
            'address' => self::value($settings, 'hotel_address', 'Bole Road, Addis Ababa, Ethiopia'),
            'phone' => self::value($settings, 'hotel_phone', '+251 11 661 2020'),
            'email' => self::value($settings, 'hotel_email', 'finance@haronihotel.com'),
            'tin' => self::value($settings, 'hotel_tin', '0012345678'),
        ];
        $guestName = self::value($account, 'full_name', 'Guest');
        $guestPhone = self::value($account, 'phone', 'Not provided');
        $subtitle = $guestName . '  |  ' . $guestPhone . '  |  As of ' . date('d M Y, H:i');
        $pageHeaders = [
            self::pageHeader($hotel, $subtitle, false),
            self::pageHeader($hotel, $subtitle, true),
        ];
        $pages = [$pageHeaders[0]];
        $pageIndex = 0;
        $y = 666.0;
        $currency = self::value($settings, 'currency', 'ETB');

        $summary = [
            ['Credit limit', self::money($account['credit_limit'] ?? 0, $currency)],
            ['Historical debt (opening balance)', self::money($account['historical_debt'] ?? 0, $currency)],
            ['Approved credit transactions', self::money($account['approved_credit'] ?? 0, $currency)],
            ['Payments received', '- ' . self::money($account['total_payments'] ?? 0, $currency)],
            ['Outstanding debt', self::money($account['outstanding_debt'] ?? 0, $currency)],
            ['Pending reservations', self::money($account['pending_reservations'] ?? 0, $currency)],
            ['Available credit', self::money($account['available_credit'] ?? 0, $currency)],
        ];
        self::drawTable(
            $pages,
            $pageIndex,
            $y,
            ['Summary', 'Amount'],
            [330, 181],
            $summary,
            [1],
            [4],
            $pageHeaders
        );

        $historical = [];
        foreach (($statement['historical'] ?? []) as $entry) {
            if (is_array($entry)) {
                $historical[] = [
                    'Opening balance',
                    self::value($entry, 'source_reference', 'N/A'),
                    self::date($entry['original_date'] ?? null),
                    self::money($entry['amount'] ?? 0, $currency),
                ];
            }
        }
        self::drawTable(
            $pages,
            $pageIndex,
            $y,
            ['Historical debt', 'Source reference', 'Original date', 'Amount'],
            [112, 204, 91, 104],
            $historical !== [] ? $historical : [['No historical debt entries', '', '', '']],
            [3],
            [],
            $pageHeaders
        );

        $transactions = [];
        foreach (($statement['transactions'] ?? []) as $transaction) {
            if (!is_array($transaction) || ($transaction['status'] ?? null) !== 'approved') {
                continue;
            }
            $id = (int) ($transaction['id'] ?? 0);
            $transactions[] = [
                self::date($transaction['consumption_date'] ?? null),
                'HH-' . str_pad((string) $id, 8, '0', STR_PAD_LEFT),
                self::services(is_array($transaction['items'] ?? null) ? $transaction['items'] : []),
                self::money($transaction['total_amount'] ?? 0, $currency),
            ];
        }
        self::drawTable(
            $pages,
            $pageIndex,
            $y,
            ['Date', 'Transaction', 'Services', 'Amount'],
            [75, 96, 235, 105],
            $transactions !== [] ? $transactions : [['No approved credit transactions', '', '', '']],
            [3],
            [],
            $pageHeaders
        );

        $payments = [];
        foreach (($statement['payments'] ?? []) as $payment) {
            if (is_array($payment)) {
                $payments[] = [
                    self::date($payment['payment_date'] ?? null),
                    self::value($payment, 'receipt_number', 'N/A'),
                    ($payment['method'] ?? '') === 'bank_transfer' ? 'Bank transfer' : 'Cash',
                    self::money($payment['amount'] ?? 0, $currency),
                    self::money($payment['remaining_balance'] ?? 0, $currency),
                ];
            }
        }
        self::drawTable(
            $pages,
            $pageIndex,
            $y,
            ['Date', 'Receipt', 'Method', 'Amount', 'Balance after'],
            [76, 130, 93, 105, 107],
            $payments !== [] ? $payments : [['No payments recorded', '', '', '', '']],
            [3, 4],
            [],
            $pageHeaders
        );

        $footer = self::value(
            $settings,
            'receipt_footer',
            'Thank you for choosing Haroni Hotel. This statement is system generated.'
        );
        $pageCount = count($pages);
        foreach ($pages as $index => &$page) {
            $page .= self::line(42, 44, self::PAGE_WIDTH - 42, 44, self::GOLD, 0.4);
            $page .= self::text(
                self::fitText($footer, 350, 6.5),
                42,
                27,
                6.5,
                'F1',
                self::MUTED
            );
            $page .= self::rightText(
                'Generated ' . date('d M Y, H:i') . '  |  Page ' . ($index + 1) . ' of ' . $pageCount,
                self::PAGE_WIDTH - 42,
                27,
                6.5,
                'F1',
                self::MUTED
            );
        }
        unset($page);

        return self::buildPdf($pages, $logo, (int) $imageInfo[0], (int) $imageInfo[1]);
    }

    private static function pageHeader(array $hotel, string $subtitle, bool $continued): string
    {
        $stream = self::rectangle(0, 742, self::PAGE_WIDTH, 100, self::INK);
        $stream .= "q 64 0 0 64 32 760 cm /Im1 Do Q\n";
        $hotelName = self::fitText($hotel['name'], 435, 23, 12);
        $stream .= self::text(
            strtoupper($hotelName),
            115,
            808,
            self::fittedFontSize($hotelName, 435, 23, 12),
            'F3',
            self::GOLD
        );
        $stream .= self::text(
            self::fitText($hotel['address'], 435, 7.5),
            116,
            789,
            7.5,
            'F1',
            [238, 230, 211]
        );
        $contact = $hotel['phone'] . '  |  ' . $hotel['email'];
        $stream .= self::text(
            self::fitText($contact, 435, 7.5),
            116,
            776,
            7.5,
            'F1',
            [238, 230, 211]
        );
        $stream .= self::text('TIN ' . self::clean($hotel['tin']), 116, 762, 7.5, 'F1', [238, 230, 211]);
        $stream .= self::line(0, 742, self::PAGE_WIDTH, 742, self::GOLD, 1);
        $stream .= self::text(
            $continued ? 'GUEST DEBT STATEMENT - CONTINUED' : 'GUEST DEBT STATEMENT',
            42,
            711,
            15,
            'F2',
            self::INK
        );
        $stream .= self::text(
            self::fitText($subtitle, self::TABLE_WIDTH, 8.5),
            42,
            692,
            8.5,
            'F1',
            self::MUTED
        );
        $stream .= self::line(42, 680, self::PAGE_WIDTH - 42, 680, self::GOLD, 0.7);
        return $stream;
    }

    private static function drawTable(
        array &$pages,
        int &$pageIndex,
        float &$y,
        array $headers,
        array $widths,
        array $rows,
        array $rightColumns,
        array $highlightRows,
        array $pageHeaders
    ): void {
        $headerHeight = 23.0;
        if ($y - $headerHeight - 22 < self::BODY_BOTTOM) {
            self::nextPage($pages, $pageIndex, $y, $pageHeaders);
        }
        $y -= $headerHeight;
        $pages[$pageIndex] .= self::rectangle(self::TABLE_LEFT, $y, self::TABLE_WIDTH, $headerHeight, self::INK);
        $x = self::TABLE_LEFT;
        foreach ($headers as $index => $header) {
            $pages[$pageIndex] .= self::text(
                $header,
                $x + 6,
                $y + 8,
                8,
                'F2',
                self::GOLD
            );
            $x += $widths[$index];
        }
        $pages[$pageIndex] .= self::tableRules($y, $headerHeight, $widths);

        foreach ($rows as $rowIndex => $row) {
            $row = array_pad($row, count($widths), '');
            $wrapped = [];
            foreach ($widths as $columnIndex => $width) {
                $maxChars = max(8, (int) floor(($width - 12) / (8 * 0.52)));
                $wrapped[] = self::wrap(self::ascii((string) $row[$columnIndex]), $maxChars);
            }
            $maxLines = max(array_map('count', $wrapped));
            for ($offset = 0; $offset < $maxLines; $offset += 6) {
                $lineCount = min(6, $maxLines - $offset);
                $rowHeight = max(22.0, $lineCount * 9.0 + 8.0);
                if ($y - $rowHeight < self::BODY_BOTTOM) {
                    self::nextPage($pages, $pageIndex, $y, $pageHeaders);
                    self::drawRepeatedHeader($pages, $pageIndex, $y, $headers, $widths);
                }
                $y -= $rowHeight;
                $highlight = in_array($rowIndex, $highlightRows, true);
                $fill = $highlight ? self::PALE_GOLD : ($rowIndex % 2 === 0 ? self::CREAM : [255, 255, 255]);
                $pages[$pageIndex] .= self::rectangle(self::TABLE_LEFT, $y, self::TABLE_WIDTH, $rowHeight, $fill);
                $x = self::TABLE_LEFT;
                foreach ($widths as $columnIndex => $width) {
                    $visibleLines = array_slice($wrapped[$columnIndex], $offset, 6);
                    foreach ($visibleLines as $lineIndex => $line) {
                        $baseline = $y + $rowHeight / 2 + (count($visibleLines) - 1) * 4.5 - $lineIndex * 9 - 3;
                        if (in_array($columnIndex, $rightColumns, true)) {
                            $pages[$pageIndex] .= self::rightText(
                                $line,
                                $x + $width - 6,
                                $baseline,
                                7.8,
                                $highlight ? 'F2' : 'F1',
                                self::INK
                            );
                        } else {
                            $pages[$pageIndex] .= self::text(
                                $line,
                                $x + 6,
                                $baseline,
                                7.8,
                                $highlight ? 'F2' : 'F1',
                                self::INK
                            );
                        }
                    }
                    $x += $width;
                }
                $pages[$pageIndex] .= self::tableRules($y, $rowHeight, $widths);
            }
        }
        $y -= 12;
    }

    private static function drawRepeatedHeader(array &$pages, int $pageIndex, float &$y, array $headers, array $widths): void
    {
        $headerHeight = 23.0;
        $y -= $headerHeight;
        $pages[$pageIndex] .= self::rectangle(self::TABLE_LEFT, $y, self::TABLE_WIDTH, $headerHeight, self::INK);
        $x = self::TABLE_LEFT;
        foreach ($headers as $index => $header) {
            $pages[$pageIndex] .= self::text($header, $x + 6, $y + 8, 8, 'F2', self::GOLD);
            $x += $widths[$index];
        }
        $pages[$pageIndex] .= self::tableRules($y, $headerHeight, $widths);
    }

    private static function nextPage(array &$pages, int &$pageIndex, float &$y, array $pageHeaders): void
    {
        $pageIndex++;
        $pages[] = $pageHeaders[1];
        $y = 666.0;
    }

    private static function tableRules(float $bottom, float $height, array $widths): string
    {
        $stream = self::line(
            self::TABLE_LEFT,
            $bottom,
            self::TABLE_LEFT + self::TABLE_WIDTH,
            $bottom,
            [222, 211, 190],
            0.35
        );
        $stream .= self::line(
            self::TABLE_LEFT,
            $bottom + $height,
            self::TABLE_LEFT + self::TABLE_WIDTH,
            $bottom + $height,
            [222, 211, 190],
            0.35
        );
        $x = self::TABLE_LEFT;
        $stream .= self::line($x, $bottom, $x, $bottom + $height, [222, 211, 190], 0.35);
        foreach ($widths as $width) {
            $x += $width;
            $stream .= self::line($x, $bottom, $x, $bottom + $height, [222, 211, 190], 0.35);
        }
        return $stream;
    }

    private static function buildPdf(array $pages, string $logo, int $imageWidth, int $imageHeight): string
    {
        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>',
            '<< /Type /XObject /Subtype /Image /Width ' . $imageWidth
                . ' /Height ' . $imageHeight
                . ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '
                . strlen($logo) . " >>\nstream\n" . $logo . "\nendstream",
        ];
        $pageReferences = [];
        foreach ($pages as $page) {
            $pageObject = count($objects) + 1;
            $contentObject = $pageObject + 1;
            $pageReferences[] = $pageObject . ' 0 R';
            $objects[] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
                . '/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> '
                . '/XObject << /Im1 6 0 R >> >> /Contents ' . $contentObject . ' 0 R >>';
            $objects[] = '<< /Length ' . strlen($page) . " >>\nstream\n" . $page . 'endstream';
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
        $pdf .= "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R >>\n";
        return $pdf . "startxref\n" . $xrefOffset . "\n%%EOF\n";
    }

    private static function services(array $items): string
    {
        $services = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $quantity = rtrim(rtrim(number_format((float) ($item['quantity'] ?? 0), 3, '.', ''), '0'), '.');
            $services[] = self::value($item, 'service_name', 'Service') . ' x' . $quantity;
        }
        return $services !== [] ? implode(', ', $services) : 'No service details';
    }

    private static function value(array $data, string $key, string $fallback = ''): string
    {
        $value = $data[$key] ?? null;
        return is_scalar($value) && trim((string) $value) !== '' ? trim((string) $value) : $fallback;
    }

    private static function money(mixed $value, string $currency): string
    {
        return number_format((float) $value, 2, '.', ',') . ' ' . $currency;
    }

    private static function date(mixed $value): string
    {
        if (!is_scalar($value) || trim((string) $value) === '') {
            return 'N/A';
        }
        $timestamp = strtotime((string) $value);
        return $timestamp === false ? (string) $value : date('d M Y', $timestamp);
    }

    private static function fittedFontSize(string $text, float $maxWidth, float $preferred, float $minimum): float
    {
        $length = max(strlen(self::ascii($text)), 1);
        return max($minimum, min($preferred, $maxWidth / ($length * 0.54)));
    }

    private static function fitText(string $text, float $maxWidth, float $fontSize): string
    {
        $text = self::clean(self::ascii($text));
        $length = strlen($text);
        if ($length * $fontSize * 0.54 <= $maxWidth) {
            return $text;
        }
        $maximumCharacters = max(1, (int) floor($maxWidth / ($fontSize * 0.54)));
        return rtrim(substr($text, 0, max(1, $maximumCharacters - 3))) . '...';
    }

    private static function wrap(string $text, int $limit): array
    {
        $text = trim(preg_replace('/\s+/', ' ', self::clean($text)) ?? '');
        return $text === '' ? [''] : explode("\n", wordwrap($text, $limit, "\n", true));
    }

    private static function clean(string $value): string
    {
        return trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', $value) ?? '');
    }

    private static function ascii(string $value): string
    {
        if (function_exists('iconv')) {
            $converted = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
            if ($converted !== false) {
                return $converted;
            }
        }
        return preg_replace('/[^\x20-\x7E]/', '?', $value) ?? '';
    }

    private static function color(array $rgb): string
    {
        return implode(' ', array_map(
            static fn(int $channel): string => number_format($channel / 255, 3, '.', ''),
            $rgb
        ));
    }

    private static function number(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private static function rectangle(float $x, float $y, float $width, float $height, array $color): string
    {
        return 'q ' . self::color($color) . ' rg '
            . self::number($x) . ' ' . self::number($y) . ' '
            . self::number($width) . ' ' . self::number($height)
            . " re f Q\n";
    }

    private static function line(float $x1, float $y1, float $x2, float $y2, array $color, float $width): string
    {
        return 'q ' . self::color($color) . ' RG ' . self::number($width) . ' w '
            . self::number($x1) . ' ' . self::number($y1) . ' m '
            . self::number($x2) . ' ' . self::number($y2) . " l S Q\n";
    }

    private static function text(
        string $text,
        float $x,
        float $y,
        float $fontSize,
        string $font,
        array $color
    ): string {
        return 'BT /' . $font . ' ' . self::number($fontSize) . ' Tf '
            . self::color($color) . ' rg 1 0 0 1 '
            . self::number($x) . ' ' . self::number($y)
            . ' Tm (' . self::escape(self::ascii($text)) . ") Tj ET\n";
    }

    private static function rightText(
        string $text,
        float $right,
        float $y,
        float $fontSize,
        string $font,
        array $color
    ): string {
        $estimatedWidth = strlen(self::ascii($text)) * $fontSize * 0.52;
        return self::text($text, $right - $estimatedWidth, $y, $fontSize, $font, $color);
    }

    private static function escape(string $value): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
    }
}
