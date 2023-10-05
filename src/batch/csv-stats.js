const csv = require('csv-parser');
const stripBomStream = require('strip-bom-stream');
const fs = require('fs')
const { parsePhoneNumber } = require("libphonenumber-js");

function* chunks(arr, n) {
    for (let i = 0; i < arr.length; i += n) {
        yield arr.slice(i, i + n);
    }
}

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
    return !!value ? value.trim() : null;
}
const emailValidatorRegexp = /^[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
function identifyType(values){
    let firstVal = values[0] ? values[0] : null;
    if(Number.isInteger(firstVal)) return 'Number';
    else if(!isNaN(Date.parse(firstVal))) return 'Date';
    else if(values.some(v => v && emailValidatorRegexp.test(v.trim().toLowerCase()))) return 'Email';
    return 'String';
}

function getInvalidEmails(values){
    return values.filter(v => v && !emailValidatorRegexp.test(v.trim().toLowerCase()));
}

function getStats(records, field){
    let values = records.map(r => r[field]);
    let type = identifyType(values);
    
    let unique = values.reduce((out,v) => {
        out[v] = out[v] ? out[v] + 1 : 1;
        return out;
    }, {});
    let uniqueValues = Object.keys(unique);
    uniqueValues = uniqueValues.sort((a,b) => unique[b] - unique[a]);
    
    let stats = {
        type,
        uniqueness: {
            isUnique: uniqueValues.length === records.length,
            uniqueValues: uniqueValues.length,
            frequent: uniqueValues.slice(0, 10).map(val => `${val}: ${unique[val]}`)
        }
    };
    if(type === 'Email'){
        stats.invalidValues = getInvalidEmails(uniqueValues);
    }

    return stats;
}

(async () => {
    console.log("START");
    let fstream = fs.createReadStream('/home/ubuntu/Eligibility-Gerdau-20003-20211213.csv');
    let records = await parseCSV(fstream);
    console.log(`parsed ${records.length} records`);
    let fields = records.length > 0 ? Object.keys(records[0]) : [];

    let report = [];
    for(field of fields){
        let stats = getStats(records, field);
        report.push({field, stats});
    }

    console.log(JSON.stringify(report,null,2));

    console.log("END");
})();