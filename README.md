# Haroni Hotel DCMS backend

Pure PHP 8.1+ JSON API backed by MySQL 8.0.16+, with the role-based browser UI in `frontend/`. Backend application files are in `backend/`, and the database schema is in `database/schema.sql`. The web document root must be `backend/public/`; application code, configuration, and `.env` must remain outside the document root.

## Install

1. Create a MySQL database and application user. Run `database/schema.sql` as a database administrator. The schema creates `haroni_dcms`, its tables, constraints, initial service categories, and the ETB 11,000,000 historical-debt reconciliation target.
2. Copy `backend/.env.example` to `backend/.env` and set `DB_DSN`, `DB_USERNAME`, and `DB_PASSWORD`. Use a dedicated database account. Configure `DCMS_BACKUP_DIR` as an absolute path outside the project and document root, and make it writable only by the backend service account. Install `mysqldump` where the backend can run it and configure `DCMS_BACKUP_DB_USERNAME` and `DCMS_BACKUP_DB_PASSWORD` for backup access. After importing the schema, grant the application only the required `SELECT`, `INSERT`, and `UPDATE` privileges, with `DELETE` limited to `login_attempts`, `confirmation_pin_attempts`, `credit_transaction_items`, and `notifications`. These are needed for rate-limit cleanup, notification management, and correcting disputed, unapproved transactions; database triggers prevent deletion or editing of posted financial records. For an existing installation whose application user is `dcms_app`@`localhost`, a database administrator can enable notification deletion with `GRANT DELETE ON haroni_dcms.notifications TO 'dcms_app'@'localhost';`. Existing installations must apply any pending scripts in `database/migrations/` once, including `001-add-pin-attempt-updated-at.sql`, `002-add-admin-profile-settings.sql`, `003-transaction-special-price-requests.sql`, `004-allow-special-price-status-transitions.sql`, and `005-add-owner-role.sql`.
3. Configure Apache with `mod_rewrite` and `AllowOverride All`, or configure an equivalent Nginx front controller. Point the site root at `backend/public/` and serve it only over HTTPS.
4. Configure PHP with `pdo_mysql`, `mbstring`, and sessions. `iconv` is optional; without it, non-ASCII receipt and report text is replaced with ASCII placeholders.
5. Create the first System Administrator once. In PowerShell, enter a 12-72 byte password using a secure prompt and remove the temporary environment variables immediately afterward:

   ```powershell
   $env:DCMS_BOOTSTRAP_USERNAME = 'dcms-admin'
   $env:DCMS_BOOTSTRAP_FULL_NAME = 'System Administrator'
   $secure = Read-Host 'Initial administrator password (12-72 bytes)' -AsSecureString
   $env:DCMS_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
   php .\backend\bin\create-first-admin.php
   Remove-Item Env:\DCMS_BOOTSTRAP_USERNAME, Env:\DCMS_BOOTSTRAP_FULL_NAME, Env:\DCMS_BOOTSTRAP_PASSWORD
   ```

   The bootstrap script refuses to run once any administrator exists. Do not retain the initial password in shell history or deployment logs.

6. To provision the first Hotel Owner on an existing installation, run the Owner bootstrap once after applying the Owner-role migration, using the same secure environment-variable method with `php .\backend\bin\create-first-owner.php`. The script refuses to run if an Owner already exists. Owners can create additional Owner accounts from User Management; Finance Managers cannot assign Owner or System Administrator roles.

## API conventions

- All endpoints are under `/api`. Requests with a body must use `Content-Type: application/json`.
- Login creates a server-side session and returns a CSRF token. Send it in `X-CSRF-Token` for every state-changing request. Keep the session cookie and CSRF token private; the API does not enable cross-origin access.
- Monetary values must be JSON strings with up to two decimal places (for example `"250.00"`). Quantities may be JSON strings or integers with up to three decimal places. Passwords must be 12-72 bytes because the built-in password hash may use bcrypt.
- User roles are `system_administrator`, `owner`, `cashier`, `finance_manager`, and `guest`. Owners have both Cashier and Finance Manager access. Guest endpoints enforce ownership in the service layer.
- Errors use `{"error":"...","details":{}}`. API responses and receipts are marked non-cacheable.

### Authentication and account management

| Method | Path | Role |
|---|---|---|
| POST | `/api/login` | Public |
| POST | `/api/logout` | Authenticated |
| GET | `/api/me` | Authenticated |
| GET | `/api/dashboard[?view=finance\|cashier]` | Authenticated (role-specific; Owner can switch views) |
| POST | `/api/profile/password` | Authenticated |
| POST | `/api/users` | System Administrator, Finance Manager, Owner (role restrictions apply) |
| GET | `/api/users` | System Administrator, Finance Manager, Owner |
| POST | `/api/users/{id}/profile` | System Administrator, Finance Manager, Owner (role restrictions apply) |
| POST | `/api/users/{id}/status` | System Administrator, Finance Manager, Owner (role restrictions apply) |
| POST | `/api/users/{id}/password` | System Administrator, Finance Manager, Owner (role restrictions apply) |
| GET | `/api/system-settings` | System Administrator, Finance Manager, Owner |
| POST | `/api/system-settings` | System Administrator, Finance Manager, Owner |
| GET, POST | `/api/backups` | System Administrator, Finance Manager, Owner |
| GET | `/api/backups/{filename}` | System Administrator, Finance Manager, Owner |
| POST | `/api/system-settings/confirmation-deadline` | System Administrator, Finance Manager, Owner |
| POST | `/api/system-settings/hotel-profile` | System Administrator, Finance Manager, Owner |
| POST | `/api/profile/confirmation-pin` | Guest |

System Administrators, Finance Managers, and Owners can create guest and staff accounts; Finance Managers cannot create, assign, or manage System Administrator or Owner accounts. New guest accounts start with a zero credit limit; Finance Managers and Owners can assign or change a limit. Privileged-account password resets return a one-time generated temporary password and require it to be changed at next login. Guests set their own in-person confirmation PIN after authenticating with their current password; only its password hash is stored.

### Guests, catalog, and credit workflow

| Method | Path | Role |
|---|---|---|
| GET | `/api/guests[?q=...]` | Cashier, Finance Manager, Owner |
| GET | `/api/credit-account` | Guest (own account) |
| GET | `/api/credit-account/{guestId}` | Finance Manager, Owner |
| POST | `/api/guests/{guestId}/credit-limit` | Finance Manager, Owner |
| GET | `/api/service-catalog` | Authenticated |
| GET | `/api/service-categories` | System Administrator, Cashier, Finance Manager, Owner |
| POST | `/api/service-categories` | System Administrator, Finance Manager, Owner |
| POST | `/api/service-categories/{id}` | System Administrator, Finance Manager, Owner |
| POST | `/api/service-catalog` | System Administrator, Finance Manager, Owner |
| POST | `/api/service-catalog/{serviceId}/profile` | System Administrator, Finance Manager, Owner |
| POST | `/api/service-catalog/{serviceId}/status` | System Administrator, Finance Manager, Owner |
| GET | `/api/service-catalog/{serviceId}/price-history` | System Administrator, Finance Manager, Owner |
| POST | `/api/service-catalog/{serviceId}/price-requests` | System Administrator, Finance Manager, Owner |
| GET | `/api/service-price-requests` | Finance Manager, Owner |
| POST | `/api/service-price-requests/{id}/approve` or `/reject` | Finance Manager, Owner |
| GET | `/api/transactions[?status=...]` | Guest, Cashier, Finance Manager, Owner |

Cashier guest search returns guest identity and account status only; credit figures are restricted to Finance Manager and Owner endpoints. Credit-limit checks are performed by the backend when a transaction is submitted.
| POST | `/api/transactions` | Cashier, Owner |
| POST | `/api/transactions/{id}/draft` | Creating Cashier, Owner |
| POST | `/api/transactions/{id}/submit` | Creating Cashier, Owner |
| POST | `/api/transactions/{id}/confirm` or `/dispute` | Owning Guest |
| POST | `/api/transactions/{id}/resubmit` | Creating Cashier, Owner |
| POST | `/api/transactions/confirm-in-person` | Cashier, Owner (guest PIN required) |
| POST | `/api/transactions/{id}/approve` or `/reject` | Finance Manager, Owner |
| POST | `/api/transactions/{id}/cancel` | Cashier, Finance Manager, Owner |
| GET | `/api/transactions/{id}` | Owning Guest/Cashier, Finance Manager, Owner |

Create a transaction with `guest_id`, `consumption_date` (`YYYY-MM-DD`), and `items` containing only `service_id` and `quantity`. The server reads the current catalog price and service name; clients cannot submit a unit price. A newly created catalog service stays inactive until its initial price is approved by a Finance Manager. Status transitions are enforced by the service layer. Disputes require a reason and keep their reservation until corrected and reconfirmed, cancelled, or otherwise resolved. Exceptional credit approvals require a Finance Manager reason.

### Payments, historical debt, and reports

| Method | Path | Role |
|---|---|---|
| POST | `/api/payments` | Finance Manager, Owner |
| POST | `/api/payments/{id}/verify` or `/reject` | Finance Manager, Owner |
| GET | `/api/payments` | Guest (own), Finance Manager, Owner |
| GET | `/api/payments/{id}/receipt` | Guest (own), Finance Manager, Owner |
| POST | `/api/historical-debts` | Finance Manager, Owner |
| POST | `/api/historical-debts/import` | Finance Manager, Owner |
| GET | `/api/historical-debts` and `/reconciliation` | Finance Manager, Owner |
| POST | `/api/historical-debts/{id}/verify` or `/reject` | Finance Manager, Owner |
| POST | `/api/system-settings/historical-debt-target` | System Administrator, Finance Manager, Owner |
| POST | `/api/financial-adjustments` | Finance Manager, Owner |
| POST | `/api/financial-adjustments/{id}/reverse` | Finance Manager, Owner |
| GET | `/api/guests/{id}/statement`, `/statement.xls`, or `/statement.pdf` | Guest (own), Finance Manager, Owner |
| GET | `/api/reports/financial-summary?period=daily\|weekly\|monthly\|yearly` | Finance Manager, Owner |
| GET | `/api/reports/financial-summary.xls` or `/financial-summary.pdf` | Finance Manager, Owner |
| GET | `/api/reports/{payments\|transactions\|historical-debts}[.xls\|.pdf]?period=...` | Finance Manager, Owner |
| GET | `/api/reports/guest-debts[.xls\|.pdf]` | Finance Manager, Owner |
| GET | `/api/audit-logs` | System Administrator, Finance Manager, Owner |
| GET | `/api/notifications` | Authenticated |
| POST | `/api/notifications/{id}/read` or `/api/notifications/{id}/delete` | Owning User |
| POST | `/api/notifications/clear` | Authenticated User (own notifications) |

Payments remain pending until verified, and verification cannot reduce debt below zero. Verified payments generate downloadable PDF receipts with their balance snapshots. Historical debt is entered as a separate pending opening balance with a supporting reference; only verified entries affect debt or reconciliation. `/api/guests/{id}/statement.xls` produces an Excel-compatible XML workbook.

## Financial and operational controls

- Outstanding debt is calculated from verified opening balances, approved credits, verified payments, and signed Finance Manager adjustments.
- Available credit is `max(0, credit limit - outstanding debt - pending reservations)`. Pending guest confirmations, disputes, and Finance approvals reserve credit; expired guest-confirmation reservations are excluded.
- Credit-account rows are locked while posting balance-affecting actions to serialize concurrent submissions, approvals, payments, and adjustments.
- Database triggers prevent deletion or post-approval mutation of approved credit records, verified payments/opening balances, adjustments, and audit entries. Corrections use audited cancellation or financial adjustments/reversals.
- In-app confirmation reminders are created within the configured reminder-before-deadline window by the scheduled expiration job. Set the window to `0` to disable these reminders, and configure the job to run periodically (for example, once every five minutes):

  ```powershell
  php .\backend\bin\expire-pending.php
  ```

- Back up MySQL regularly and test restoration. Keep TLS, database credentials, backups, and PHP error logs outside public access.
- System Administrators can create and download backups from the browser. Files are stored outside the project in `DCMS_BACKUP_DIR`, restricted to the backend service account, and include a SHA-256 sidecar; browser downloads are integrity-checked and audited. Configure dedicated `DCMS_BACKUP_DB_USERNAME` and `DCMS_BACKUP_DB_PASSWORD` credentials for backups instead of granting dump privileges to the web application database account.
- The dedicated backup account needs `SELECT`, `SHOW VIEW`, `TRIGGER`, and `EVENT` on the application database so `mysqldump` can include its data and schema objects. Match the account host to the host in `DB_DSN`. `TRIGGER` and `EVENT` are not strictly read-only privileges, so keep this account separate from the application login and restrict it to this database. For example, a database administrator can run:

  ```sql
  CREATE USER 'dcms_backup'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_SECRET';
  GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `haroni_dcms`.* TO 'dcms_backup'@'127.0.0.1';
  ```

  Set `DCMS_BACKUP_DB_USERNAME=dcms_backup` and `DCMS_BACKUP_DB_PASSWORD` to the same secret in `backend/.env`, then restart the PHP server. If the database contains stored routines, grant the engine-specific privilege needed to inspect routine definitions as well.
- Restore remains CLI-only. It verifies the checksum, prompts for the database name, and refuses to import into a database that already contains tables. Configure the MySQL `mysql` client for the maintenance operator; never expose restore credentials or privileges to the browser.
- Create a backup with `php .\backend\bin\backup-database.php`. To restore, prepare an empty target database and its matching `DB_DSN`, then run `php .\backend\bin\restore-database.php haroni-dcms-YYYYMMDD-HHMMSS-xxxxxxxx.sql` using the exact backup filename and type the target database name when prompted.
- Payment, credit-transaction, and historical-debt reports are period-scoped (daily, weekly, monthly, or yearly); guest-debt reports show current balances. Each detail report is limited to the most recent 5,000 matching records.

## Runtime limitations

The supplied specification allows SMS **or** in-app reminders; this backend implements in-app notifications and does not integrate an SMS gateway. The SMS reminder setting stores a preference only and does not send messages. Receipt and report PDFs use a built-in writer and standard fonts; non-Latin text is transliterated where possible and otherwise replaced with placeholders. Excel exports are Excel-compatible XML workbooks (`.xls`), not OOXML `.xlsx`. The browser UI, SMS gateway, and managed backup scheduler are not included; configure the expiration and backup CLI jobs with the hosting platform's scheduler.
