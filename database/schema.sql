CREATE DATABASE IF NOT EXISTS haroni_dcms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE haroni_dcms;

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    full_name VARCHAR(180) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('system_administrator','owner','cashier','finance_manager','guest') NOT NULL,
    phone VARCHAR(32) NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    auth_version INT UNSIGNED NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_role_status (role, is_active)
) ENGINE=InnoDB;

CREATE TABLE login_attempts (
    username_key CHAR(64) NOT NULL,
    ip_key CHAR(64) NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    first_failed_at DATETIME(6) NOT NULL,
    locked_until DATETIME(6) NULL,
    PRIMARY KEY (username_key, ip_key),
    KEY idx_login_attempts_lock (locked_until)
) ENGINE=InnoDB;

CREATE TABLE guest_accounts (
    user_id BIGINT UNSIGNED NOT NULL,
    full_name VARCHAR(180) NOT NULL,
    credit_limit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    CONSTRAINT chk_guest_credit_limit CHECK (credit_limit >= 0),
    CONSTRAINT fk_guest_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_guest_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE service_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_categories_name (name)
) ENGINE=InnoDB;

CREATE TABLE service_catalog (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(160) NOT NULL,
    current_price DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_catalog_name (name),
    CONSTRAINT chk_service_price CHECK (current_price >= 0),
    CONSTRAINT fk_service_category FOREIGN KEY (category_id) REFERENCES service_categories(id),
    CONSTRAINT fk_service_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE catalog_price_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_id BIGINT UNSIGNED NOT NULL,
    proposed_price DECIMAL(12,2) NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    requested_by BIGINT UNSIGNED NOT NULL,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(6) NULL,
    review_reason VARCHAR(1000) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT chk_catalog_proposed_price CHECK (proposed_price >= 0),
    CONSTRAINT fk_price_request_service FOREIGN KEY (service_id) REFERENCES service_catalog(id),
    CONSTRAINT fk_price_requester FOREIGN KEY (requested_by) REFERENCES users(id),
    CONSTRAINT fk_price_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE service_price_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_id BIGINT UNSIGNED NOT NULL,
    old_price DECIMAL(12,2) NOT NULL,
    new_price DECIMAL(12,2) NOT NULL,
    request_id BIGINT UNSIGNED NOT NULL,
    approved_by BIGINT UNSIGNED NOT NULL,
    approved_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_price_history_request (request_id),
    CONSTRAINT fk_price_history_service FOREIGN KEY (service_id) REFERENCES service_catalog(id),
    CONSTRAINT fk_price_history_request FOREIGN KEY (request_id) REFERENCES catalog_price_requests(id),
    CONSTRAINT fk_price_history_approver FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE credit_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guest_id BIGINT UNSIGNED NOT NULL,
    cashier_id BIGINT UNSIGNED NOT NULL,
    consumption_date DATE NOT NULL,
    status ENUM(
        'draft','pending_guest_confirmation','disputed','pending_price_approval','pending_finance_approval',
        'pending_exceptional_approval','approved','rejected','cancelled','expired'
    ) NOT NULL DEFAULT 'draft',
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    requires_exception BOOLEAN NOT NULL DEFAULT FALSE,
    confirmation_deadline DATETIME(6) NULL,
    guest_confirmed_at DATETIME(6) NULL,
    confirmation_method ENUM('portal','pin') NULL,
    confirmation_assisted_by BIGINT UNSIGNED NULL,
    dispute_reason VARCHAR(2000) NULL,
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME(6) NULL,
    exception_reason VARCHAR(2000) NULL,
    rejected_by BIGINT UNSIGNED NULL,
    rejection_reason VARCHAR(2000) NULL,
    cancelled_by BIGINT UNSIGNED NULL,
    cancellation_reason VARCHAR(2000) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_transactions_guest_status (guest_id, status, created_at),
    KEY idx_transactions_status_deadline (status, confirmation_deadline),
    CONSTRAINT chk_transaction_total CHECK (total_amount >= 0),
    CONSTRAINT fk_transaction_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id),
    CONSTRAINT fk_transaction_cashier FOREIGN KEY (cashier_id) REFERENCES users(id),
    CONSTRAINT fk_transaction_confirmer FOREIGN KEY (confirmation_assisted_by) REFERENCES users(id),
    CONSTRAINT fk_transaction_approver FOREIGN KEY (approved_by) REFERENCES users(id),
    CONSTRAINT fk_transaction_rejecter FOREIGN KEY (rejected_by) REFERENCES users(id),
    CONSTRAINT fk_transaction_canceller FOREIGN KEY (cancelled_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE credit_transaction_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    service_name_snapshot VARCHAR(160) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(15,2) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_transaction_items_transaction (transaction_id),
    CONSTRAINT chk_item_quantity CHECK (quantity > 0),
    CONSTRAINT chk_item_price CHECK (unit_price >= 0),
    CONSTRAINT chk_item_total CHECK (line_total >= 0),
    CONSTRAINT fk_item_transaction FOREIGN KEY (transaction_id) REFERENCES credit_transactions(id),
    CONSTRAINT fk_item_service FOREIGN KEY (service_id) REFERENCES service_catalog(id)
) ENGINE=InnoDB;

CREATE TABLE transaction_price_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id BIGINT UNSIGNED NOT NULL,
    transaction_item_id BIGINT UNSIGNED NOT NULL,
    service_id BIGINT UNSIGNED NOT NULL,
    catalog_price DECIMAL(12,2) NOT NULL,
    requested_price DECIMAL(12,2) NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    requested_by BIGINT UNSIGNED NOT NULL,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(6) NULL,
    review_reason VARCHAR(1000) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_transaction_price_item (transaction_item_id),
    KEY idx_transaction_price_status (status, created_at),
    CONSTRAINT chk_transaction_catalog_price CHECK (catalog_price >= 0),
    CONSTRAINT chk_transaction_requested_price CHECK (requested_price > 0),
    CONSTRAINT fk_transaction_price_transaction FOREIGN KEY (transaction_id) REFERENCES credit_transactions(id),
    CONSTRAINT fk_transaction_price_item FOREIGN KEY (transaction_item_id) REFERENCES credit_transaction_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_transaction_price_service FOREIGN KEY (service_id) REFERENCES service_catalog(id),
    CONSTRAINT fk_transaction_price_requester FOREIGN KEY (requested_by) REFERENCES users(id),
    CONSTRAINT fk_transaction_price_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE guest_confirmation_pins (
    guest_id BIGINT UNSIGNED NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (guest_id),
    CONSTRAINT fk_confirmation_pin_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id)
) ENGINE=InnoDB;

CREATE TABLE confirmation_pin_attempts (
    guest_id BIGINT UNSIGNED NOT NULL,
    ip_key CHAR(64) NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (guest_id, ip_key),
    CONSTRAINT fk_pin_attempt_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id)
) ENGINE=InnoDB;

CREATE TABLE payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guest_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    method ENUM('cash','bank_transfer') NOT NULL,
    reference_number VARCHAR(160) NULL,
    payment_date DATETIME(6) NOT NULL,
    status ENUM('pending_verification','verified','rejected') NOT NULL DEFAULT 'pending_verification',
    recorded_by BIGINT UNSIGNED NOT NULL,
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME(6) NULL,
    verification_reason VARCHAR(1000) NULL,
    receipt_number VARCHAR(40) NULL,
    previous_balance DECIMAL(15,2) NULL,
    remaining_balance DECIMAL(15,2) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_receipt (receipt_number),
    KEY idx_payments_guest_status (guest_id, status, payment_date),
    CONSTRAINT chk_payment_amount CHECK (amount > 0),
    CONSTRAINT chk_bank_reference CHECK (method <> 'bank_transfer' OR reference_number IS NOT NULL),
    CONSTRAINT fk_payment_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id),
    CONSTRAINT fk_payment_recorder FOREIGN KEY (recorded_by) REFERENCES users(id),
    CONSTRAINT fk_payment_verifier FOREIGN KEY (verified_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE opening_balances (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guest_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    applicable_from DATE NOT NULL,
    applicable_to DATE NULL,
    supporting_reference VARCHAR(1000) NOT NULL,
    status ENUM('pending_verification','verified','rejected') NOT NULL DEFAULT 'pending_verification',
    entered_by BIGINT UNSIGNED NOT NULL,
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME(6) NULL,
    verification_reason VARCHAR(1000) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_opening_guest_status (guest_id, status),
    CONSTRAINT chk_opening_amount CHECK (amount >= 0),
    CONSTRAINT chk_opening_dates CHECK (applicable_to IS NULL OR applicable_to >= applicable_from),
    CONSTRAINT fk_opening_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id),
    CONSTRAINT fk_opening_enterer FOREIGN KEY (entered_by) REFERENCES users(id),
    CONSTRAINT fk_opening_verifier FOREIGN KEY (verified_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE financial_adjustments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guest_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    reason VARCHAR(2000) NOT NULL,
    adjustment_type ENUM('adjustment','reversal') NOT NULL DEFAULT 'adjustment',
    reverses_adjustment_id BIGINT UNSIGNED NULL,
    approved_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_adjustment_reversal (reverses_adjustment_id),
    CONSTRAINT chk_adjustment_nonzero CHECK (amount <> 0),
    CONSTRAINT fk_adjustment_guest FOREIGN KEY (guest_id) REFERENCES guest_accounts(user_id),
    CONSTRAINT fk_adjustment_approver FOREIGN KEY (approved_by) REFERENCES users(id),
    CONSTRAINT fk_adjustment_reversal FOREIGN KEY (reverses_adjustment_id) REFERENCES financial_adjustments(id)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_id BIGINT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    details JSON NULL,
    ip_address VARBINARY(16) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_audit_entity (entity_type, entity_id, created_at),
    KEY idx_audit_actor_time (actor_id, created_at),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    related_transaction_id BIGINT UNSIGNED NULL,
    notification_type VARCHAR(60) NOT NULL,
    event_key VARCHAR(80) NOT NULL DEFAULT '',
    message VARCHAR(500) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    read_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_notification_event (user_id, related_transaction_id, notification_type, event_key),
    KEY idx_notifications_user_unread (user_id, read_at, created_at),
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_notification_transaction FOREIGN KEY (related_transaction_id) REFERENCES credit_transactions(id)
) ENGINE=InnoDB;

CREATE TABLE system_settings (
    setting_key VARCHAR(100) NOT NULL,
    setting_value VARCHAR(2000) NOT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (setting_key),
    CONSTRAINT fk_setting_updater FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;

INSERT INTO service_categories (name) VALUES
    ('Food'), ('Drinks'), ('Accommodation'), ('Other');

INSERT INTO system_settings (setting_key, setting_value) VALUES
    ('confirmation_deadline_hours', '24'),
    ('historical_debt_expected_total', '11000000.00'),
    ('hotel_name', 'Haroni Hotel'),
    ('hotel_address', ''),
    ('hotel_phone', ''),
    ('hotel_email', ''),
    ('hotel_tin', ''),
    ('currency', 'ETB'),
    ('reminder_before_hours', '4'),
    ('receipt_footer', ''),
    ('sms_reminders_enabled', '0');

DELIMITER //
CREATE TRIGGER prevent_approved_transaction_delete
BEFORE DELETE ON credit_transactions
FOR EACH ROW
BEGIN
    IF OLD.status = 'approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved financial transactions cannot be deleted';
    END IF;
END//

CREATE TRIGGER validate_new_credit_transaction
BEFORE INSERT ON credit_transactions
FOR EACH ROW
BEGIN
    IF NEW.status <> 'draft' OR NEW.total_amount <> 0 OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Credit transactions must be created as unapproved drafts';
    END IF;
END//

CREATE TRIGGER enforce_credit_transaction_status_transition
BEFORE UPDATE ON credit_transactions
FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status AND NOT (
        (OLD.status = 'draft' AND NEW.status IN ('pending_guest_confirmation','pending_price_approval','cancelled'))
        OR (OLD.status = 'pending_guest_confirmation' AND NEW.status IN
            ('disputed','pending_price_approval','pending_finance_approval','pending_exceptional_approval','cancelled','expired'))
        OR (OLD.status = 'disputed' AND NEW.status IN ('pending_guest_confirmation','pending_price_approval','cancelled'))
        OR (OLD.status = 'pending_price_approval' AND NEW.status IN ('pending_guest_confirmation','cancelled'))
        OR (OLD.status = 'pending_finance_approval' AND NEW.status IN
            ('approved','rejected','pending_exceptional_approval'))
        OR (OLD.status = 'pending_exceptional_approval' AND NEW.status IN ('approved','rejected'))
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid credit transaction status transition';
    END IF;
END//

CREATE TRIGGER prevent_approved_transaction_update
BEFORE UPDATE ON credit_transactions
FOR EACH ROW
BEGIN
    IF OLD.status = 'approved' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved financial transactions are immutable';
    END IF;
END//

CREATE TRIGGER prevent_approved_transaction_item_delete
BEFORE DELETE ON credit_transaction_items
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE id = OLD.transaction_id AND status = 'approved') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved transaction items cannot be deleted';
    END IF;
END//

CREATE TRIGGER prevent_approved_transaction_item_update
BEFORE UPDATE ON credit_transaction_items
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE id = OLD.transaction_id AND status = 'approved') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved transaction items are immutable';
    END IF;
END//

CREATE TRIGGER prevent_approved_transaction_item_insert
BEFORE INSERT ON credit_transaction_items
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE id = NEW.transaction_id AND status = 'approved') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved transaction items are immutable';
    END IF;
END//

CREATE TRIGGER prevent_verified_payment_delete
BEFORE DELETE ON payments
FOR EACH ROW
BEGIN
    IF OLD.status = 'verified' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified payment records cannot be deleted';
    END IF;
END//

CREATE TRIGGER prevent_verified_payment_update
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
    IF OLD.status = 'verified' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified payment records are immutable';
    END IF;
END//

CREATE TRIGGER prevent_verified_opening_balance_delete
BEFORE DELETE ON opening_balances
FOR EACH ROW
BEGIN
    IF OLD.status = 'verified' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified opening balances cannot be deleted';
    END IF;
END//

CREATE TRIGGER prevent_verified_opening_balance_update
BEFORE UPDATE ON opening_balances
FOR EACH ROW
BEGIN
    IF OLD.status = 'verified' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified opening balances are immutable';
    END IF;
END//

CREATE TRIGGER prevent_adjustment_delete
BEFORE DELETE ON financial_adjustments
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial adjustments cannot be deleted; create a reversal instead';
END//

CREATE TRIGGER prevent_adjustment_update
BEFORE UPDATE ON financial_adjustments
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial adjustments are immutable; create a reversal instead';
END//

CREATE TRIGGER prevent_price_history_update
BEFORE UPDATE ON service_price_history
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service price history is immutable';
END//

CREATE TRIGGER prevent_price_history_delete
BEFORE DELETE ON service_price_history
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service price history cannot be deleted';
END//

CREATE TRIGGER prevent_audit_log_mutation
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit records are immutable';
END//

CREATE TRIGGER prevent_audit_log_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit records cannot be deleted';
END//
DELIMITER ;
