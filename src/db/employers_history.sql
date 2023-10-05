CREATE TABLE `employers_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `reseller_id` int(11) DEFAULT NULL,
  `external_id` varchar(255) NOT NULL,
  `client_id` varchar(45) DEFAULT NULL,
  `sf_eligbility_account_ID` varchar(45) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `status` varchar(45) NOT NULL DEFAULT 'active',
  `structure` text,
  `mapping_rules` text,
  `eligibility_rules` text,
  `record_source` text,
  `parser_structure` text,
  `folder` varchar(255) NOT NULL,
  `file_name_filter` varchar(255) DEFAULT NULL,
  `insurance_claims` text,
  `insurance_claims_last_file` varchar(255) DEFAULT NULL,
  `ftp_info` text,
  `external_ftp` tinyint(4) DEFAULT NULL,
  `ftp_password_creation_date` datetime DEFAULT NULL,
  `support_phone` varchar(45) DEFAULT NULL,
  `support_email` varchar(255) DEFAULT NULL,
  `braze_stats` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `external_id_UNIQUE` (`external_id`),
  KEY `reseller_employer` (`external_id`),
  KEY `reseller_id_fk_idx` (`reseller_id`),
  CONSTRAINT `reseller_id_fk` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
);

ALTER TABLE employers_history ADD COLUMN reason text;
ALTER TABLE employers_history ADD COLUMN user_id varchar(255) DEFAULT NULL;