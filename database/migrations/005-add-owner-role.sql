ALTER TABLE users
    MODIFY COLUMN role ENUM('system_administrator','owner','cashier','finance_manager','guest') NOT NULL;
