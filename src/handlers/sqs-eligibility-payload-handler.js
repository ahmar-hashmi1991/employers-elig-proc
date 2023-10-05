const db = require('../services/rds-data-service');
const shop = require('../services/shop-service');
const flexAPI = require('../services/vitality-flex-api-service');
const constants = require('../common/constants');
const utils = require('../common/utils');
const emailSrv = require('../services/email-service');
const salesforce = require('../services/salesforce-service');
const braze = require('../services/braze-service.js');
const apiGWHandler = require('./api-gw-handler');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const moment = require('moment');


const {
    createNewEligibility,
    updateAndEnableEligibility,
    disableEligibility,
    graceEligibility,
    unGraceEligibility,
    disabledEligExternalServices,
    updateAndEnableEligExternalServices,
    getEmployerNameForSalesForce,
    createNewEligibilityInReferrals
} = require('../controllers/eligibility-controller');

const waitFor = (ms) => new Promise(r => setTimeout(r, ms));

const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`


exports.sqsPayloadHandler = async (event, context) => {
    let simulate = process.env.simulate ? true : false;
    console.log(`simulate mode - ${simulate}`);
    let promises = [];

    for (record of event.Records) {
        console.log('message', JSON.stringify(record));
        let activity = record.messageAttributes.EligibilityAction.stringValue;
        let payload = JSON.parse(record.body);
        let RecordIndex = record.messageAttributes.RecordIndex ? record.messageAttributes.RecordIndex.stringValue : '-';
        let RecordCount = record.messageAttributes.RecordCount ? record.messageAttributes.RecordCount.stringValue : '-';

        console.log(`[${activity}] processing record ${RecordIndex} of ${RecordCount}`);
        console.log('eligibility (csv):', payload.eligibility);
        console.log('employer:', payload.employer);
        console.log('file history id:', payload.fileHistId);
        console.log('payload', payload);

        if(simulate && activity !== constants.EligibilityWorkerAction.FINISH){
            console.log(`simulating...`);
            await waitFor(7);
            continue;
        }
        if (activity === constants.EligibilityWorkerAction.ADD) {
            promises.push(createNewEligibility(payload.eligibility, payload.employer, payload.fileHistId, payload.originalRecord));
        }
        else if (activity === constants.EligibilityWorkerAction.UPDATE) {
            promises.push(updateAndEnableEligibility(payload.eligibility, payload.old_eligibility, payload.employer, payload.fileHistId, payload.originalRecord));
        }
        else if (activity === constants.EligibilityWorkerAction.REMOVE) {
            promises.push(disableEligibility(payload.eligibility, payload.fileHistId));
        }
        else if (activity === constants.EligibilityWorkerAction.GRACE) {
          promises.push(graceEligibility(payload.eligibility, payload.fileHistId, payload.eligibility.employer_id));
        }
        else if (activity === constants.EligibilityWorkerAction.UNGRACE) {
          promises.push(unGraceEligibility(payload.eligibility, payload.fileHistId, payload.eligibility.employer_id));
        }
        else if(activity === constants.EligibilityWorkerAction.FINISH){
            promises.push(finishFileProcessing(payload.fileHistId, payload.stats, payload.s3Configuration));
        }
        else if(activity === constants.EligibilityWorkerAction.ORDER){
            promises.push(createShopOrder(payload.order_data, payload.employer_id));
        }
        else if(activity === constants.EligibilityWorkerAction.EXTERNAL_SERVICES){
            promises.push(sendReqToExternalServices(payload.currentEligibility, payload.data, payload.employer));
        }
        else if(activity === constants.EligibilityWorkerAction.REMOVE_EXTERNAL_SERVICES){
            promises.push(disabledEligExternalServices(payload.disabledElig, payload.ordersToCancel, payload.subsToCancel));
        }
        else if(activity === constants.EligibilityWorkerAction.UPDATE_EXTERNAL_SERVICES){
            promises.push(updateAndEnableEligExternalServices(payload.newEligRec, payload.currElig, payload.employer, payload.newStatus, payload.newStage));
        }
        else if(activity === constants.EligibilityWorkerAction.CREATE_ELIBIGILITY_IN_REFERRALS){
            promises.push(createNewEligibilityInReferrals(payload.eligRec, payload.employer, payload.fileHistoryID, payload.enigibilityId));
        }
        else {
            console.log(`ERROR - invalid activity type - ${activity}`)
        }
    }

    let results = await Promise.allSettled(promises);
    console.log('chunk results:', results);
}

async function finishFileProcessing(fileHistoryID, stats, s3Configuration) {
    console.info(`finished processing of file id: ${fileHistoryID}`);
    let durationMs = Date.now() - stats.startTime;
    await db.updateFileHistoryLog(fileHistoryID, {status: constants.FileLogStatus.SUCCESS, output: JSON.stringify({summary: {...stats, duration: durationMs}})});
    let [rows, fields] = await db.getFileHistoryLog(fileHistoryID);
    let fileHist = rows[0];
    let [hrows, hflds] = await db.retrieveFileLogs(fileHistoryID);
    let [emprows, empflds] = await db.getEmployerByID(fileHist.employer_id);
    let employer = emprows[0];
    const errors = hrows.map(e => {
      const beautyShownData = JSON.stringify(JSON.parse(e.data), null, '&nbsp&nbsp;').split('\n').join('<br>');
      return `${e.type}-${e.activity} - ${e.notes} record:\n ${beautyShownData}`;
    }).join('\n\n');

    await createErrorsFileAndUploadToAWS(hrows,employer,s3Configuration);

    const subject = `finished processing all for ${employer.name} (${process.env.STAGE}) ${stats.validation_mode ? '<SIMULATION>' : ''}`;
    // const message = `FINISHED processing all eligibility transactions of file ${fileHist.file_name}, duration: ${utils.formatTime(durationMs)}
    // statistics: added ${stats.added}, updated: ${stats.updated}, removed: ${stats.removed}
    // ${errors}`;
    // await emailSrv.sendEmail(subject, message);
    await emailSrv.sendTemplateEmail(subject, {
        step: 'Done - Success',
        datetime: new Date().toLocaleString(),
        employer: employer.name,
        employerId: employer.external_id,
        file: fileHist.file_name,
        duration: utils.formatTime(durationMs),
        stats: `Statistics:`,
        newUsers: stats.added,
        updateUsers: stats.updated,
        reviveUsers: stats.revive_users,
        removeEligibleUsers: stats.removed,
        removeEnrolledUsers: stats.removed_enrolled_users,
        minors: stats.minors,
        errors
    }, 'processing2')

}

async function createShopOrder(order_data, employer_id){
    console.log(`Creating new shop order for employerID:[${employer_id}]`, JSON.stringify(order_data));
    //create shop order
    let shopResult = await shop.createOrder(order_data);
    shopResult = JSON.parse(shopResult.body);
    if(shopResult.message !== 'Order Created' || !shopResult.orders){
        console.log(`Error: Error creating shop orders`, shopResult);
        await emailSrv.sendEmail(`Vitality Flex - Error Creating Shop Order ${order_data.orderId}`, JSON.stringify({shopResult, order_data}))
    }else{
        shopResult = JSON.stringify(shopResult);
        await db.addEmployerOrder(order_data.orderId, employer_id, shopResult);

        //and call flex order status to completed
        let vitatlityUpdateOrderResult = await flexAPI.updateOrderToCompleted(order_data.orderId);
        if (!vitatlityUpdateOrderResult.status || vitatlityUpdateOrderResult.status !== 1) {
            console.log("ERROR: Flex Update Status Bad Response", JSON.stringify(vitatlityUpdateOrderResult));
            await emailSrv.sendEmail(`Vitality Flex - Flex Update Status Bad Response ${order_data.orderId}`, JSON.stringify({vitatlityUpdateOrderResult}))
        }
    }
}


async function sendReqToExternalServices(currentEligibility, data, employer){
  try{
    console.log(`[sqsPayloadHandler -> sendReqToExternalServices] currentEligibility: ${JSON.stringify(currentEligibility)}, data: ${JSON.stringify(data)}, employer: ${JSON.stringify(employer)} `);

    let [brazeRec, new_record] = await apiGWHandler.externalServices(currentEligibility, data, employer)
    console.log(`[ExternalServicesStep] brazeRec: ${JSON.stringify(brazeRec)}, new_record: ${JSON.stringify(new_record)} `);

    let sfEmployerName = await getEmployerNameForSalesForce(employer, currentEligibility);
    const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);

    let [ saleforceResult, brazeResult] = await Promise.all([
      salesforce.createOrUpdateEligibility(currentEligibility.sf_id, new_record.eid, data.email, new_record.first_name, new_record.last_name, new_record.dob, employer.sf_eligbility_account_ID,
      new_record.phone, new_record.home_phone, sfEmployerName, employer.external_id, new_record.status, new_record.stage, new_record.targeting, undefined, new_record.gender, (currentEligibility.test_record) ? true : false),
      braze.sendUserEvent( brazeUnifiedFlag ? new_record.eid:   new_record.email, constants.Braze.UPDATE, {}, brazeRec, employer.id)
    ]);
    console.log(`[sendReqToExternalServices] External services response: saleforceResult: ${JSON.stringify(saleforceResult)}, brazeResult: ${JSON.stringify(brazeResult)} `)

    if (!new_record.sf_id && saleforceResult && saleforceResult[0] && saleforceResult[0].success === true) {
      new_record.sf_id = saleforceResult[0].id;
    }
    console.log('[sendReqToExternalServices] after updating new record:', new_record, ' current eligibility:', currentEligibility);

    let [eligibilityRes] = await db.updateEligibility(new_record, currentEligibility.id);
    console.log(`[sendReqToExternalServices] after updating eligibility: ${JSON.stringify(eligibilityRes)}`)

    let eligStatus = await updateEligibleStatus(currentEligibility, employer, data, sfEmployerName);
    console.log(`[sendReqToExternalServices ] after updating eligStatus in SF and Braze: ${JSON.stringify(eligStatus)}`)
    return eligStatus;

  } catch(err) {
    console.error('sendReqToExternalServices', err);
    await emailSrv.sendEmail(`sendReqToExternalServices - Error orders: ${JSON.stringify(data.orders)}`, JSON.stringify({err}))
  }
}

async function updateEligibleStatus(currentEligibility, employer, data, sfEmployerName){
    try {
      console.log('[updateEligibleStatus]', currentEligibility, employer);

      let differentshopEmail = currentEligibility.shop_email && currentEligibility.shop_email !== currentEligibility.email;
      console.log('differentshopEmail', differentshopEmail, JSON.stringify(currentEligibility) )

      var completedAllRedeemProducts = true;
      for (key in currentEligibility.eligible_products) {
        if (currentEligibility.eligible_products[key] === true) {
          completedAllRedeemProducts = false;
        }
      }
      console.log('completedAllRedeemProducts', completedAllRedeemProducts)

      const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);

      if (completedAllRedeemProducts){
        console.log('Completed all redeem product options...');
        return Promise.all([
          salesforce.updateAccountEligibility(currentEligibility.sf_id, currentEligibility.eid, sfEmployerName, employer.external_id, constants.EligibilityStatus.ENROLLED, constants.EligibilityStage.ENROLLED),
          differentshopEmail ? braze.sendUserEvent( brazeUnifiedFlag ? currentEligibility.eid: currentEligibility.email, constants.Braze.ENROLLED_OTHER, { b2b_shop_email: currentEligibility.shop_email },{ b2b_shop_email: currentEligibility.shop_email }, employer.id) : null
        ]);
      } else {
        return Promise.all([
          salesforce.updateEligibilityStage(currentEligibility.sf_id, constants.EligibilityStage.ENROLLED),
          differentshopEmail ? braze.sendUserEvent( brazeUnifiedFlag ?  currentEligibility.eid: currentEligibility.email, constants.Braze.ENROLLED_OTHER, { b2b_shop_email: currentEligibility.shop_email }, { b2b_shop_email: currentEligibility.shop_email }, employer.id) : null
        ]);
      }
    } catch(err){
        await emailSrv.sendEmail(`sendReqToExternalServices - Error orders: ${JSON.stringify(data.orders)}`, JSON.stringify({err}))
    }
}

exports.sqsFlowPayloadHandler = async (event, context) => {
  console.log('[sqsFlowPayloadHandler] event', event)
  for (record of event.Records) {
    try {
      console.log('[handleAPIRequest] - flow-handler', record.body);
      const data = JSON.parse(record.body)
      const employer_id = data.employer_id;
      const eligibility_id = data.eligibility_id;
      const flow_id = data.flow_id;
      let body = data.body

      if(!!!employer_id){
        return console.log({ success: false }, new Error(`ERROR missing employer ID - ${employer_id}`));
      }
      let [employer, emp_flds] = await db.getEmployer(employer_id);
      if (employer.length !== 1) {
        return console.log({ success: false }, new Error(`ERROR invalid employer ID - ${employer_id}`));
      }

      let [flow, flow_flds] = await db.getEligibilityFlow(flow_id);
      if (flow.length !== 1) {
        return console.log({ success: false }, new Error(`ERROR invalid flow ID - ${flow_id}`));
      }

      let [elig, elig_flds] = await db.getEligibility(employer[0].id, eligibility_id);
      if (elig.length !== 1) {
        return console.log({ success: false }, new Error(`ERROR invalid eligibility ID - ${eligibility_id}`));
      }

      if(flow[0].logonly !== 1){
        console.log('updating eligibility flow id...');
        let flowres = await db.updateEligibility({flow_id}, elig[0].id);
        console.log('updated eligibility flow id...', flowres);
      }

      console.log('adding flow log...');
      let [result] = await db.addEligibilityFlowLog(elig[0].id, flow_id, body.notes);
      console.log('flow log added', result);
    }
    catch(error){
      console.log(error);
      new Error(`ERROR: ${error.message}`)
    }
  }
}

const createErrorsFileAndUploadToAWS = async (errorArray,employer, s3Configuration) => {

  console.log(`writeErrorsToFileAndUploadToAWS`);

  //get new error file name
  var newFileName = createNewFileName(s3Configuration.Key);

  let errors = errorArray.map(value => `${employer.name}---${value.activity}---${value.notes}---${value.data}`).join('\n\n');;

  //upload error file to AWS
  await uploadFileToS3(newFileName, s3Configuration, errors);

  console.log("Finish error file process");
}

function createNewFileName(originalFileName) {
  console.log(`Start - create a new file name`);

  let currentFileName = originalFileName.substring(originalFileName.lastIndexOf('/')+1);
  const newFileName  = `error` + '.' + `${currentFileName}` + '.error_reports.' + getFormattedDate();
  console.log(`Finish - The new file name`,newFileName);
  return newFileName;
}

const uploadFileToS3 = async (filename, s3Configuration, body) => {
  let originalFileName = s3Configuration.Key;
  let bucket = s3Configuration.Bucket;

  console.log(`processing ${filename}...`);
  const prefixFolder = originalFileName.substr(0,originalFileName.lastIndexOf('/'));
  let fileLocation = `${prefixFolder}/` + `Error/`+ `${filename}`;

  const params = {Bucket: bucket, Key: fileLocation, ContentType:'binary', Body: Buffer.from(body, 'binary')};
  console.log("params",params);

  await s3.putObject(params).promise();
  console.log('Successfully upload file to AWS, location to: ',`${params.Bucket}${params.Key}`);
}

function getFormattedDate() {
  return moment().format("hh-mm-DD-MM-YYYY");
}