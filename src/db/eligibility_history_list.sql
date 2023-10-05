CREATE TABLE IF NOT EXISTS eligibility_history_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    eligibility_files_history_id INT NOT NULL,
    employer_id VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    gender VARCHAR(16),
    dob DATE,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)  ENGINE=INNODB;