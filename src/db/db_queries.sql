
-- adding columnss related to links in employer and reseller starts --
ALTER TABLE employers ADD COLUMN b2b_link TEXT DEFAULT NULL;
ALTER TABLE employers ADD COLUMN kickoff_link TEXT DEFAULT NULL;
ALTER TABLE employers ADD COLUMN epic_link TEXT DEFAULT NULL;

ALTER TABLE resellers ADD COLUMN b2b_link TEXT DEFAULT NULL;
ALTER TABLE resellers ADD COLUMN kickoff_link TEXT DEFAULT NULL;
ALTER TABLE resellers ADD COLUMN epic_link TEXT DEFAULT NULL;

ALTER TABLE employers_history ADD COLUMN b2b_link TEXT DEFAULT NULL;
ALTER TABLE employers_history ADD COLUMN kickoff_link TEXT DEFAULT NULL;
ALTER TABLE employers_history ADD COLUMN epic_link TEXT DEFAULT NULL;

ALTER TABLE resellers_history ADD COLUMN b2b_link TEXT DEFAULT NULL;
ALTER TABLE resellers_history ADD COLUMN kickoff_link TEXT DEFAULT NULL;
ALTER TABLE resellers_history ADD COLUMN epic_link TEXT DEFAULT NULL;
-- adding columnss related to links in employer and reseller ends --

-- adding launch date to employers -- starts --
ALTER TABLE employers ADD COLUMN launch_date datetime default current_timestamp after braze_stats;
-- adding launch date to employers -- ends --

-- checking eid for + and / signs and replcacing with P and S --starts
UPDATE resellers SET eid= replace( REPLACE(eid, '/', 'S') , '+' , 'P' ) WHERE eid regexp '[\\+\\/]';
UPDATE resellers_history SET eid= REPLACE(REPLACE(eid, '/', 'S') , '+' , 'P' ) WHERE eid regexp '[\\+\\/]';
-- checking eid for + and / signs and replcacing with P and S --starts

-- adding landing page url  to employers -- starts --
ALTER TABLE employers ADD COLUMN lp_url longtext default null;
ALTER TABLE employers_history ADD COLUMN lp_url longtext default null;
-- adding landing page url  to employers -- ends --

-- modifies enrollment set up column in employers -- starts --
ALTER TABLE employers MODIFY enrollment_setup longtext default null;
ALTER TABLE employers_history MODIFY enrollment_setup longtext default null;
-- modifies enrollment set up column in employers -- ends --

-- adding columns for sanofi feature flags -- starts --
ALTER TABLE resellers ADD COLUMN mtb_features json;
UPDATE resellers SET mtb_features = '{"activate_prescription_manager":false, "activate_grocery_scanner": false, "activate_healthkit_observers":false, "activate_dexcom_device":false, "activate_care_kitchen":false}';
ALTER TABLE resellers_history ADD COLUMN mtb_features json;
UPDATE resellers_history SET mtb_features = '{"activate_prescription_manager":false, "activate_grocery_scanner": false, "activate_healthkit_observers":false, "activate_dexcom_device":false, "activate_care_kitchen":false}';
-- adding columns for sanofi feature flags -- ends --

-- adding ftp/sftp flags columns in employers --starts --
ALTER TABLE employers ADD is_ftp_sftp tinyint default 0;
ALTER TABLE employers_history ADD is_ftp_sftp tinyint default 0;
ALTER TABLE `employers`
CHANGE COLUMN `is_ftp_sftp` `is_ftp_sftp` TINYINT(4) GENERATED ALWAYS AS ((case when (`external_ftp` = 1) then 1 WHEN (`external_ftp` = 0) then 2 else 0 end)) VIRTUAL ;

ALTER TABLE employers_history ADD is_ftp_sftp tinyint AS (CASE WHEN external_ftp = 1 THEN 1 ELSE 0 END);
ALTER TABLE employers ADD is_ftp_sftp tinyint AS (CASE WHEN external_ftp = 1 THEN 1 ELSE 0 END);
-- adding ftp/sftp flags columns in employers --ends --

-- START: NOT RUN ON PRODUCTION YET --
-- DATE: 04-08-2023 --
-- START: Adding sftp users_list column to employers table --
ALTER TABLE employers
ADD COLUMN sftp_users_list LONGTEXT DEFAULT NULL;

ALTER TABLE employers_history
ADD COLUMN sftp_users_list LONGTEXT DEFAULT NULL;
-- END: Adding sftp users_list column to employers table --

-- DATE: 13-08-2023 --
-- START: Create table eligibility_skus
create table eligibility_skus (
	`id` bigint not null auto_increment primary key,
    `data` varchar(100) not null unique,
    `product_type` varchar(100) default null,
    `eligibility_name` varchar(100) default null,
    `created_at` datetime default current_timestamp,
    `updated_at` datetime default current_timestamp
);
-- END: Create table eligibility_skus

-- START: Add data to the eligibility_skus table
INSERT INTO eligibility_skus (`data`, `product_type`, `eligibility_name`)
VALUES
    ('ELG-00000-7200-lcMC', 'BG', 'eligibility_iphone_sku'),
    ('ELG-00000-7200-ucMC', 'BG', 'eligibility_usbc_sku'),
    ('ELG-00000-7200-igMC', 'BG', 'eligibility_ig_sku'),
    ('ELG-HT-00000-7300-MC', 'BP', 'eligibility_bp_gsm_sku'),
    ('ELG-MSK-00000-7400-MC', 'MSK', 'eligibility_msk_sku'),
    ('ELG-UPRIGHT-00000-7700-MC', 'PST', 'eligibility_pst_sku'),
    ('ELG-MSKUPRIGHT-00000-7800-MC', 'MSK_PST', 'eligibility_msk_pst_sku'),
    ('ELG-PM-00000-8000-MC', 'MSK_CVA', 'eligibility_msk_cva_sku'),
    ('ELG-BH-00000-7600-MC', 'BH', 'eligibility_bh_sku'),
    ('ELG-WM-00000-7500-MC', 'WM', 'eligibility_wm_gsm_sku');
-- END: Add data to the eligibility_skus table

-- END: NOT RUN ON PRODUCTION YET --
