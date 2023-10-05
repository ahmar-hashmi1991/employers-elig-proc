CREATE TABLE `resellers_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `reseller_id` int(11) DEFAULT NULL,
  `eid` varchar(45) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `eligibility_rules` text,
  `configurations` text,
  `support_phone` varchar(45) DEFAULT NULL,
  `support_email` varchar(255) DEFAULT NULL,
  `source_ip` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `eid_UNIQUE` (`eid`),
  CONSTRAINT `reseller_id` FOREIGN KEY (`reseller_id`) REFERENCES `resellers` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8;


ALTER TABLE resellers_history ADD COLUMN reason text;
ALTER TABLE resellers_history ADD COLUMN user_id varchar(255) DEFAULT NULL;