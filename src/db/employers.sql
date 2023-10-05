CREATE TABLE IF NOT EXISTS employers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employer_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    structure TEXT,
    folder VARCHAR(255) NOT NULL,
    ftp_info TEXT,
    external_ftp  TINYINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)  ENGINE=INNODB;