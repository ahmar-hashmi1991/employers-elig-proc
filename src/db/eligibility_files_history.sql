CREATE TABLE IF NOT EXISTS eligibility_files_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employer_id VARCHAR(255) NOT NULL,
    employer_upload_counter INT,
    file_name VARCHAR(255),
    folder VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)  ENGINE=INNODB;