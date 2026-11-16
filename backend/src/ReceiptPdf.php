<?php
declare(strict_types=1);

namespace Haroni\Dcms;

use RuntimeException;

final class ReceiptPdf
{
    private const PAGE_WIDTH = 420.0;
    private const PAGE_HEIGHT = 595.0;
    private const INK = [28, 25, 20];
    private const GOLD = [184, 146, 62];
    private const MUTED = [110, 104, 92];
    private const CREAM = [248, 245, 238];
    private const PALE_GOLD = [248, 242, 226];

    public static function render(array $payment): string
    {
        $logoPath = DCMS_ROOT . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'haroni-emblem.jpg';
        if (!is_file($logoPath)) {
            throw new RuntimeException('The Haroni Hotel receipt logo could not be loaded.');
        }
        $logo = file_get_contents($logoPath);
        $imageInfo = getimagesize($logoPath);
        if (!is_string($logo) || !is_array($imageInfo) || ($imageInfo['mime'] ?? null) !== 'image/jpeg') {
            throw new RuntimeException('The Haroni Hotel receipt logo could not be loaded.');
        }

        $hotelName = self::value($payment, 'hotel_name', 'Haroni Hotel');
        $hotelAddress = self::value($payment, 'hotel_address', 'Bole Road, Addis Ababa, Ethiopia');
        $hotelPhone = self::value($payment, 'hotel_phone', '+251 11 661 2020');
        $hotelEmail = self::value($payment, 'hotel_email', 'finance@haronihotel.com');
        $hotelTin = self::value($payment, 'hotel_tin', '0012345678');
        $receiptNumber = self::value($payment, 'receipt_number', 'N/A');
        $method = strtolower(self::value($payment, 'method'));
        $rows = [
            ['Receipt number', $receiptNumber],
            ['Guest full name', self::value($payment, 'full_name', 'N/A')],
            ['Guest phone number', self::value($payment, 'phone', 'Not provided')],
            ['Payment date', self::paymentDate($payment['payment_date'] ?? null)],
            ['Payment method', $method === 'bank_transfer' ? 'Bank transfer' : 'Cash'],
        ];
        if ($method === 'bank_transfer') {
            $rows[] = ['Bank reference', self::value($payment, 'reference_number', 'N/A')];
        }
        $rows = array_merge($rows, [
            ['Previous outstanding debt', self::money($payment['previous_balance'] ?? 0)],
            ['Payment amount', self::money($payment['amount'] ?? 0)],
            ['Remaining outstanding debt', self::money($payment['remaining_balance'] ?? 0)],
            ['Recorded by (Finance Manager)', self::value(
                $payment,
                'recorded_by',
                self::value($payment, 'finance_manager', 'N/A')
            )],
            ['Payment status', 'Verified - received by the hotel'],
        ]);

        $stream = self::rectangle(0, 490, self::PAGE_WIDTH, 105, self::INK);
        $stream .= sprintf(
            "q 62 0 0 62 24 510 cm /Im1 Do Q\n"
        );
        $stream .= self::text(
            strtoupper(self::clean($hotelName)),
            102,
            558,
            self::fittedFontSize($hotelName, 285, 22, 12),
            'F3',
            self::GOLD
        );
        $stream .= self::text(self::clean($hotelAddress), 103, 536, 8, 'F1', [238, 230, 211]);
        $stream .= self::text(
            self::clean($hotelPhone) . '  |  ' . self::clean($hotelEmail),
            103,
            522,
            7.5,
            'F1',
            [238, 230, 211]
        );
        $stream .= self::text('TIN ' . self::clean($hotelTin), 103, 508, 7.5, 'F1', [238, 230, 211]);
        $stream .= self::line(0, 490, self::PAGE_WIDTH, 490, self::GOLD, 1.2);

        $stream .= self::text('PAYMENT RECEIPT', 28, 462, 16, 'F2', self::INK);
        $stream .= self::text('Receipt No. ' . self::clean($receiptNumber), 28, 445, 8.5, 'F1', self::MUTED);
        $stream .= self::line(28, 435, self::PAGE_WIDTH - 28, 435, self::GOLD, 0.8);

        $y = 421.0;
        foreach ($rows as $index => [$label, $value]) {
            $valueLines = self::wrap(self::clean((string) $value), 40);
            $rowHeight = max(20.0, count($valueLines) * 10.0 + 8.0);
            $bottom = $y - $rowHeight;
            $fill = $index % 2 === 0 ? self::CREAM : [255, 255, 255];
            $stream .= self::rectangle(28, $bottom, self::PAGE_WIDTH - 56, $rowHeight, $fill);
            $stream .= self::text((string) $label, 35, $bottom + $rowHeight / 2 - 3, 8, 'F1', self::MUTED);
            $lineCount = count($valueLines);
            foreach ($valueLines as $lineIndex => $line) {
                $stream .= self::text(
                    $line,
                    188,
                    $bottom + $rowHeight / 2 + ($lineCount - 1) * 4.5 - $lineIndex * 9 - 3,
                    8.5,
                    'F2',
                    $label === 'Payment status' ? [73, 91, 56] : self::INK
                );
            }
            $stream .= self::line(28, $bottom, self::PAGE_WIDTH - 28, $bottom, [230, 222, 205], 0.25);
            $y = $bottom;
        }

        $summaryBottom = max(84.0, $y - 60.0);
        $summaryHeight = 42.0;
        $stream .= self::rectangle(28, $summaryBottom, self::PAGE_WIDTH - 56, $summaryHeight, self::PALE_GOLD);
        $stream .= self::line(
            28,
            $summaryBottom,
            self::PAGE_WIDTH - 28,
            $summaryBottom,
            self::GOLD,
            0.55
        );
        $stream .= self::text('AMOUNT PAID', 42, $summaryBottom + 25, 8.5, 'F1', self::MUTED);
        $stream .= self::rightText(
            self::money($payment['amount'] ?? 0),
            self::PAGE_WIDTH - 42,
            $summaryBottom + 15,
            15,
            'F2',
            self::INK
        );

        $customFooter = trim(self::clean(self::value($payment, 'receipt_footer')));
        $stream .= self::line(28, 65, self::PAGE_WIDTH - 28, 65, self::GOLD, 0.45);
        if ($customFooter !== '') {
            $customLines = self::wrap($customFooter, 96);
            foreach (array_slice($customLines, 0, 2) as $index => $line) {
                $stream .= self::text($line, 28, 54 - $index * 8, 6.5, 'F1', self::MUTED);
            }
        }
        $stream .= self::text(
            'Thank you for choosing Haroni Hotel. This receipt confirms a payment',
            28,
            37,
            6.5,
            'F1',
            self::INK
        );
        $stream .= self::text('verified by Haroni Hotel.', 28, 28, 6.5, 'F1', self::INK);
        $generatedAt = date('d M Y, H:i T');
        $footerText = 'Generated ' . $generatedAt . '  |  Page 1 of 1';
        $stream .= self::rightText($footerText, self::PAGE_WIDTH - 28, 15, 6.5, 'F1', self::MUTED);

        return self::buildPdf($stream, $logo, (int) $imageInfo[0], (int) $imageInfo[1]);
    }

    private static function buildPdf(string $stream, string $logo, int $imageWidth, int $imageHeight): string
    {
        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] '
                . '/Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> /XObject << /Im1 7 0 R >> >> '
                . '/Contents 8 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>',
            '<< /Type /XObject /Subtype /Image /Width ' . $imageWidth
                . ' /Height ' . $imageHeight
                . ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '
                . strlen($logo) . " >>\nstream\n" . $logo . "\nendstream",
            '<< /Length ' . strlen($stream) . " >>\nstream\n" . $stream . 'endstream',
        ];
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
        $pdf .= "startxref\n" . $xrefOffset . "\n%%EOF\n";
        return $pdf;
    }

    private static function rectangle(
        float $x,
        float $y,
        float $width,
        float $height,
        array $color
    ): string {
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

    private static function value(array $data, string $key, string $fallback = ''): string
    {
        $value = $data[$key] ?? null;
        return is_scalar($value) && trim((string) $value) !== '' ? trim((string) $value) : $fallback;
    }

    private static function money(mixed $value): string
    {
        return number_format((float) $value, 2, '.', ',') . ' ETB';
    }

    private static function paymentDate(mixed $value): string
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

    private static function wrap(string $text, int $limit): array
    {
        $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');
        if ($text === '') {
            return ['-'];
        }
        return explode("\n", wordwrap($text, $limit, "\n", true));
    }

    private static function clean(string $value): string
    {
        return trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', $value) ?? '');
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

    private static function escape(string $value): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
    }
}
