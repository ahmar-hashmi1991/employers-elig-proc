const AWS = require('aws-sdk');
const csv = require('../services/csv-service');
const db = require('../services/rds-data-service');
const moment = require('moment');
const constants = require('../common/constants');
const braze = require('../services/braze-service');
const sforce = require('../services/salesforce-service');
const email = require('../services/email-service');
const office = require('../services/office-service');

const s3 = new AWS.S3();
const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

/*
E08  Diabetes mellitus due to underlying condition
E09  Drug or chemical induced diabetes mellitus
E10  Type 1 diabetes mellitus
E11  Type 2 diabetes mellitus
E13  Other specified diabetes mellitus
O24  Diabetes mellitus in pregnancy, childbirth, and the puerperium
*/

const icd10_DT = ["E08","E09","E10","E11","E13","O24"];

/*
I10  Essential (primary) hypertension
I11  Hypertensive heart disease
I12  Hypertensive chronic kidney disease
I13  Hypertensive heart and chronic kidney disease
I15  Secondary hypertension
I16  Hypertensive crisis
O10  Pre-existing hypertension complicating pregnancy, childbirth and the puerperium
O11  Pre-existing hypertension with pre-eclampsia
O12  Gestational [pregnancy-induced] edema and proteinuria without hypertension
O13  Gestational [pregnancy-induced] hypertension without significant proteinuria
O14  Pre-eclampsia
O15  Eclampsia
O16  Unspecified maternal hypertension
*/
const icd10_HT = ["I10","I11","I12","I13","I15","I16","O10","O11","O13","O14","O15","O16"];

const COL_FIRST_NAME = 'Patient First Name';
const COL_LAST_NAME = 'Patient Last Name';
const COL_GENDER = 'Patient Gender';
const COL_DOB = 'Patient DOB';
const COL_ROLE = 'Relationship Code';

const indexFields = [
    COL_FIRST_NAME,
    COL_LAST_NAME,
    COL_GENDER,
    COL_DOB,
    COL_ROLE
];

const CLAIMS_DATE_FOEMAT = 'YYYYMMDD';
/*
Employee First Name|Employee Last Name|Patient First Name|Patient Last Name|Patient Gender|Patient DOB|Relationship Code|Sequence Number|Procedure Code|Diag Code 1|Diag Code 2|Diag Code 3|NDC|DRG|Paid Date|Begin Date|End Date|Provider Name|Provider TIN|Group Number
KELLY|WRIGHT|KELLY|WRIGHT|F|19710328|IN|00|36415|E785|Z79899|E119||000|20210127|20210112|20210112|COFFEY,DAVID,G,III,MD|561935767|76414587
*/

exports.s3InsuranceClaimsFileHandler = async (params, employer, claimsjson) => {
    console.log(`Start processing of insurance claims file: ${JSON.stringify(params)}`);
    const instream = s3.getObject(params).createReadStream();
    let claimsRecords = await csv.parseCSV(instream, claimsjson.delimiter, valueProcessor);
    let icd10Records = findIcd10Records(claimsRecords, claimsjson);
    let uniqueIcd10Records = groupClaims(icd10Records, claimsjson);
    console.log(`Insurance claims file has ${claimsRecords.length} records, ${icd10Records.length} with icd10 codes, ${uniqueIcd10Records.length} unique patients`);
    let stats = {
        total_records: claimsRecords.length,
        icd10_records: icd10Records.length,
        icd10_unique_records: uniqueIcd10Records.length,
        exact_match: 0,
        multiple_matches: 0,
        mismatches: 0,
        targeting_enabled: 0
    }
    let report = [];

    for(let record of uniqueIcd10Records){
        console.log(record[COL_FIRST_NAME], record[COL_LAST_NAME], record[COL_GENDER], record[COL_DOB], record[COL_ROLE]);

        let q = 'first_name like LCASE(?) AND last_name like LCASE(?) AND dob = LCASE(?) AND gender = LCASE(?) AND role = ? AND status = ? AND employer_id = ?';
        let v = [
            `${record[COL_FIRST_NAME].substr(0,2)}%`,
            `${record[COL_LAST_NAME].substr(0,2)}%`,
            `${parseDate(record[COL_DOB],CLAIMS_DATE_FOEMAT)}`,
            `${record[COL_GENDER]}`,
            `${record[COL_ROLE]}`,
            'eligible',
            employer.id];
        console.log('where: ', q);
        console.log('values: ', v);
        let [rows,fields] = await db.getEligibilityByFields(q, v);

        console.log(`found ${rows.length} matching eligibility records`);
        if(rows.length === 1){
            stats.exact_match++;
            let eligibility = rows[0];

            if(eligibility.targeting === 0){
                const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
                let result = claimsjson.simulate ? 'simulation - no targeting update' : await updateTargeting(eligibility, constants.EligibilityTargeting.ENABLED, brazeUnifiedFlag);
                stats.targeting_enabled++;
                console.log('targeting update results', result);
                //check if not EE - get EE and if targeted is false - add to out report
                if(eligibility.role !== constants.EligibilityRole.EMPLOYEE){
                    let [employee] = await db.getEligibilityByFields('reseller_employee_id = ? AND role = ?', [eligibility.reseller_employee_id, constants.EligibilityRole.EMPLOYEE]);
                    if(employee.length === 1 && employee[0].targeting === 0){
                        report.push(employee[0]);
                    }
                }
            }
        }
        else if(rows.length > 1){
            stats.multiple_matches++;
        }
        else{
            stats.mismatches++;
        }
    }
    claimsjson.simulate ? console.log('simulate - no update last claims file') : await db.updateInsuranceClaimsFile(params.Key,employer.id);
    let reportCSV = toCsv(report);
    let excelBase64 = await office.generateExcelDoc(reportCSV, ',', claimsjson.reportPassword);
    await email.sendEmailWithAttachment(`employees for targeting from claims file ${claimsjson.simulate ? '(simulation)' : ''}`, 
        'attached - a tageting report file', 'targetingReport.xlsx', excelBase64);
    return {stats};
}

function toCsv(records){
    let header = 'first_name,last_name,gender,email';
    let data = records.map(r => `${r.first_name},${r.last_name},${r.gender},${r.email}`).join('\n');
    return `${header}\n${data}`;
}

function updateTargeting(currentEligibility, targeting,brazeUnifiedFlag){
    
    return Promise.all([
        db.updateEligibility({targeting}, currentEligibility.id),
        db.addEligibilityLog(currentEligibility.id, 'update', `eligibility targeting updated from claims file.`),
        sforce.updateSFAccountTargeting(currentEligibility.sf_id, targeting),
        braze.sendUserEvent( brazeUnifiedFlag? currentEligibility.eid:  currentEligibility.email, constants.Braze.UPDATE, {}, {b2b_targeting: targeting})
      ]);
}

function findIcd10Records(claimsRecords, claimsjson){
    return claimsRecords.reduce((out, record) => {
        let icd10_dt = parseIcd10(icd10_DT, claimsjson.icd10_fields.map(cd => record[cd]));
        let icd10_ht = parseIcd10(icd10_HT, claimsjson.icd10_fields.map(cd => record[cd]));
        console.log('ICD10 found:', icd10_dt, icd10_ht);
        if(icd10_dt.length || icd10_ht.length){
            out.push(record);
        }
        return out;
    }, []);
}

function groupClaims(claimsRecords, claimsjson){
    return claimsRecords.reduce((out, rec) => {
        let existing = out.find(r => indexFields.every(f => r[f] === rec[f]));
        if(!existing) out.push(rec);
        return out;
    }, []);
}

function parseIcd10(icd10_codes, icdCodes) {
    let retCodes = [];
    for(code of icdCodes){
        if(code){
            if(code.includes(".")){
                code = code.substr(0, code.indexOf("."));
            }
            if(icd10_codes.includes(code.substr(0,3))) {
                retCodes.push(code);
            }
        }
    }
    
    return Array.from(new Set(retCodes));
}

const parseDate = (val, format) => {
    let mdate = moment(val, format);
    if(!mdate.isValid()) throw new Error(`Invalid date value - ${val}, should be: ${format}`);
    return mdate.format('YYYY-MM-DD');
}

const valueProcessor = ({ header, index, value }) => {
    if(header === 'Relationship Code' && value === 'IN') return 'EE';
    return isEmpty(value) ? null : value;
}

function isEmpty(val){
    if(!!!val) return true;
    if(val === '\u0000') return true;
    return false;
}