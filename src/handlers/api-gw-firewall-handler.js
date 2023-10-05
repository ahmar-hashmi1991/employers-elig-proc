const db = require('../services/document-db-service');
const eligibility_db = require('../services/rds-data-service');
const redis = require('../services/redis-service');
const secret_service = require('../services/secrets-service');
const TTL = process.env.STAGE === 'stage' ? 300 : 86400;

const redisCacheVersion = 'v1';
const configSecret = `b2b-firewall-config`;

const getConfig = async () => {
  let config = await redis.get(`${configSecret}-${redisCacheVersion}`);
  if(!config){    
    config = await secret_service.getSecret(`${process.env.STAGE}-${configSecret}`);
    console.log("Secret Service ->> config: ", config);
    config = JSON.stringify(config);
    await redis.set(`${configSecret}-${redisCacheVersion}` , config, TTL);
  }
  return JSON.parse(config) || {};
};

const getWhiteList = async () => {
  let config = await getConfig();
  return config.whitelist || [];
};

const response = (res, err) => {
  return {
    statusCode: err ? '400' : '200',
    body: err ? JSON.stringify({ success: false, error: err.message }) : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  }
};

const arrayMergeUnique = async (arr1, arr2) => {
  arr1 = arr1.concat(arr2); //merge
  return arr1.filter((item, index) => arr1.indexOf(item) === index); //unique
};

const findMasterRecords = async (email, second_email, sn, order_number) => {
  let recordsPromises = [];
  email ? recordsPromises.push(db.getMasterRecord({ emails: email })) : recordsPromises.push(false);
  second_email ? recordsPromises.push(db.getMasterRecord({ emails: second_email })) : recordsPromises.push(false);
  sn ? recordsPromises.push(db.getMasterRecord({ serial_numbers: sn })) : recordsPromises.push(false);
  order_number ? recordsPromises.push(db.getMasterRecord({ order_numbers: order_number })) : recordsPromises.push(false);
  let [master_record, sec_master_record, sn_master_record, shop_order_record] = await Promise.all(recordsPromises);
  console.log(`master records db`, { master_record, sec_master_record, sn_master_record, shop_order_record });
  //first email record and second email both found
  if (master_record && sec_master_record) {
    if (master_record._id.toString() !== sec_master_record._id.toString()) {
      master_record = await mergeMasterRecords(master_record, sec_master_record);
    }
    sec_master_record = false;
  }

  //second email record and serial number record are the same 
  if (sec_master_record && sn_master_record && sec_master_record._id.toString() === sn_master_record._id.toString()) {
    sec_master_record = false;
  }

  //first email record and serial number record are the same
  if (master_record && sn_master_record && master_record._id.toString() === sn_master_record._id.toString()) {
    sn_master_record = false;
  }

  //shop order record and serial number record are the same
  if (shop_order_record && sn_master_record && shop_order_record._id.toString() === sn_master_record._id.toString()) {
    sn_master_record = false;
  }

  if (!master_record && sec_master_record) {
    master_record = sec_master_record;
    sec_master_record = false;
  }

  if (!master_record && shop_order_record) {
    master_record = shop_order_record;
    shop_order_record = false;
  }
  return [master_record, sec_master_record, sn_master_record, shop_order_record];
};

const addNewMasterRecord = async (email, second_email, sn, order_number, user_source = false, type = 'B2B') => {
  let master_record = {
    emails: [],
    serial_numbers: [],
    user_source: user_source !== false ? user_source : null,
    type: type,
  };
  if (email) {
    master_record.emails.push(email);
  }
  if (second_email && second_email !== email) {
    master_record.emails.push(second_email);
  }
  if (sn) {
    master_record.serial_numbers = [sn];
  }
  if (order_number) {
    master_record.order_numbers = [order_number];
  }
  console.log(`master record not found. adding new`, master_record);
  return await db.addMasterRecord(master_record);
};

const mergeRecordsAndDelete = async (record_to_keep, record_to_delete) => {
  console.log(`master record and sn found before merging`, [record_to_keep, record_to_delete]);
  let [mergedEmails, mergedSerials, orderNumbers] = await Promise.all([
    arrayMergeUnique(record_to_keep.emails, record_to_delete.emails),
    arrayMergeUnique(record_to_keep.serial_numbers, record_to_delete.serial_numbers),
    arrayMergeUnique(record_to_keep.order_numbers, record_to_delete.order_numbers),
  ]);
  record_to_keep.emails = mergedEmails;
  record_to_keep.serial_numbers = mergedSerials;
  record_to_keep.order_numbers = orderNumbers;
  console.log(`master record and sn found after merging`, record_to_keep);
  await Promise.all([
    db.updateMasterRecord(record_to_keep._id, record_to_keep),
    db.deleteMasterRecord(record_to_delete._id)
  ]);
  return record_to_keep;
};

const mergeMasterRecords = async (master_record, sn_master_record) => {
  if (sn_master_record.user_source && (sn_master_record.type === 'B2B' || !master_record.user_source)) {
    return await mergeRecordsAndDelete(sn_master_record, master_record);
  } else if (master_record.user_source && (master_record.type === 'B2B' || !sn_master_record.user_source)) {
    return await mergeRecordsAndDelete(master_record, sn_master_record);
  }
};

const handleProvisioning = async (email, second_email, sn, user_source, type, order_number) => {
  let [master_record, sec_master_record, sn_master_record, shop_order_record] = await findMasterRecords(email, second_email, sn, order_number);
  console.log(`master records`, { master_record, sec_master_record, sn_master_record, shop_order_record });

  if (!master_record && !sn_master_record) {
    //no record at all - add
    return await addNewMasterRecord(email, second_email, sn, order_number, user_source, type);
  } else if (master_record && sn_master_record) {
    //both sn and email records    
    return await mergeMasterRecords(master_record, sn_master_record);
  } else if (master_record && !sn_master_record) {
    //only email record found
    if (user_source && (!master_record.user_source || master_record.type === 'B2C')) {
      master_record.user_source = user_source;
      master_record.type = type;
    }
    if (sn && master_record.serial_numbers.indexOf(sn) === -1) {
      master_record.serial_numbers.push(sn);
    }
    if (second_email) {
      master_record.emails = await arrayMergeUnique([second_email], master_record.emails);
    }
    if (order_number) {
      master_record.order_numbers = await arrayMergeUnique([order_number], master_record.order_numbers);
    }
    console.log(`master record found updating`, master_record);
    return await db.updateMasterRecord(master_record._id, master_record);
  } else if (!master_record && sn_master_record) {
    //only sn record found
    if (sn_master_record.user_source) {
      if (email) {
        sn_master_record.emails.push(email);
      }
      if (order_number) {
        sn_master_record.order_numbers = await arrayMergeUnique([order_number], sn_master_record.order_numbers);
      }
      if (user_source && (!sn_master_record.user_source || sn_master_record.type === 'B2C')) {
        sn_master_record.user_source = user_source;
        sn_master_record.type = type;
      }
    }
    console.log(`sn master record record found updating`, sn_master_record);
    return await db.updateMasterRecord(sn_master_record._id, sn_master_record);
  }
};

const getMasterRecordType = async (email, type) => {
  let record = await redis.get(`b2b-fw-email-type-${email}`);
  if(!record){
    record = await db.getMasterRecord({ emails: email });
    if(!record.type || record.type === 'B2C'){
      let [eligibility_records, fields] = await eligibility_db.getEligibilityByFields(`email = ? OR shop_email = ? OR app_email = ?`, [email, email, email]);
      console.log(`Eligibility DB Result for ${email}`, { eligibility_records });
      if (eligibility_records.length > 0) {
        record = { type: 'B2B' };
      }
      
      await redis.set(`b2b-fw-email-type-${email}`, JSON.stringify(record), 900);
    }
  }else{
    record = JSON.parse(record);
  }
  
  if (!record.type) {
    let err = new Error("Not found");
    err.code = 404;
    throw err;
  }

  if (type) {
    return record.type === type;
  }
  return record.type;
};

/**
  * A Lambda function that receive Requests from Eligibility API GW.
  */
exports.handleAPIRequest = async (event, context) => {
  console.log('event', event);
  let operationName = event.requestContext.operationName;
  const apiSource = await db.getSource({ api_source: event.pathParameters.source });
  let body = JSON.parse(event.body);

  console.log(apiSource);
  console.log(`${operationName}`, body);

  try {
    let email = body.email ? body.email.toLowerCase() : false;
    let type = body.type ? body.type : false;
    switch (`${operationName}`) {
      case 'createProvisioning':
        let second_email = body.second_email ? body.second_email.toLowerCase() : false;
        let serial_number = body.serial_number ? body.serial_number : false;
        let user_source = body.user_source ? body.user_source : false;
        let order_number = body.order_number ? parseInt(body.order_number, 10) : false;
        type = type ? type : "B2B";
        console.log([email, second_email, serial_number, user_source, type, order_number]);
        await handleProvisioning(email, second_email, serial_number, user_source, type, order_number);
        break;
      case 'checkType':
        console.log([email, type]);
        if (!email) {
          return response({ success: false }, new Error(`ERROR: Invalid Input`));
        }
        return response({ success: true, result: await getMasterRecordType(email, type) });
      case 'verifyMessage':
        if (!email) {
          return response({ send: false }, new Error(`ERROR: Invalid Input`));
        }
        let recordType = 'b2b';
        try {
          recordType = await getMasterRecordType(email, false);
          recordType = recordType.toLowerCase();
        } catch (e) {
          console.log("Error in verifyMessage", JSON.stringify(e));
        }

        let journeyPrefix = body.journey.substring(0, 3).toLowerCase();
        let messagePrefix = body.message.substring(0, 3).toLowerCase();
        console.log({ recordType, journeyPrefix, messagePrefix });
        let responseObject = { "send": (recordType === journeyPrefix && recordType === messagePrefix) };        
        if (!responseObject.send) {
          console.log(`not matching`, { body, recordType });
          let b2bfw_white_list = await getWhiteList();
          if(b2bfw_white_list.indexOf(email) > -1){
            responseObject = { "send": true };
            console.log(`whitelist passed!`, {b2bfw_white_list});
          }
        }
        console.log(`returning response`, responseObject);
        return response(responseObject);
      default:
        return response({ success: false }, new Error(`ERROR: Unsupported Operation`));
    }
  }
  catch (error) {
    console.log(error);
    return response({ send: false }, new Error(`ERROR: ${error.message}`));
  }
  if (apiSource.api_source === 'fulfillment') {
    return response(body);
  }
  return response({ success: true });
};

exports.callHandleProvisioning = (email, second_email, employerName) => {
  return handleProvisioning(email, second_email, null, employerName, 'B2B', null);
}

exports.getMasterRecordType = getMasterRecordType;