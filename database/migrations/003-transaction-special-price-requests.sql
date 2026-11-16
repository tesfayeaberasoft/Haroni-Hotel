ALTER TABLE credit_transactions
    MODIFY COLUMN status ENUM(
        'draft','pending_guest_confirmation','disputed','pending_price_approval','pending_finance_approval',
        'pending_exceptional_approval','approved','rejected','cancelled','expired'
    ) NOT NULL DEFAULT 'draft';

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
