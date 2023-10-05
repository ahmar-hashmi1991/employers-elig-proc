const csv = require('csv-parser');
const crypto = require('crypto');
const stripBomStream = require('strip-bom-stream');
const fs = require('fs')
const got = require('got');

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

const deleteBrazeUser = async (emails) => {
    let externalIds = emails.map( email => crypto.createHash('md5').update(email).digest('hex'));
    let reqBody = {
        "external_ids": externalIds
    };
    let opts = {
        method: 'POST',
        url: `https://rest.iad-02.braze.com/users/delete`,
        json: reqBody,
        headers: {
            'Authorization': `Bearer ${process.env.BRAZE_KEY_DARIO}`,
            'Content-Type': 'application/json'
        }
    };
    console.log('Braze request:', JSON.stringify(opts));
    let response = await got(opts);
    return response.body;
}

const deleteBrazeUserByExtIds = async (externalIds) => {
    let reqBody = {
        "external_ids": externalIds
    };
    let opts = {
        method: 'POST',
        url: `https://rest.iad-02.braze.com/users/delete`,
        json: reqBody,
        headers: {
            'Authorization': `Bearer ${process.env.BRAZE_KEY_DARIO}`,
            'Content-Type': 'application/json'
        }
    };
    console.log('Braze request:', JSON.stringify(opts));
    let response = await got(opts);
    return response.body;
}

(async () => {
    console.log("START");
    let fstream = fs.createReadStream('/mnt/c/temp/union_pacific_to_delete.csv');
    let records = await parseCSV(fstream);
    console.log(`parsed ${records.length} records`);

    let chunkgen = chunks(records, 50);
    for(let chunk of chunkgen){
        let idsToDelete = chunk.map(rec => rec.user_id);
        console.log('idsToDelete', idsToDelete);
        let result = await deleteBrazeUserByExtIds(idsToDelete);
        console.log(result)
    }

    console.log("END");
})();