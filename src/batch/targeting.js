const csv = require('csv-parser');
const stripBomStream = require('strip-bom-stream');
const fs = require('fs')
const db = require('../services/rds-data-service');

const EMPLOYER_ID = '90001';

const parseCSV = (instream) => {
    return new Promise((resolve, reject) => {
        console.log('Start CSV parsing...... >>>');
        let results = [];
        instream.on('error', (error) => {
            console.log('ERROR in file stream ', error);
            reject(error.message);
        })
        .pipe(stripBomStream())
        .pipe(csv({
            separator: ',',
            mapValues: valueProcessor
        }))
        .on('data', (row) => {
            // console.log('ROW --> ', row);
            results.push(row);
        })
        .on('end', () => {
            console.log(`finished parsing ${results.length} rows from CSV file.`);
            resolve(results);
        })
        .on('error', (err) => {
            console.error('ERROR parsing file ', err);
            reject(err);
        });
    })
}

const valueProcessor = ({ header, index, value }) => {
    // else if (header === 'start_week') return +moment(value, 'MM/DD/YYYY').toDate();
    // else if (header === 'end_week') return +moment(value, 'MM/DD/YYYY').toDate();
    return !!value ? value : null;
}

(async () => {
    console.log("START");
    let fstream = fs.createReadStream('/mnt/c/temp/dt_claim_match_souls.csv');
    let records = await parseCSV(fstream);
    console.log(`parsed ${records.length} records`);

    let [employers] = await db.getEmployer(EMPLOYER_ID);
    console.log('employer -', employers[0].name);
    let [eligibility] = await db.getEmployerEligibilityList(employers[0].id);
    console.log('eligibilities', eligibility.length);

    for(const [i,record] of records.entries()){
        let found = eligibility.find(e => e.reseller_employee_id === record.employee_id && e.role === record.role);
        console.log(`found ${i+1}/${records.length} - ${found ? found.eid : 'not found'}`);
    }

    await db.end();
    console.log("END");
})();