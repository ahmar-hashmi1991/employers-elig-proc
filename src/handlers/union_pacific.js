
const generateCsv = require('../services/csv-service');
const fs = require('fs');

async function init_union_pacific(){
    // let streamFile = fs.createReadStream('./union_pacific/COBRA_TEST.txt');
    // gordy.csv
    let file = './union_pacific/gordy.csv';
    let eligibilityRecords = await generateCsv.papaParseFile(streamFile);
    console.log('eligibilityRecords', eligibilityRecords);
}

// init_union_pacific();

const mapping = {"cobra_source":{"FirstName":"first_name","LastName":"last_name","Email Address":"email","Phone Number":"phone","Employee ID":"employee_id","Vitality ID":"reseller_employee_id","Role":"role","Gender":"gender","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Branch":"branch","Group Name":"group_name"},
"test_source":{"FirstName":"first_name","LastName":"last_name","Email Address":"email","Phone Number":"phone","Employee ID":"employee_id","Vitality ID":"reseller_employee_id","Role":"role","Gender":"gender","Date of Birth":{"key":"dob","transform":"date:MM/DD/YYYY"},"Branch":"branch","Group Name":"group_name"}};

const schema = {"properties":{"Vitality ID":{"type":"string","minLength":1},"FirstName":{"type":"string","minLength":1},"LastName":{"type":"string","minLength":1},"Employee ID":{"type":"string","minLength":1},"Date of Birth":{"type":"string","minLength":1},"Phone Number":{"type":"string"}}};
const ELIG_REC1 = { "id": 1, "first_name": 'JOHN', "last_name": 'JOHNSON', "employee_id": '123456', "reseller_employee_id": "VS00123456", "role": "EE", "dob": new Date('1984-09-08T00:00:00.000'), "email": "test@noreply.com", "gender": "male", "status": "eligible", "stage": "new" };
const elig_rules_json = {"productTypes":["BG","BP"],"validationFields":["reseller_employee_id","role","dob"],"targeting":{"default":true}};
const recordSource = [
    {"file": "source_2", "source_name": "source2"},
    {"file": "UP COBRA_TEST_202201071", "source_name": "cobra_source"}
  ];
//UP COBRA_TEST_20220107.*\.txt
//UP COBRA_TEST_-\d{10}-\d+.txt
// let recordSource = JSON.parse(record_source);
// const fileName = 'UP COBRA_TEST_20220107';


// recordSource.forEach(r =>{
//     // isMatch = fileName == r.file ? true : isMatch;
//     source_name = (fileName == r.file) ? r.source_name : source_name;
//     console.log(fileName)

// })

// record_source.forEach(r =>{
//     console.log(r);
//     console.log(r.file);
//     console.log(new RegExp(r.file));
//     // match = fileName.match(new RegExp(r.file));
//     // source_name = match ? r.source_name : source_name;
// })


function test(a, b){
  console.log(a);
}

test('t');