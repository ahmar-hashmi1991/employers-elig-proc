require('dotenv').config();
const csv = require('csv-parser');
const stripBomStream = require('strip-bom-stream');
const fs = require('fs')
const braze = require('../services/braze-service');
const { parsePhoneNumber } = require("libphonenumber-js");
const got = require('got');
const crypto = require('crypto');

const B2B_PROD_TYPE_LIST_ATTR = 'b2b_product_type_list';

const CHUNK_SIZE = 10;

let groups = [
    {id: '4afb5610-6508-4728-a0f2-cfdc9b8a3f6b', target: 'dario'},
    {id: '7054c5d2-e124-4048-9b06-64fa49c8e880', target: 'dario'},
    {id: '98ccb769-420e-429b-bd21-d60abf9c4aa7', target: 'dario'},
    {id: '871deba4-0d3b-4308-ab86-bd52049b39ee', target: 'dario'},
    {id: 'f3afef55-d791-43a9-a33e-393096e1e77b', target: 'msk'},
    {id: '45583009-70d3-4196-aab1-4b956322f00a', target: 'msk'}
];

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

(async () => {
    console.log("START");
    let fstream = fs.createReadStream('/server/temp/targeting.csv');
    let records = await parseCSV(fstream);
    console.log(`parsed ${records.length} records`);

    let chunkgen = chunks(records, CHUNK_SIZE);
    let invalid = [];
    for(let chunk of chunkgen){
        // await updateBrazeAttribues(chunk, invalid);
        // await subscribeToBrazeGroup(chunk, invalid);
        await updateBrazeTargeting(chunk, invalid);
    }

    console.log('INVALIDS', invalid);

    console.log("END");
})();


function validateEmail(email) {
    const res = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return res.test(String(email).toLowerCase());
}

async function subscribeToBrazeGroup(chunk, invalid) {
    let promises = [];
    for (const [i, record] of chunk.entries()) {
        let phone_number = record.phone_number;
        let user_ext_id = record.user_id; //crypto.createHash('md5').update(record.email.toLowerCase()).digest('hex'); //record.user_id;

        console.log(`registering ${phone_number}`);
        if(!!!phone_number || phone_number.length <= 2 || phone_number.length > 14){
            console.log('INVALID PHONE user id:',record.user_id, phone_number);
            invalid.push(record)
            continue;
        }
        let country = 'US';
        if (phone_number.startsWith('972'))
            country = 'IL';
        else if (phone_number.startsWith('44'))
            country = 'GB';
        else if (phone_number.startsWith('61'))
            country = 'AU';
        let parsed = parsePhoneNumber(phone_number, country);

        console.log(user_ext_id);

        if (!parsed.isValid()) {
            console.log('INVALID PHONE user id:', user_ext_id, phone_number);
            invalid.push(record);
        }
        else {
            promises.push(updateUserSubscriptionGroup(user_ext_id, '4afb5610-6508-4728-a0f2-cfdc9b8a3f6b', parsed.number, 'subscribed', 'dario'));
            promises.push(updateUserSubscriptionGroup(user_ext_id, '7054c5d2-e124-4048-9b06-64fa49c8e880', parsed.number, 'subscribed', 'dario'));
            promises.push(updateUserSubscriptionGroup(user_ext_id, '98ccb769-420e-429b-bd21-d60abf9c4aa7', parsed.number, 'subscribed', 'dario'));
            promises.push(updateUserSubscriptionGroup(user_ext_id, '871deba4-0d3b-4308-ab86-bd52049b39ee', parsed.number, 'subscribed', 'dario'));
            promises.push(updateUserSubscriptionGroup(user_ext_id, 'f3afef55-d791-43a9-a33e-393096e1e77b', parsed.number, 'subscribed', 'msk'));
            promises.push(updateUserSubscriptionGroup(user_ext_id, '45583009-70d3-4196-aab1-4b956322f00a', parsed.number, 'subscribed', 'msk'));
        }
    }

    let result = await Promise.allSettled(promises);
    console.log(result);
}

const updateBrazeAttribues = async (records) => {
    let attributes = records.map(record => {
        let extId = record.user_id; //crypto.createHash('md5').update(record.email.toLowerCase()).digest('hex');
        let phone_number = record.phone_number;

        return {
            "external_id": extId,
            phone: phone_number
        }
    });

    let opts = {
        method: 'POST',
        url: `https://rest.iad-02.braze.com/users/track`,
        json: {
            attributes
        },
        headers: {
            'Authorization': `Bearer ${process.env.BRAZE_KEY_DARIO}`,
            'Content-Type': 'application/json'
        }
    };

    console.log("Braze REQ ---> ", JSON.stringify(opts));
    let response = await got(opts).json();
    console.log("Braze RESP <--- ", response);
    return response;
}

const updateUserSubscriptionGroup = async (externalId, groupId, phone, subscription_state, target) => {
    let body = {
        external_id: externalId,
        subscription_group_id: groupId,
        subscription_state,
        phone: [phone]
    };
    let opts = {
        method: 'POST',
        url: `https://rest.iad-02.braze.com/subscription/status/set`,
        json: body,
        headers: {
            'Authorization': `Bearer ${process.env[`BRAZE_KEY_${target.toUpperCase()}`]}`,
            'Content-Type': 'application/json'
        }
    };

    try{
        console.log('GOT options:', JSON.stringify(opts));
        let response = await got(opts).json();
        console.log('GOT response', response);
        return response;
        // return {status: 'success-sim'};
    }
    catch(err) {
        console.log("ERROR in API call ", err);
        throw new Error(err.response);
    }
}

async function updateBrazeTargeting(chunk, invalid) {
    let promises = [];
    for (const [i, record] of chunk.entries()) {
        promises.push(callUpdateEligibility(record.eid));
    }

    let result = await Promise.allSettled(promises);
}

const callUpdateEligibility = async (eid, userAttributes) => {
    let opts = {
        method: 'POST',
        url: `https://ep-api.dariocare.com/employer/20027/eligibility/${eid}`,
        json: {
            "targeting": false
        },
        headers: {
            'x-api-key': `o7caiHljJA7wgw4l164vZ7oKBeUKvMAuarwlZi8Y`,
            'Content-Type': 'application/json'
        }
    };

    console.log("Eligibility REQ ---> ", JSON.stringify(opts));
    let response = await got(opts).json();
    console.log("Eligibility RESP <--- ", response);
    return response;
}