DROP TRIGGER IF EXISTS enforce_credit_transaction_status_transition;

DELIMITER //
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
DELIMITER ;
