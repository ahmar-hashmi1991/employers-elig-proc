// Create clients outside of the handler
const AWS = require('aws-sdk');
const csv = require('csv-parser');
const Ajv = require('ajv');
const addKeywords = require("ajv-keywords");
const stripBomStream = require('strip-bom-stream');
const db = require('../services/rds-data-service');
const path = require('path');
const objectMapper = require('object-mapper');
const constants = require('../common/constants');
const uuid = require('uuid');
const jsonDiff = require('json-diff');
const queue = require('../services/sqs-service');
const utils = require('../common/utils');
const claims = require('./insurance-claims-file-processor');
const emailSrv = require('../services/email-service');
const jsonMap = require('../common/json-map');
const csvSrv = require('../services/csv-service');
const decryption = require('../services/decryption-service');
const secrets = require('../services/secrets-service');
const _ = require('lodash');
const s3 = new AWS.S3();
const ajv = new Ajv({allErrors: true});
addKeywords(ajv, "transform"); // Vladislav: this one used in structure of USTA employer
const multipleFilesSrv = require('../services/multipleFiles-service');
const {Transform} = require('stream');
const redis = require('../services/redis-service');

const eligibilityController = require('../controllers/eligibility-controller')

const CHUNK_SIZE = 10;
const DEFAULT_REMOVE_LIMIT = '3%'; // old-value: 40;
const DEFAULT_UPDATE_LIMIT = '3%'; // old-value: 40;
const DEFAULT_REMOVE_ENROLLED_USERS_LIMIT = '3%'; // old-value: 4;
const TEST_FILE_REGEX = '^testqa';
const TEST_EMAIL_REGEX = '^testqa';

const fileActionType = {
    success: "Upload Successfully",
    failed: "Failed",
    error: "Error"
};

const unifiedUserSecretName = `${process.env.STAGE}-unified-flag`

const response = (code, status, body) => {
    
    return {
      statusCode: code,
      body: JSON.stringify({data: body, status}),
      headers: {
        'Content-Type': 'application/json',
      }
    }
  }

const filterNewProducts = (productCodes, existingProducts) => {
    let userAlreadyEnrolledProductCodes = existingProducts
        .filter(item => item.status === constants.EligibilityStatus.ENROLLED)
        .map(item => item.product_type);

   let  productJson = productCodes.filter(productCode => !userAlreadyEnrolledProductCodes.includes(productCode));
    return productJson;
}; 

const  haveCommonElement = (arr1, arr2) =>{
    // Convert arrays to sets for faster membership checking
    const set1 = new Set(arr1);
    const set2 = new Set(arr2);

    // Check for common elements
    for (const element of set1) {
        if (set2.has(element)) {
            return true;
        }
    }

    return false;
}




/**
  * A Lambda function that logs the payload received from S3.
  */
exports.s3EmployerFileHandler = async (event, context) => {
    console.log('event', JSON.stringify(event));
    try {
        const getObjectRequests = event.Records.map(processEligibilityFile);
        return await Promise.all(getObjectRequests);
    }
    catch(err) {
        console.error('ERROR in S3 event handling', err);
        if(err.constructor.name === 'Error') throw err;
        else throw new Error(err);
    }
};

exports.createEligibilityForB2C = async(event)=>{
    try{
    console.log('event', JSON.stringify(event));
    const requestBody = JSON.parse(event.body);
    const allowedFields = ['enrollmentEnable', 'records','employerId'];
   

    const  { statusCode, body} = utils.validateEligibilityApiInputJson(requestBody,allowedFields);
    if(statusCode!==200) return response(statusCode, 'error', body);
   

   const hasDuplicateEmailOrPhone =  utils.checkDuplicateEmailOrPhone(requestBody.records);

   if(!hasDuplicateEmailOrPhone){
    return response(422, 'error', { error: 'Input Data has duplicate Email Or Phone , Please correct the input json' } );
   }

    let employerId = requestBody.employerId; 

    // get Employer details from database
    let [rows] = await db.getEmployerByID(employerId);

    // send error if employer not found
    if (!rows || !rows[0]) {
        return response(404, 'error', { error: `Employer with ${employerId} not found. Please enter valid employer id.` } );
    }

    let employer = rows[0];
    
    if(employer.structure){
        employer.structure = JSON.parse(employer.structure);
        employer._validate = handleDifferentStructure(employer);
    }
     jsonMap.setupEmployerMappingRules(employer);


     let [resellers] = await db.getReseller(employer.reseller_id);
     let reseller = resellers[0];
     console.log('Reseller is: ', JSON.stringify(reseller));
     employer.reseller_name = reseller.name;

     
    // get all the current users for the account so that we can compare current user with this user
     let [currentEligibility] = await db.getEmployerEligibilityList(employer.id);

     let records = requestBody.records;
     let normalizedList, errors;
     try{
      let  response  = transformAndValidateEligList(records, employer);
      normalizedList = response.normalizedList;

      errors = response.errors;
     }catch(error){
        return response(422, 'error', {
            error: error.message
         })
     }

     if(errors.length > 0)   return response(422, 'error', { error:`Json has ${errors.length} invalid records.  \nErrors: \n${errors.map((err,i) => `${i+1}. ${err.text}`).join('\n')}`});
     
     let [fileLogResult] = await db.createFileHistoryLog(employer.id, 'upright-file', 'test', constants.FileLogStatus.NEW);
     var fileHistLogId = fileLogResult.insertId;
     const output = [];
    
     const emails = [];
     const phones = [];
     
     for (const [i, record] of normalizedList.entries()) {
        let {normalized,eligibilityRec} = record;
        const email = eligibilityRec.email;
        const phone = eligibilityRec.phone;
      
        if (email) {
          emails.push(email);
        }
      
        if (phone) {
          phones.push(phone);
        }
      }
      
      // Generate the placeholders for the SQL query
      const emailPlaceholders = emails.map(() => '?').join(', ');
      const phonePlaceholders = phones.map(() => '?').join(', ');
      
     
      const [checkUserByEmail] =  await db.getEligibilityByFields(`email IN (${emailPlaceholders}) AND employer_id = ? AND (status != ? OR stage != ?)`, [...emails, constants.B2CAccountId, constants.INELIGIBLE, constants.INELIGIBLE]);
      if(checkUserByEmail.length){
            return response(409,'error', { error: `User with  Email ${checkUserByEmail[0].email} already exist `})
      }
      if(phones.length){
        const [checkUserByPhone] =  await db.getEligibilityByFields(` phone IN (${phonePlaceholders}) AND employer_id = ? AND (status != ? OR stage != ?)`,[...phones, constants.B2CAccountId, constants.INELIGIBLE, constants.INELIGIBLE]);
        if(checkUserByPhone.length){
              return response(409,'error', { error: `User with Phone ${checkUserByPhone[0].phone} already exist `})
        }
      }
      
              

     for(const [i, record] of normalizedList.entries()){

        let {normalized,eligibilityRec} = record;
       
        let existingIdx = findEligibilityIndex(currentEligibility, normalized, employer);
        if(existingIdx >= 0){
            output.push({
                eid: currentEligibility[existingIdx].eid,
                email: normalized.email
              });
        }
        else {
          setEid(normalized);
          const normalizedFiltered = Object.fromEntries(
            Object.entries(normalized).filter(([key, value]) => value !== ''));
          await eligibilityController.createNewEligibilityAsync(normalizedFiltered, employer, fileHistLogId,eligibilityRec);
    
          if(requestBody.enrollmentEnable && eligibilityRec?.products){
             let productJson =  eligibilityRec.products;
             const [user] =  await db.getEligibilityByEId(normalizedFiltered.eid);
             const productJsonUpdatedFormat = productJson.reduce((obj, item) => {
                obj[item] = true;
                return obj;
            }, {});

            await eligibilityController.createReEnrolledPendingOrder({ newEligRec: user[0], currElig: user[0], employer, productJson: productJsonUpdatedFormat, isNewEnrollment : true });
          }
        
          output.push({
            eid: normalizedFiltered.eid,
            email: normalizedFiltered.email
          });
           
        }
    }

    db.updateFileHistoryLog(fileHistLogId, {status: constants.FileLogStatus.SUCCESS});

    return response(200, 'success', output);
    
    } catch (error) {
        if(error instanceof SyntaxError){
            return response(400, 'error', {
                message: 'Invalid JSON'
             })
        }
         return response(500, 'error', {
            message: error?.message
         })
         
    }
}
    

exports.deleteEligibilityForB2C = async(event)=>{
    try{
        const { pathParameters } = event;
        const { eid } = pathParameters;
    
        const [rows] = await db.getEligibilityByEId(eid);
        
        if(!rows.length){
            return response(404, 'error', {
                message: `Record not found with eid ${eid}`
            })
        }
        const eligRec= rows[0];
        let [employers] = await db.getEmployerByID(eligRec.employer_id);
        const employer = employers[0];

        let [fileLogResult] = await db.createFileHistoryLog(employer.id, 'upright-file-disable-api', 'test', constants.FileLogStatus.NEW);
        let fileHistLogId = fileLogResult.insertId;
        await eligibilityController.disableEligibility(eligRec, fileHistLogId);
        return response(200, 'success', { message:"Deletion successfull" })

    }catch(error){
        console.log('error', JSON.stringify(error));
        return response(500, 'error', {
            message: 'something went wrong'
        })
        
    }
}

exports.getEligibilityForB2C = async(event)=>{
    try{
        const { pathParameters } = event;
        const { eid } = pathParameters;

        const [rows] = await db.getEligibilityByEId(eid);
        if(!rows.length){
            return response(409, 'error', {
                message: `Record not found with eid ${eid}`
            })
        }
        return response(200, 'success', rows[0] )
        

    }catch(error){
        console.log('error', JSON.stringify(error));
        return response(500, 'error', {
            message: 'something went wrong'
        })
        
    }
   
}

exports.updateEligibilityForB2C = async(event)=>{
    try{

        console.log('event', JSON.stringify(event));
        const requestBody = JSON.parse(event.body);
        const allowedFields = ['enrollmentEnable', 'records','employerId'];
       
        const  { statusCode, body } = utils.validateEligibilityApiInputJson(requestBody,allowedFields, 'update');
        if(statusCode!==200) return response(statusCode, 'error', body);


       const hasDuplicateEmailOrPhone =  utils.checkDuplicateEmailOrPhone(requestBody.records);
   
       if(!hasDuplicateEmailOrPhone){
         return response(422, 'error', { error: 'Data has duplicate Email Or Phone , Please correct the input json' } );
        }

    
        let employerId = requestBody.employerId;

        let [rows] = await db.getEmployerByID(employerId);

        // send error if employer not found
        if (!rows || !rows[0]) {
            return response(404, 'error', { error: `Employer with ${employerId} not found. Please enter valid employer id.` } );
        }

        let employer = rows[0];
        console.log('employer', JSON.stringify(employer));

        if(employer.structure){
            employer.structure = JSON.parse(employer.structure);
            employer._validate = handleDifferentStructure(employer);
        }
         jsonMap.setupEmployerMappingRules(employer);

         let records = requestBody.records;

        
         let normalizedList, errors;
         try{
          let  response  = transformAndValidateEligList(records, employer);
          normalizedList = response.normalizedList;
         
          errors = response.errors;
         }catch(error){
            return response(422, 'error', {
                error: error.message
             })
         }

         if(errors.length > 0)   return response(422, 'error', { error:`Json has ${errors.length} invalid records.  \nErrors: \n${errors.map((err,i) => `${i+1}. ${err.text}`).join('\n')}`});

        let [fileLogResult] = await db.createFileHistoryLog(employer.id, 'upright-file-update-api', 'test', constants.FileLogStatus.NEW);
        let fileHistLogId = fileLogResult.insertId;
        
        let output = [];
        for(const [i, record] of normalizedList.entries()){

            let { normalized, eligibilityRec } = record;
            const [data] = await db.getEligibilityByEId(eligibilityRec.eid);
           
            if(data.length<1){
                return response(404, 'error', { error: `${eligibilityRec.eid} not found in system`})
            }
            if(data[0].status === constants.EligibilityStatus.INELIGIBLE || data[0].stage === constants.EligibilityStatus.INELIGIBLE ){
                return response(409, 'error', { error: `${eligibilityRec.eid} cannot be updated as user is not eligible`});
            }
            
            let [rows] = await db.getEligibilityByFields(` email = ?   and eid <> ? and employer_id = ?`, [ eligibilityRec.email , eligibilityRec.eid , constants.B2CAccountId]);
            if(rows.length){
               return response(409, 'error', { error: `${eligibilityRec.email} cannot be updated for eid ${eligibilityRec.eid} as  email already exists ` })
            }
            if(eligibilityRec.phone){
                const [ rows] = await db.getEligibilityByFields(` phone = ?   and eid <> ? and employer_id = ? `, [ eligibilityRec.phone , eligibilityRec.eid, constants.B2CAccountId ]);
                 if(rows.length){
                 return response(409, 'error', { error: `${eligibilityRec.phone} cannot be updated for eid ${eligibilityRec.eid} as phone already exists ` })
               }
            }
            
        }

        for(const [i, record] of normalizedList.entries()){
            
            let { normalized,eligibilityRec } = record;
            const [rows] = await db.getEligibilityByEId(eligibilityRec.eid);
            if(rows.length > 0){
               let currElig = rows[0];
               const normalizedFiltered = Object.fromEntries(
                Object.entries(normalized).filter(([key, value]) => value !== ''));
             
            let queueAwait = true;
               await eligibilityController.updateAndEnableEligibility(normalizedFiltered,currElig, employer,fileHistLogId,eligibilityRec, queueAwait );
               output.push({
                eid:  eligibilityRec.eid,
                status:200
               })
            }else{
                output.push({
                    eid:  eligibilityRec.eid,
                    status: 404
                   })
            }
        }
        return response(200, 'success', output )

    }catch(error){
        if(error instanceof SyntaxError){
            return response(400, 'error', {
                message: 'Invalid JSON'
             })
        }
        return response(500, 'error', {
            message: error.message
        })
        
    }
}

exports.createEnrollment = async (event) => {
    try {
        console.log('event', JSON.stringify(event));
        const { pathParameters, body } = event;
        const { eid } = pathParameters;

        let isNewEnrollment = true;

        console.log('request body', body);
        const requestBody = JSON.parse(body);
        const { statusCode, body: validationResult } = utils.validateEnrollmentInputJson(requestBody);

        if (statusCode !== 200) {
            return response(statusCode, 'error', validationResult);
        }
        let  productsInEnrollmentProcess = await redis.get(`${constants.ENROLLMENT_API_SETTINGS.API_REDIS_KEY}-${eid}`);
        
        if(productsInEnrollmentProcess){
            productsInEnrollmentProcess = JSON.parse(productsInEnrollmentProcess);
            const haveCommonProducts =  haveCommonElement(productsInEnrollmentProcess, requestBody.products);

            if(haveCommonProducts){
              return response(429, 'error', { message: 'API Rate Limit Exceeded. Retry after 2 minutes' });
            }
        }

        const [rows] = await db.getEligibilityByEId(eid);

        if (!rows.length) {
            return response(409, 'error', {
                message: `Record not found with eid ${eid}`
            });
        }

        const [employer] = await db.getEmployerByID(rows[0].employer_id);

        let productJson = requestBody.products;
        const eligibility_rules = JSON.parse(employer[0].eligibility_rules);
        const allowedProductCodes = eligibility_rules?.productTypes || [];

        console.log('allowedProductCodes', JSON.stringify(allowedProductCodes));

        for (const item of productJson) {
            if (!allowedProductCodes.includes(item)) {
                return response(409, 'error', {
                    message: `${item} is not allowed for this account`
                });
            }
        }

        if (rows[0].status === constants.EligibilityStatus.INELIGIBLE) {
            return response(409, 'error', {
                message: `User with ${eid} is ineligible`
            });
        }

        if (rows[0].status === constants.EligibilityStatus.ENROLLED) {
            return response(409, 'error', {
                message: `User with ${eid} is already enrolled for the products`
            });
        }

        if (rows[0].stage === constants.EligibilityStatus.ENROLLED) {
            const [existingProducts] = await db.getRedeemedProductsList(rows[0].id);
            console.log('requestBody.products', JSON.stringify(existingProducts));
            productJson = filterNewProducts(productJson, existingProducts);
        }

        if (!productJson.length) {
            return response(409, 'error', {
                message: `You are already enrolled for ${JSON.stringify(requestBody.products)}`
            });
        }

        const productJsonUpdatedFormat = productJson.reduce((obj, item) => {
            obj[item] = true;
            return obj;
        }, {});

        await eligibilityController.createReEnrolledPendingOrder({
            newEligRec: rows[0],
            currElig: rows[0],
            employer: employer[0],
            productJson:  productJsonUpdatedFormat,
            isNewEnrollment
        }); 
        await redis.set(`${constants.ENROLLMENT_API_SETTINGS.API_REDIS_KEY}-${eid}`,JSON.stringify(productJson),constants.ENROLLMENT_API_SETTINGS.API_RATE_LIMIT_IN_SECONDS);
        return response(200, 'success', {
            message: `Enrollment started for ${eid}`
        });
    } catch (error) {
       
        if(error instanceof SyntaxError){
            return response(400, 'error', {
                message: 'Invalid JSON'
             })
        }
        return response(500, 'error', {
            message:  `Something Went Wrong`
        });
    }
};
 
async function processEligibilityFile(record) {
   
    const srcKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const params = {
        Bucket: record.s3.bucket.name,
        Key: srcKey,
    };

    try{
        const startTime = Date.now();

        if (skipProcessEligibilityFile(srcKey)) {
            return
        }

        let folder = folderOf(srcKey);
        console.log(folder);
        let fileName = srcKey.substring(srcKey.lastIndexOf('/')+1);
        let filepath = srcKey.slice(0, srcKey.lastIndexOf('/'));
        let source_name = null;
        if(!!!path.relative(filepath, srcKey)){
            console.log(`identified folder only: ${srcKey}, nothing to process...`);
            return {statusCode: 200, body: JSON.stringify({status: 'SUCCESS', file: srcKey, message: 'folder - nothing to process'})};
        }
        let folderAndPath = folder.toLowerCase() != filepath.toLowerCase() ? [folder.toLowerCase(), filepath.toLowerCase()] : [folder.toLowerCase()]
        let [rows, fields] = await db.getEmployerByFolder(folderAndPath);

        // Return an error if folder not found
        console.log('getEmployerByFolder', rows)
        if(rows.length < 1){
            console.log(`WARNING: Employer record NOT FOUND for file: ${srcKey}, the folder "${folderAndPath}" was not found`);
            throw new Error(`WARNING: Employer record NOT FOUND for file: ${srcKey}, the folder "${folderAndPath}" was not found`);
        }
        // Set the employer
        let employer = rows[0];

        const isTestFile = recogniseTestFile(fileName);

        // If we find more then 1 employer with the same folder, try to match the file name filter
        if(rows.length > 1 && !isTestFile){
            employer = rows.find(function (el) {
                let match = fileName.match(new RegExp(el.file_name_filter));
                if(match) {
                    return el;
                } else {
                    console.log(`WARNING: Found more then 1 employers with the same folder name: ${folderAndPath}, use file_name_filter to filter to a specific employer, file "${srcKey}" failed to load`);
                    throw new Error(`WARNING: Found more then 1 employers with the same folder name: ${folderAndPath}, use file_name_filter to filter to a specific employer, file "${srcKey}" failed to load`);
                }
            });
        }

        employer.eligibility_rules = JSON.parse(employer.eligibility_rules);
        console.log('ready.csv',srcKey, srcKey.includes('ready.csv'));
        if(employer.record_source == 'cron' && !srcKey.includes('ready.csv')) { //srcKey.split(".").pop() != 'done'
            console.log(`WARNING: Employer is using the cron to create records, file "${srcKey}" failed to load`);
            // throw new Error(`WARNING: Employer is using the cron to create records, file "${srcKey}" failed to load`);
            return {statusCode: 200, body: JSON.stringify({status: 'SUCCESS', file: srcKey})};
        }

        console.log('Processing eligibility for Employer: ', employer);
        // await emailSrv.sendEmail(`start processing for employer ${employer.name}`,
        //     `Start processing of eligibility file ${srcKey} for Employer ${employer.name} (${employer.external_id})`);
        await emailSrv.sendTemplateEmail(`start processing for employer - ${employer.name} (${process.env.STAGE}) ${employer.eligibility_rules.validation ? '<SIMULATION>': ''}`, {
            step: 'Start',
            datetime: new Date().toLocaleString(),
            employer: employer.name,
            employerId: employer.external_id,
            file: srcKey
        }, 'processing1');

        if(!!employer.insurance_claims){
            let claimsjson = JSON.parse(employer.insurance_claims);
            if(!!!path.relative(claimsjson.path, filepath)){
                console.log(`Insurance Claims file was identified: ${srcKey}`);
                let result = await claims.s3InsuranceClaimsFileHandler(params, employer, claimsjson);
                console.log(`FINISHED processing Insurance Claims file: ${srcKey}`);
                const newFileName = createNewFileName(srcKey,fileActionType.success)
                await emailSrv.sendEmail(`FINISHED processing Insurance Claims for employer ${employer.name}`,
                    `FINISHED processing Insurance Claims file: ${newFileName} for Employer ${employer.name} (${employer.external_id}).<br><pre>${JSON.stringify(result.stats,null,2)}</pre>`);

                await copyAndRemoveFileFromRelevantFolder(srcKey,newFileName,params.Bucket,fileActionType.success)

                return {statusCode: 200, body: JSON.stringify({status: 'SUCCESS', file: srcKey})};
            }

        }

        if(!!employer.file_name_filter && !isTestFile){
            let match = fileName.match(new RegExp(employer.file_name_filter));
            if(!match){
                await emailSrv.sendEmail(`cancel processing for employer ${employer.name} (${process.env.STAGE})`,
                    `Cancelling processing of eligibility file ${srcKey} for Employer ${employer.name} (${employer.external_id}), file name filter mismatch.`);

                return {statusCode: 200, body: JSON.stringify({status: 'CANCELLED', file: srcKey})};
            }
        }

        if(employer.record_source && employer.record_source != 'cron'){
            console.log('record_source', employer.record_source);
            let recordSource = JSON.parse(employer.record_source);

            recordSource.forEach(r =>{
                if (r.filePath) {
                    source_name = filepath.match(new RegExp(r.filePath)) ? r.source_name : source_name;
                } else {
                    source_name = fileName.match(new RegExp(r.file)) ? r.source_name : source_name;
                }
                console.log('source_name loop: ', source_name);
            })
            if(!source_name){
                await emailSrv.sendEmail(`cancel processing for employer ${employer.name} (${process.env.STAGE})`,
                    `Cancelling processing of eligibility file ${srcKey} for Employer ${employer.name} (${employer.external_id}), file name is mismatch to file name in source record. (file name : ${fileName})`);

                return {statusCode: 200, body: JSON.stringify({status: 'CANCELLED', file: srcKey})};
            }
        }

        if(source_name){
            console.log('source name', source_name);
            let mappingRules = JSON.parse(employer.mapping_rules);
            console.log('mapping by source', mappingRules[source_name]);
            if(!mappingRules[source_name]){
                await emailSrv.sendEmail(`cancel processing for employer ${employer.name} (${process.env.STAGE})`,
                `Cancelling processing of eligibility file ${srcKey} for Employer ${employer.name} (${employer.external_id}), mapping rules filter is mismatch to source name.(source name: ${source_name})`);

                return {statusCode: 200, body: JSON.stringify({status: 'CANCELLED', file: srcKey})};
            }
        }

        if(employer.structure){
            employer.structure = JSON.parse(employer.structure)
            employer._validate = handleDifferentStructure(employer, source_name);
        }
        jsonMap.setupEmployerMappingRules(employer, source_name);

        let [resellers, resellers_flds] = await db.getReseller(employer.reseller_id);
        let reseller = resellers[0];
        console.log('Reseller is: ', reseller);
        employer.reseller_name = reseller.name;

        let [currentEligibility, currentEligibility_flds] = await db.getEmployerEligibilityList(employer.id, source_name);
        console.log('Current eligibility # of records:', currentEligibility.length);

        let [fileLogResult] = await db.createFileHistoryLog(employer.id, srcKey, folder, constants.FileLogStatus.NEW);
        var fileHistLogId = fileLogResult.insertId;
        console.log('File record saved: ', fileHistLogId, fileLogResult);

        let instream = s3.getObject(params).createReadStream()
        // if (employer.parser_structure && employer.parser_structure.headerTransform !== undefined && employer.parser_structure.headerTransform.length > 0) {
        //     instream = s3.getObject(params).createReadStream().pipe(fileHeaderTransform({parserConf: employer.parser_structure}));
        // } else {
        //     instream = s3.getObject(params).createReadStream()
        // }
        console.log(typeof employer.eligibility_rules.behaviors == "object",
            !Array.isArray(employer.eligibility_rules.behaviors),
            source_name
            );
            
        if (typeof employer.eligibility_rules.behaviors == "object"
            && !Array.isArray(employer.eligibility_rules.behaviors)
            && source_name
            && employer.eligibility_rules.behaviors[source_name]) {
                console.log("assigning behaviors", employer.eligibility_rules.behaviors[source_name]);
            employer.eligibility_rules.behaviors = employer.eligibility_rules.behaviors[source_name];
        }

        console.log(typeof employer.eligibility_rules.behaviors == "object",
            !Array.isArray(employer.eligibility_rules.behaviors),
            source_name
            );
      
        if (typeof employer.eligibility_rules.behaviors == "object"
            && !Array.isArray(employer.eligibility_rules.behaviors)
            && source_name
            && employer.eligibility_rules.behaviors[source_name]) {
               
            employer.eligibility_rules.behaviors = employer.eligibility_rules.behaviors[source_name];
        }

        if (shouldUseBehaviour(employer.eligibility_rules, constants.Behaviors.DECRYPT_PGP)) {
            console.warn('shouldUseBehaviour')
            const pgpSecret = await secrets.getSecret('dario-pgp');
            instream = await decryption.decryptEligibilityFile(instream, pgpSecret);
        }

        //instream = getInstreamAfterApplyingBehaviours(instream, employer.eligibility_rules); // TODO: discuss naming for function

        // dynamic parser
        employer.parser_structure = employer.parser_structure ? JSON.parse(employer.parser_structure) : ''
        let parserFileByEmployer = employer.parser_structure ? employer.parser_structure.name : '';
        console.log('parserFileByEmployer', parserFileByEmployer);
        let parserName = parserFileByEmployer && constants.FileParser[parserFileByEmployer] ? constants.FileParser[parserFileByEmployer] : constants.FileParser.DEFAULT;
        let eligibilityRecords = await csvSrv[parserName](instream, employer.parser_structure);
        let recordsCount = eligibilityRecords.length;
        console.log(`Read ${recordsCount} new eligibility records.`);

        let stats = await processEligibility(eligibilityRecords, employer, currentEligibility, fileHistLogId, startTime, source_name, params, isTestFile);

        await db.updateFileHistoryLog(fileHistLogId, {status: constants.FileLogStatus.FILE_SUCCESS});
        let durationMs = Date.now() - startTime;
        // await emailSrv.sendEmail(`succesful file validation of employer ${employer.name}`,
        //     `SUCCESS in parsing and validating eligibility csv file ${srcKey}, # of records: ${recordsCount}, Employer ${employer.name} (${employer.external_id}), duration: ${utils.formatTime(durationMs)}
        //      Sent to processing: new users ${stats.added}, update users: ${stats.updated}, remove users: ${stats.removed}`);
        const newFileName = createNewFileName(srcKey,fileActionType.success)

        await emailSrv.sendTemplateEmail(`Successful file validation of employer ${employer.name} (${process.env.STAGE}) ${employer.eligibility_rules.validation ? '<SIMULATION>': ''}`, {
            step: 'Validation Success',
            datetime: new Date().toLocaleString(),
            employer: employer.name,
            employerId: employer.external_id,
            file: newFileName,
            totalRecords: recordsCount,
            duration: utils.formatTime(durationMs),
            stats: `File processing statistics`,
            processed: stats.processed,
            newUsers: stats.added,
            updateUsers: stats.updated,
            reviveUsers: stats.revive_users,
            removeEligibleUsers: stats.removed,
            removeEnrolledUsers: stats.removed_enrolled_users,
            minors: stats.minors,
            effectiveDate: stats.effectiveDate,
            queuedTransaction: stats.queued,
            emails: stats.emails,
            phones: stats.phones,
            addresses: stats.addresses,
        }, 'processing2')
        const result = {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', file: newFileName, records: currentEligibility.length}),
        };
        await copyAndRemoveFileFromRelevantFolder(srcKey,newFileName,params.Bucket,fileActionType.success)

        return result;
    }
    catch(err){
        await db.updateFileHistoryLog(fileHistLogId, {status: constants.FileLogStatus.ERROR, notes: err.toString()});

        const newFileName = createNewFileName(srcKey,fileActionType.failed)
        await emailSrv.sendEmail(`ERROR processing eligibility file (${process.env.STAGE})`,`ERROR processing eligibility file ${newFileName} (${process.env.STAGE}) :: ${err.toString()}`);

        await copyAndRemoveFileFromRelevantFolder(srcKey,newFileName,params.Bucket,fileActionType.failed)

        throw err;
    }
}

function handleDifferentStructure(employer, sourceName = null) {
    if (sourceName != null) {
        const structureForSource = employer.structure[sourceName];
        console.log('structureForSource: ', structureForSource);

        // Required for employers that have same structure for cobra file and eligibility file
        // May be replaced with flag\behaviour?
        if(structureForSource != null) {
            employer._validate = ajv.compile(structureForSource);
            return employer._validate;
        }
    }

    employer._validate = ajv.compile(employer.structure);
    return employer._validate;
}
function recogniseTestFile(fileName) {
    const regexp = new RegExp(TEST_FILE_REGEX, 'gm');
    const isTestFile = regexp.test(fileName);

    if(isTestFile) {
        console.log('This file is a test file as it starts with "testqa"');
    }

    return isTestFile;
}

async function getInstreamAfterApplyingBehaviours(s3ObjectParams, eligibilityRules) {
    let instream = s3.getObject(s3ObjectParams).createReadStream() // .pipe(fileHeaderTransform({parserConf: employer.parser_structure}));;

    if (shouldUseBehaviour(eligibilityRules, constants.Behaviors.DECRYPT_PGP)) {
        const pgpSecret = secrets.getSecret('dario-pgp');
        instream = await decryption.decryptEligibilityFile(instream.setEncoding('utf-8'), pgpSecret);
    }

    return instream;
}

function shouldUseBehaviour(eligibilityRules, requiredBehaviour) {
    return Array.isArray(eligibilityRules.behaviors) && eligibilityRules.behaviors.some(behaviour => behaviour === requiredBehaviour);
}

function createNewFileName(originalFileName,actionType) {
    console.log(`Start - create a new file name`);

    let currentFileName = originalFileName.substring(originalFileName.lastIndexOf('/')+1);

    const prefixFolder = originalFileName.substr(0,originalFileName.lastIndexOf('/'));

    const newFileName  = `${prefixFolder}/` + `${actionType.replace(/\s/g, '')}/`+ `${actionType.replace(/\s/g, '')}` + '.' + `${currentFileName}`  + '.' + getFormattedDate()

    console.log(`Finish - The new file name`,newFileName)

    return newFileName
}

const copyAndRemoveFileFromRelevantFolder = async (originalFileName,newFileName,bucketName,actionType) => {

    console.log(`Prepare to copy a new file`);
    console.log("Location Before Copy:",`${bucketName}/${originalFileName}`)

    var s3ParamsCopy = {}

    if (actionType == fileActionType.success) {

        s3ParamsCopy = {
            Bucket: process.env.ArchiveBucket,
            CopySource: `${bucketName}/${originalFileName}`,
            Key: `${newFileName}`
        };
        console.log("Copy to archive folder ",`${s3ParamsCopy.Bucket}/${newFileName}`)
    } else {

        s3ParamsCopy = {
            Bucket: bucketName,
            CopySource: `${bucketName}/${originalFileName}`,
            Key: `${newFileName}`
        };

        console.log("Copy to failed folder",`${s3ParamsCopy.Bucket}/${newFileName}`)
    }

    const s3ParamsRemove = {
        Bucket: bucketName,
        Key: `${originalFileName}`
    };

    console.log("s3 Params Remove ",s3ParamsRemove)

    try {
        await s3.copyObject(s3ParamsCopy).promise()
        console.log('Successfully Change file location to: ',`${s3ParamsCopy.Bucket}/${newFileName}`);

        await s3.deleteObject(s3ParamsRemove).promise()
        console.log('successfully Remove file:',`${s3ParamsRemove.Bucket}/${originalFileName}`);
    }
    catch(err) {
        console.log('ERROR in S3 event handling', err);
    }
}

const skipProcessEligibilityFile = (fileName) => {
    //In order to prevent automatic upload file to AWS after file name was changed, we need to stop the process of eligibility
    console.log('skipProcessEligibilityFile', fileName)
    return fileName.match(/(\/Error\/|\/UploadSuccessfully\/|\/Failed\/|\/outbound\/|\/outgoing\/|\/test_files\/)/)
}

exports.cronHandleIncrementalFiles = async (event, context) => {
    console.log('[cronHandleIncrementalFiles] event', JSON.stringify(event));

    let [employers] = await db.getEmployerForCronFileProcess();
    console.log(`[cronHandleIncrementalFiles] found ${employers.length} employers....`);

    for (employer of employers) {
        let bucket = event.bucket;
        let s3folder = employer.folder;
        let newFile = [];
        employer.parser_structure = employer.parser_structure && JSON.parse(employer.parser_structure) || null;
        employer.mapping_rules = employer.mapping_rules && JSON.parse(employer.mapping_rules) || null;
        employer.eligibility_rules = employer.eligibility_rules && JSON.parse(employer.eligibility_rules) || null;
        
        if (employer.eligibility_rules && employer.eligibility_rules.handleMultipleFiles) {
            return await handleMultipleFiles(employer,  bucket, s3folder);
        }

        let membersObj = {};
        let keys = null
        let useMappingRulesColumns = false
        if (employer.eligibility_rules && employer.eligibility_rules.useMappingRulesColumns) {
            useMappingRulesColumns = true
            keys = Object.keys(employer.mapping_rules)
        }
        console.log("useMappingRulesColumns >> ", useMappingRulesColumns, ". keys >> ", keys)
        const params = {
            Bucket: bucket,
            Delimiter: '/',
            Prefix: s3folder + '/'
        };

        const data = await s3.listObjects(params).promise();

        console.log('[cronHandleIncrementalFiles] s3 files', data);
        let shouldParseFile = false;

        for (let index = 1; index < data['Contents'].length; index++) {
            const fileName = data['Contents'][index]['Key'];
            let fileExts = fileName.split(".");
            let extension = fileExts.pop();
            const skipOnParseFile = fileName.includes('ready.csv') || fileName.includes('done');

            // If we need to parse the file
            if(!skipOnParseFile){
                shouldParseFile = true;
                const srcKey = decodeURIComponent(data['Contents'][index]['Key'].replace(/\+/g, " "));
                const fileParams = {
                    Bucket: bucket,
                    Key: srcKey,
                };
                membersObj = await parseFileLogic(membersObj, employer, fileParams);
                const folders = srcKey.split('/');
                const fileName =  folders.pop();
                const newName = `${folders.join('/')}/processed/${fileName}.done`;
                await renameAndRemoveFile(srcKey, bucket, process.env.ArchiveBucket, newName);
            }
        }
        // if we needed to parse at least one file and membersObj is empty then send error email
        if(!Object.keys(membersObj).length && shouldParseFile){
            await emailSrv.sendEmail(`ERROR while processing incremental file (${process.env.STAGE})`,`CSV has no records, check employer primary key. files list: ${JSON.stringify(data)}`);
            throw new Error(`CSV has no records, check employer primary key .files: ${JSON.stringify(data)}`);
        }

        newFile = Object.keys(membersObj).length ? Object.values(membersObj) : newFile ;
        // Parse obj to csv and upload to s3
        if(newFile.length > 0){
            const newNameReady = employer.name + '_' + employer.external_id + '_' + getFormattedTime() + 'eligibility_file' + '.ready.csv';
            let csv = await csvSrv.papaUnParseFile(newFile, {columns: keys});
            let csvBody = Buffer.from(csv);
            let upload = await uploadFileToS3(newNameReady, bucket, s3folder, csvBody);
            console.log('[cronHandleIncrementalFiles] Finished upload', JSON.stringify(upload));
        }
    }
}

async function handleMultipleFiles(employer, bucket, s3folder) {
    let srcKey;
    let filesToProcess = [];
    let filesProcessed = [];
    try {
        console.log("[HandleMultipleFiles]");
        if (!employer.eligibility_rules.multipleFileCount) {
            employer.eligibility_rules.multipleFileCount = 2 //default number of files = 2
        }

        const params = {
            Bucket: bucket,
            Delimiter: '/',
            Prefix: s3folder + '/'
        };

        const data = await s3.listObjects(params).promise();
        console.log("[HandleMultipleFiles]", data);
        
        let membersObj = [];
        let newFile = [];
        let keys = new Set();
        let fileCount = data['Contents'].length - 1;

        for (let index = 1; index < data['Contents'].length; index++) {
            let shouldParseFile = true;
            const fileName = data['Contents'][index]['Key'];
            let skipFile = fileName.includes('ready.csv') || fileName.includes('done');

            if (skipFile) {
                console.log("[HandleMultipleFiles] filename contains ready or done keyword, ignoring file", skipFile);
                fileCount--;
                continue;
            }

            srcKey = decodeURIComponent(data['Contents'][index]['Key'].replace(/\+/g, " "));

            const fileParams = {
                Bucket: bucket,
                Key: srcKey,
            };

            if (employer.parser_structure.parserFileWithFileName) {
                let fileName = fileParams.Key.split('/').pop().split('.')[0];
                fileStructureKey = getFileStructureKeyByFileName(fileName, employer.parser_structure);
                console.log('parseFileLogic', fileName, fileParams, 'fileStructureKey', fileStructureKey);
                shouldParseFile = !fileName || !fileStructureKey ? false : shouldParseFile;
            }

            if (!shouldParseFile) {
                console.log("[HandleMultipleFiles] filename or fileStructureKey null, ignoring file", fileName, fileStructureKey);
                fileCount--;
                continue;
            }

            filesToProcess.push(
                {
                    srcKey: srcKey,
                    bucket: bucket,
                }
            )
        }

        if (fileCount < employer.eligibility_rules.multipleFileCount) {
            console.log("[HandleMultipleFiles] returning, content length less than count", fileCount);
            return
        }

        for (let index = 1; index < data['Contents'].length; index++) {
            const fileName = data['Contents'][index]['Key'];
            const skipOnParseFile = fileName.includes('ready.csv') || fileName.includes('done');

            // If we need to parse the file
            if (!skipOnParseFile) {
                shouldParseFile = true;
                srcKey = decodeURIComponent(data['Contents'][index]['Key'].replace(/\+/g, " "));
                const fileParams = {
                    Bucket: bucket,
                    Key: srcKey,
                };

                console.log("[HandleMultipleFiles] employer.parser_structure", employer.parser_structure)

                let fileStructureKey = null;
                if (employer.parser_structure.parserFileWithFileName) {
                    let fileName = fileParams.Key.split('/').pop().split('.')[0];
                    fileStructureKey = getFileStructureKeyByFileName(fileName, employer.parser_structure);
                    console.log('parseFileLogic', fileName, fileParams, 'fileStructureKey', fileStructureKey);
                    shouldParseFile = !fileName || !fileStructureKey ? false : shouldParseFile;
                    console.log("[HandleMultipleFiles] filename or fileStructureKey", fileName, fileStructureKey);
                    if (!shouldParseFile) {
                        continue;
                    }
                }

                let [fileLogResult] = await db.createFileHistoryLog(employer.id, srcKey, folderOf(srcKey), constants.FileLogStatus.NEW);
                var fileHistLogId = fileLogResult.insertId;
                console.log('[HandleMultipleFiles] File record saved: ', fileHistLogId, fileLogResult);

                let instream = s3.getObject(fileParams).createReadStream()
                let parserName = constants.FileParser.DEFAULT;
                const fileData = await csvSrv[parserName](instream, employer.parser_structure, fileStructureKey);

                fileData.length && fileData.forEach(obj => {
                    employer.mapping_rules = employer.parser_structure.file_structure[fileStructureKey]; //using mapping rules based on file structure
                    jsonMap.setupEmployerMappingRules(employer, null);
                    let normalized = objectMapper(obj, employer.mapping_rules);
                    console.log("[HandleMultipleFiles]  normalized", normalized);
                    if (normalized) {
                        for (let key of Object.keys(normalized)) {
                            keys.add(key);
                        }
                    }
                    membersObj.push(normalized);
                })
                console.log("[HandleMultipleFiles]  membersObj", membersObj);
                const folders = srcKey.split('/');
                const fileName = folders.pop();
                const newName = `${folders.join('/')}/processed/${fileName}.done`;
                filesProcessed.push(
                    {
                        srcKey: srcKey,
                        bucket: bucket,
                        archiveBucket: process.env.ArchiveBucket,
                        newName: newName
                    }
                )
                if (filesProcessed.length == fileCount) {
                    for (let m = 0; m < filesProcessed.length; m++) {
                        let currObj = filesProcessed[m];
                        await renameAndRemoveFile(currObj.srcKey, currObj.bucket, currObj.archiveBucket, currObj.newName);
                    }
                }
            }
        }
        // if we needed to parse at least one file and membersObj is empty then send error email
        if (!Object.keys(membersObj).length) {
            await emailSrv.sendEmail(`ERROR while processing incremental (multiple case) file (${process.env.STAGE})`, `CSV has no records, files list: ${JSON.stringify(data)}`);
            throw new Error(`CSV has no records, files: ${JSON.stringify(data)}`);
        }

        newFile = Object.keys(membersObj).length ? Object.values(membersObj) : newFile;
        console.log(keys)
        // Parse obj to csv and upload to s3
        if (newFile.length > 0) {
            const newNameReady = employer.name + '_' + employer.external_id + '_' + getFormattedTime() + 'eligibility_file' + '.ready.csv';
            let csv = await csvSrv.papaUnParseFile(newFile, { columns: Array.from(keys) });
            let csvBody = Buffer.from(csv);
            let upload = await uploadFileToS3(newNameReady, bucket, s3folder, csvBody);
            console.log('[HandleMultipleFiles] Finished upload', JSON.stringify(upload));
        }
    }
    catch (err) {
        console.log("[HandleMultipleFiles] Err: ", err);

        await db.updateFileHistoryLog(fileHistLogId, { status: constants.FileLogStatus.ERROR, notes: err.toString() });

        const newFileName = createNewFileName(srcKey, fileActionType.failed)
        await emailSrv.sendEmail(`ERROR processing eligibility file (${process.env.STAGE})`, `ERROR processing eligibility file ${newFileName} (${process.env.STAGE}) :: ${err.toString()}`);

        for (let m = 0; m < filesToProcess.length; m++) {
            let currObj = filesToProcess[m];
            const newFileName = createNewFileName(currObj.srcKey, fileActionType.failed);
            await copyAndRemoveFileFromRelevantFolder(currObj.srcKey, newFileName, bucket, fileActionType.failed);
        }

        // await copyAndRemoveFileFromRelevantFolder(srcKey, newFileName, bucket, fileActionType.failed)

        throw err;
    }
}

async function parseFileLogic(membersObj, employer, fileParams){
    let fileName = null;
    let shouldParseFile = true;

    // get parser structure by file name
    let fileStructureKey = null;
    if(employer.parser_structure.parserFileWithFileName){
        fileName = fileParams.Key.split('/').pop().split('.')[0];
        fileStructureKey = getFileStructureKeyByFileName(fileName, employer.parser_structure);
        console.log('parseFileLogic', fileName, fileParams, 'fileStructureKey', fileStructureKey);
        shouldParseFile = !fileName || !fileStructureKey ? false : shouldParseFile;
    }

    // parsed file only if needed
    if(shouldParseFile){
        let instream
        console.log("employer.parser_structure",  employer.parser_structure)
        if (employer.parser_structure && employer.parser_structure.headerTransform !== undefined && employer.parser_structure.headerTransform.length > 0) {
            instream = s3.getObject(fileParams).createReadStream().pipe(fileHeaderTransform({parserConf: employer.parser_structure}));
        } else {
            instream = s3.getObject(fileParams).createReadStream()
        }

        const parserName = employer.parser_structure && employer.parser_structure.cron_parser_name ? constants.FileParser[employer.parser_structure.cron_parser_name] : constants.FileParser.DEFAULT;
        const fileData = await csvSrv[parserName](instream, employer.parser_structure, fileStructureKey);
        const primaryKeys = employer.parser_structure.primaryKeys;
        const matchDataBetweenFilesFunction = employer.parser_structure.matchMultipleFilesByFunction || constants.matchMultipleFilesByFunction.DEFAULT;
        membersObj = await multipleFilesSrv[matchDataBetweenFilesFunction](fileData, primaryKeys, membersObj, fileName);
    }

    return membersObj;
}

function getFileStructureKeyByFileName(fileName, parserStructure){
    const fileStructure = parserStructure && parserStructure.file_structure;
    return fileStructure && Object.keys(fileStructure).find(key => fileName.includes(key));
}

async function renameAndRemoveFile(srcKey, bucket, newBucket, newName){
    try {

        await Promise.all([
            await s3.copyObject({
                Bucket: newBucket,
                CopySource: `${bucket}/${srcKey}`,
                Key: `${newName}`,
            }).promise(),
            await s3.deleteObject({
                Bucket: bucket,
                Key: srcKey,
            }).promise()
        ]);
        console.log("Copied to archive folder ",`${process.env.ArchiveBucket}/${newName}, srcKey:${srcKey}`);

    } catch (err) {
        console.error(err);
    }
}

function uploadFileToS3(filename, bucket, folder, body) {
    console.log(`processing ${filename}...`);
    let params
    if (folder){
         params = {Bucket: bucket, Key: `${folder}/${filename}`, Body: body};
    } else {
        params = {Bucket: bucket, Key: `${filename}`, Body: body};

    }
    console.log('params in uploadFileToS3:', params)
    return s3.upload(params).promise();
}

function getFormattedTime() {
    let today = new Date();
    let y = today.getFullYear();
    // JavaScript months are 0-based.
    let m = today.getMonth() + 1;
    let d = today.getDate();
    let h = today.getHours();
    let mi = today.getMinutes();
    let s = today.getSeconds();
    return y + "-" + m + "-" + d + "-" + h + "-" + mi + "-" + s;
}

function getFormattedDate() {
    let today = new Date();
    let y = today.getFullYear();
    // JavaScript months are 0-based.
    let m = today.getMonth() + 1;
    let d = today.getDate();
    let h = today.getHours();
    if (h<9) {
        h = "0"+h
    }
    let mi = today.getMinutes();

    if (mi<9) {
        mi = "0"+mi
    }
    return h + ":" + mi + "-" + d + "-" + m + "-" + y;
}

function sameEligibility(e1,e2, compareFields, isCaseSensetiveRecordMatch){
    if(compareFields && compareFields.length > 0){
        let isValid = true;
        for (key in compareFields) {
            let field_name = compareFields[key];
            if(field_name == 'dob'){
                const currentDate = new Date(e1[field_name])
                const newDate = new Date(e2[field_name])
                if(currentDate.getTime() != newDate.getTime()) isValid = false;
            }
            else {
                if(e1[field_name] != e2[field_name]) isValid = false;
            }
        }
        return isValid;
    }
    if (isCaseSensetiveRecordMatch) {
        console.log("isCaseSensetiveRecordMatch", e1.first_name.toLowerCase())
        return e1.reseller_employee_id === e2.reseller_employee_id && e1.role === e2.role && e1.first_name.toLowerCase() === e2.first_name.toLowerCase();
    }

    return e1.reseller_employee_id === e2.reseller_employee_id && e1.role === e2.role && e1.first_name === e2.first_name;
}

function eligibilityKey(compareFields) {
    if(compareFields && compareFields.length > 0){
        return e => compareFields.map(f => e[f]).join('_');
    }
    return e => `${e.reseller_employee_id}${e.role}${e.first_name}`;
}

function eligibilityKeyExists(e, compareFields) {
    if(compareFields && compareFields.length > 0){
        return !compareFields.some(f => !!!e[f]);
    }
    return !!e.reseller_employee_id && !!e.role && !!e.first_name;
}

function transformAndValidateEligList(eligibilityRecords, employer) {
    let errors = [];
    let normalizedList = eligibilityRecords.reduce((output, eligibilityRec, i, inarray) => {
        if(eligibilityRec.skip){
            console.log('skipping -> ', eligibilityRec);
            return output;
        }
        
        if(employer._validate){
            console.log('validating -> ', eligibilityRec);
            let valid = employer._validate(eligibilityRec);
            if(!valid){
                console.log(`validation of file record ${i+1} failed`);
                //try to normalize the invalid rec
                console.log('normalizing invalid record -> ', eligibilityRec);
                let normalized = objectMapper(eligibilityRec, employer.mapping_rules);
                console.log('normalized invalid record -> ', normalized);
                errors.push({type: 'validation', text: `CSV invalid record ${ajv.errorsText(employer._validate.errors)}`, rec: eligibilityRec, normalized, i});
                return output;
            }
        }
        console.log('normalizing -> ', eligibilityRec);
        console.log('employer.mapping_rules -> ', employer.mapping_rules);
        let normalized = objectMapper(eligibilityRec, employer.mapping_rules);
        console.log('normalized rec -> ', normalized);

        console.log('normalized rec including termination date -> ', normalized);
        
        normalized = escapeUnwantedCharacters(normalized);

        // Adding null value for termination date if it doesn't exist in file
        // This will handle the case when an earlier disenrolled user, enrols again
        if (normalized && !normalized.termination_date) {
            normalized.termination_date = null;
            eligibilityRec.termination_date = null;
        }

        if (normalized && normalized.country) {
            normalized.country = normalized.country.slice(0,2);
        }

        console.log('normalized after escapeUnwantedCharacters -> ', normalized);
        
        output.push({normalized,eligibilityRec});
        return output;
    }, []);

    return { normalizedList, errors };
}

function escapeUnwantedCharacters(normalized) {
    let format = /[<>={}\[\];]/;
    for (const [key, value] of Object.entries(normalized)) {
        if (format.test(value)) {
            normalized[key] = encodeURIComponent(value);
            // throw new Error(`Invalid processing record - record contain suspicious characters: \{${key}: ${value}\}`);
        }
    }
    return normalized;
}

async function processEligibility(records, employer, currentEligibility, fileHistoryID, startTime, source_name, params, isTestFile){

    try{
        let stats = {
            added:0,
            updated: 0,
            removed: 0,
            queued: 0,
            records: records.length,
            validation_errors: 0,
            processed: 0,
            startTime,
            validation_mode: employer.eligibility_rules.validation ? true : false,
            minors: 0,
            effectiveDate: 0,
            deltaFile: employer.eligibility_rules.isDeltaFile ? true : false,
            grace: employer.eligibility_rules.grace ? employer.eligibility_rules.grace : null,
            graceRemoved: 0,
            revive_users: 0,
            removed_enrolled_users: 0,
            emails: 0,
            phones: 0,
            addresses: 0,
        };

        let { normalizedList, errors } = transformAndValidateEligList(records, employer);
        await Promise.all(errors.map(err => db.reportToFileLog('error', 'csv-validation', err.text, JSON.stringify(err.rec), fileHistoryID)));
        stats.validation_errors = errors.length;

        normalizedList = await handleDuplicateRecords(employer, normalizedList, fileHistoryID);
        console.log("processEligibility.currentEligibility-1", currentEligibility.length)
        errors = await handleInvalidRecords(employer, errors, currentEligibility, fileHistoryID);
        let currentEligibilityAll = currentEligibility.slice()
        console.log("processEligibility.currentEligibility-2", currentEligibility.length)

        if(errors.length > 0) throw new Error(`CSV has ${errors.length} invalid records. refer to file log table for details. \n----------- \nFile history ID: ${fileHistoryID} \nErrors: \n${errors.map((err,i) => `${i+1}. ${err.text}`).join('\n')}`);

        let batch = [];
        //  Remove minors
        if(employer.eligibility_rules.skipIfMinor){
            let minors = _.remove(normalizedList, function(n) {
                return utils.isMinorAge(employer.eligibility_rules, n.normalized.dob);
            })
            stats.minors = minors.length
            console.log(`Skip on minors feature - skipped on ${stats.minors} minors`)
        }

        //  Remove users that not in effective Date for eligibility
        if(employer.eligibility_rules.skipIfEffectiveDate) {
            let effectiveDateEligibility = _.remove(normalizedList, function(n) {
                return utils.isEffectiveDate(n.normalized.effective_date);
            })
            stats.effectiveDate = effectiveDateEligibility.length
            console.log(`Skip on effectiveDate feature - skipped on ${stats.effectiveDate} users`)
        }

        for(const [i, record] of normalizedList.entries()){
            if (shouldUseBehaviour(employer.eligibility_rules, constants.Behaviors.DUPLICATE_PHONE)) {
                console.log("Record >> ", record);
                if (record.phone && !record.home_phone) {
                    record.home_phone = record.phone;
                } else if (!record.phone && record.home_phone) {
                    record.phone = record.home_phone;
                }
                console.log("Record after change >> ", record); 
            }
    
            let {normalized,eligibilityRec} = record;
            let recnum = i+1;
            console.log(`processing ${recnum} of ${normalizedList.length}`);

            //Calculate the number of emails, phone numbers, and addresses that were processed in the file
            if (normalized.email) {
                stats.emails++;
            }
            if (normalized.phone) {
                stats.phones++;
            }
            if (normalized.address_1) {
                stats.addresses++;
            }
            console.log("currentEligibility", currentEligibility.length)
            let existingIdx = findEligibilityIndex(currentEligibility, normalized, employer);
            console.log("currentEligibility", currentEligibility.length)

            normalized = await handleTestRecord(normalized, isTestFile);

            if(existingIdx >= 0){
                let currElig = currentEligibility.splice(existingIdx, 1)[0];
                if(!!currElig.email){
                    if(!!!normalized.email){
                        normalized.email = currElig.email; // keep currnet email
                    }
                    else if(utils.isFakeEmail(currElig.email)) {
                        normalized.generated_email = 0;
                    }
                }
                else {
                    if(!!!normalized.email){

                        const { unifiedFlag } = await secrets.getSecret(unifiedUserSecretName);

                        normalized.email = utils.generateFakeEmail(employer.name, unifiedFlag);
                        normalized.generated_email = 1;
                    }
                }

                if (currElig.grace_period) {
                    console.log("existingIdx: currElig", currElig)

                    batch.push(unGraceEligibility(currElig, fileHistoryID, recnum, currentEligibility.length));
                    stats.graceRemoved++;
                }

                if(updateNeeded(normalized, currElig)){
                    console.log("existingIdx: updateNeeded")
                    batch.push(updateAndEnableEligibility(normalized, currElig, employer, fileHistoryID, recnum, normalizedList.length, eligibilityRec));
                    stats.updated++;
                    if (currElig.status === constants.EligibilityStatus.INELIGIBLE) stats.revive_users++
                }
            }
            else {
                if(!!!normalized.email){

                    const { unifiedFlag } = await secrets.getSecret(unifiedUserSecretName);

                    normalized.email = utils.generateFakeEmail(employer.name, unifiedFlag);
                    normalized.generated_email = 1;
                }
                const normalizedFileRecords = normalizedList.map(rec => rec.normalized)
                const employee = getEmployeeBySpouseCheckField(normalized, employer, currentEligibilityAll, normalizedFileRecords);
                batch.push(createNewEligibility(normalized, employer, fileHistoryID, recnum, normalizedList.length, source_name, eligibilityRec, employee.eid));
                stats.added++;
            }

            stats.processed++;
        }

        //delete remaining (not in input eligibility list)
        console.log(`remaining ${currentEligibility.length} eligibility records not in input list`);

        if (stats.deltaFile == false) {
            for(const [i,missingElig] of currentEligibility.entries()){
                let recnum = i+1;
                if([constants.EligibilityStatus.ELIGIBLE, constants.EligibilityStatus.ENROLLED].includes(missingElig.status)){
                    if (stats.grace > 0) {
                        console.log("is_grace: true", missingElig)
                        batch.push(graceEligibility(missingElig, fileHistoryID, recnum, currentEligibility.length));
                    } else {
                        console.log("is_grace: false", missingElig)
                        batch.push(disableEligibility(missingElig, fileHistoryID, recnum, currentEligibility.length));
                    }
                    stats.removed++;
                    //Removed Enrolled Users
                    console.log('missingElig', JSON.stringify(missingElig))
                    const [enrolledUsers] = await db.getRedeemedProductsList(missingElig.id);
                    console.log('enrolledUsers', JSON.stringify(enrolledUsers))
                    if(enrolledUsers && enrolledUsers.length > 0) stats.removed_enrolled_users++;
                }
            }
        }

        let [res1, res2] = await db.getEmployerEligibilityCount(employer.id);
        let eligCount = res1[0].count
        console.log(">>> currentEligibilityCount: total", {total: eligCount })

        console.log({stats:stats})
        //protection
        checkProtections('removed', stats, eligCount, stats.removed, employer.eligibility_rules.remove_limit, DEFAULT_REMOVE_LIMIT)
        checkProtections('updated', stats, eligCount, stats.updated, employer.eligibility_rules.update_limit, DEFAULT_UPDATE_LIMIT)
        checkProtections('removed enrolled users', stats, eligCount, stats.removed_enrolled_users, employer.eligibility_rules.removed_enrolled_users_limit, DEFAULT_REMOVE_ENROLLED_USERS_LIMIT)


        let chunkgen = chunks(batch, CHUNK_SIZE);
        for(let chunk of chunkgen){
            let batchres = employer.eligibility_rules.validation ? `[validation mode] records ${stats.queued} - ${stats.queued + CHUNK_SIZE - 1}` : await queue.sendBatch(chunk);
            console.debug('enqueue batch result:', batchres);
            stats.queued += chunk.length;
        }

        let queueres = await queue.sendFinishMessage(fileHistoryID, stats, params);
        console.log('SQS finish message send result', queueres);
        return stats;
    }
    catch(err){
        console.error('ERROR in record processing...', err);
        // await db.rollback();
        throw new Error(err);
    }
}

async function handleTestRecord(userRecord, isTestFile) {

    const regexp = new RegExp(TEST_EMAIL_REGEX, 'gm');
    const isTestEmail = regexp.test(userRecord.email);

    const isTestRecord = !!userRecord.test_record;

    if (!isTestEmail && !isTestRecord && !isTestFile) {
        return userRecord;
    }

    userRecord.test_record = 1;

    return userRecord;
}

function calculate_limit(limit, total) {
    if (typeof limit === 'string' ) {
        let num = Number( limit.replace('%', ''))
        if (typeof num === 'number' && num > 0) {
            return (num/100) * total
        }
    } else if (typeof limit === 'number' && limit > 0) {
        return limit
    }
    return (3/100) * total // return 3% by default
}
function checkProtections(protectio_type, stats, total, curr_stat, emp_limit, def_limit) {
    console.log({protectio_type:protectio_type, total:total,curr_stat:curr_stat, emp_limit:emp_limit,def_limit:def_limit})
    const message =`${stats.added}, update users: ${stats.updated} includes revive users: ${stats.revive_users}, remove eligible users: ${stats.removed},
                        remove enrolled users: ${stats.removed_enrolled_users}, minors: ${stats.minors},
                        effectiveDate: ${stats.effectiveDate} ... queued transaction: ${stats.queued}`
    // console.warn("message: ", message)
    let calc_def_limit = calculate_limit(def_limit, total)
    console.log("calc_def_limit",calc_def_limit)
    let calc_emp_limit = calculate_limit(emp_limit, total)
    console.log("calc_emp_limit",calc_emp_limit)

    console.log(`(${curr_stat} > (${calc_emp_limit} || ${calc_def_limit}))` , (curr_stat > (calc_emp_limit || calc_def_limit)) ? 'is truthy' : 'is falsy')
    if(curr_stat > (calc_emp_limit || calc_def_limit)){
        throw new Error(`WARNING! large number of ${protectio_type} records - ${curr_stat}\n
        File statistics:\n
        processed: ${stats.processed} file records -- \n
        new users: ${message} `);
    }
}

async function handleInvalidRecords(employer, errors, currentEligibility, fileHistoryID) {
    if (employer.eligibility_rules.processingPolicy && employer.eligibility_rules.processingPolicy.invalidRecords) {
        let policy = employer.eligibility_rules.processingPolicy.invalidRecords;
        if (policy === 'skip' || policy === 'forceSkip') {
            for (let [i, err] of errors.entries()) {
                let unskippedErrors = [];
                if (err.type === 'validation') {
                    let existingIdx = findEligibilityIndex(currentEligibility, err.normalized, employer);
                    if (existingIdx >= 0) {
                        let removedEligRec = currentEligibility.splice(existingIdx, 1);
                        await db.reportToFileLog('skip', 'csv-processing', `skipping ${removedEligRec.eid} due to invalid file record`, JSON.stringify(removedEligRec), fileHistoryID);
                    }
                    else if (eligibilityKeyExists(err.normalized, employer.eligibility_rules.compareRecords)) {
                        await db.reportToFileLog('skip', 'csv-processing', `skipping new eligibility due to invalid file record`, JSON.stringify(err.rec), fileHistoryID);
                    }
                    else {
                        if(policy != 'forceSkip') {
                            unskippedErrors.push(err);
                        } else {
                            await db.reportToFileLog('forceSkip', 'csv-processing', `force skipping new eligibility due to record without key field`, JSON.stringify(err.rec), fileHistoryID);
                        }
                    }
                }
                errors = unskippedErrors;
            }
        }
    }
    return errors;
}

function findEligibilityIndex(currentEligibility, normalized, employer) {
    return currentEligibility.findIndex(e => sameEligibility(e, normalized, employer.eligibility_rules.compareRecords, employer.eligibility_rules.isCaseSensetiveRecordMatch));
}

async function handleDuplicateRecords(employer, normalizedList, fileHistoryID) {
    if (employer.eligibility_rules.processingPolicy && employer.eligibility_rules.processingPolicy.duplicateRecords) {
        let fn, policy = employer.eligibility_rules.processingPolicy.duplicateRecords;
        if (policy === constants.ProcessingPolicy.KEEP_FIRST)
            fn = utils.uniqByKeepFirst;
        else if (policy === constants.ProcessingPolicy.KEEP_LAST)
            fn = utils.uniqByKeepLast;
        else
            throw new Error(`Invalid processing policy - duplicateRecords: ${policy}`);

        let { uniques, duplicates } = fn(normalizedList, eligibilityKey(employer.eligibility_rules.compareRecords));
        if (duplicates.length > 0) {
            await db.reportToFileLog('duplicate-records', 'csv-validation', `found ${duplicates.length} duplicate records`, JSON.stringify(duplicates), fileHistoryID);
        }
        return uniques;
    }
    else {
        let duplicates = normalizedList.filter((r, i, arr) => arr.findIndex((el, ix) => i !== ix && sameEligibility(r.normalized, el.normalized, employer.eligibility_rules.compareRecords, employer.eligibility_rules.isCaseSensetiveRecordMatch)) >= 0);
        if (duplicates.length > 0) {
            await db.reportToFileLog('duplicate-records', 'csv-validation', `found ${duplicates.length} duplicate records`, JSON.stringify(duplicates), fileHistoryID);
            throw new Error(`ERROR found duplidate records - <br>${duplicates.map(d => `${d.normalized.reseller_employee_id}|${d.normalized.role}|${d.normalized.first_name}`).join('<br>')}`);
        }
        return normalizedList;
    }
}

function getEmployeeBySpouseCheckField(fileRecord, employer, eligDbRecords, fileRecords) {
    console.log('getEmployeeBySpouseCheckField incoming data: ', { fileRecord, employer, eligDbRecords, fileRecords });
    eligDbRecords && console.log('eligDBRecords', eligDbRecords.toString());

    const notFoundEmployee = { eid: null };
    const { EMPLOYEE, CHILD } = constants.EligibilityRole;
    if (fileRecord.role === EMPLOYEE) {
        console.log(`getEmployeeBySpouseCheckField: Skip. This is fileRecord with role=${EMPLOYEE}`);
        return notFoundEmployee;
    }

    const eligRules = employer.eligibility_rules;
    const { spouseCheckField } = (process.env.NODE_ENV === 'test' && typeof eligRules === 'string') ? JSON.parse(eligRules) : eligRules;
    const spouseCheckValue = fileRecord[spouseCheckField];
    console.log('getEmployeeBySpouseCheckField spouseCheckField:', { spouseCheckFieldKey: spouseCheckField, spouseCheckValue });
    if (!spouseCheckField) {
        console.log(`No spouseCheckField in eligibility_rules of ${employer.name}`);
        return notFoundEmployee;
    }

    const searchCallback = (rec) => rec.role === EMPLOYEE && rec[spouseCheckField] === spouseCheckValue;

    //first try find employee from DB with existing eid
    const eligDbEmployee = eligDbRecords && eligDbRecords.find(searchCallback);
    console.log('getEmployeeBySpouseCheckField: Found from eligDB Employee record for current Spouse ==>', eligDbEmployee);
    if (eligDbEmployee) {
        if (fileRecord.role ==  CHILD && eligDbEmployee.dob > fileRecord.dob) {
            throw new Error('Child DOB cannot be greater than employee DOB');
        }
        return eligDbEmployee;
    }

    //if employee doesn't exist in db => find it in fileRecords and set him "eid"
    const fileEmployee = fileRecords && fileRecords.find(searchCallback);
    console.log('getEmployeeBySpouseCheckField: Found from file Employee record for current Spouse ==>', fileEmployee);
    if (fileEmployee) {
        if (fileRecord.role ==  CHILD && fileEmployee.dob > fileRecord.dob) {
            throw new Error('Child DOB cannot be greater than employee DOB');
        }
        //set "eid" value for new employee from eligibility file to use it for "parent_eid" of this fileRecord
        setEid(fileEmployee);
        return fileEmployee;
    }

    console.log(`Employee with ${spouseCheckField}=${spouseCheckValue} is not found`);
    return notFoundEmployee;
}

function createNewEligibility(eligRec, employer, fileHistoryID, i, count, sourceName, originalRecord, employeeEid) {
    console.log(`adding eligibility of ${eligRec.reseller_employee_id}-${eligRec.role}-${employer.name}`);
    const { EMPLOYEE } = constants.EligibilityRole
    setEid(eligRec) //set "eid" value for new user from eligibility file
    let b2bTargeting = employer.eligibility_rules.targeting ? employer.eligibility_rules.targeting.default === true : false;
    eligRec.targeting = b2bTargeting;
    eligRec.parent_eid = (eligRec.role === EMPLOYEE ? eligRec.eid : employeeEid); // if user is spouse or child set employeeEid
    eligRec.record_source = sourceName;
    return queue.getEligibilityParams(eligRec, null, employer, fileHistoryID, constants.EligibilityWorkerAction.ADD, i, count, originalRecord);
}

function updateAndEnableEligibility(newEligRec, currElig, employer, fileHistoryID, i, count, originalRecord) {
    console.log(`updating eligibility of ${newEligRec.reseller_employee_id}-${newEligRec.role}-${employer.name}`);
    if(currElig.status === constants.EligibilityStatus.INELIGIBLE) console.log(`Revive user ${newEligRec.reseller_employee_id}-${employer.name}`)
    return queue.getEligibilityParams(newEligRec, currElig, employer, fileHistoryID, constants.EligibilityWorkerAction.UPDATE, i, count, originalRecord);
}

function disableEligibility(disabledElig, fileHistoryID, i, count) {
    console.log(`revoking eligibility of ${disabledElig.reseller_employee_id}-${disabledElig.role}`);

    return queue.getEligibilityParams(disabledElig, null, null, fileHistoryID, constants.EligibilityWorkerAction.REMOVE, i, count);
}

function graceEligibility(disabledElig, fileHistoryID, i, count) {
    console.log(`eligibility - adding status grace to ${disabledElig.reseller_employee_id}-${disabledElig.role}`);

    return queue.getEligibilityParams(disabledElig, null, null, fileHistoryID, constants.EligibilityWorkerAction.GRACE, i, count);
}

function unGraceEligibility(disabledElig, fileHistoryID, i, count) {
    console.log(`eligibility - remove status grace to ${disabledElig.reseller_employee_id}-${disabledElig.role}`);

    return queue.getEligibilityParams(disabledElig, null, null, fileHistoryID, constants.EligibilityWorkerAction.UNGRACE, i, count);
}

function updateNeeded(newRec, oldRec) {
    console.log('comparing new <--> old', newRec, oldRec);
    let compOldObj = JSON.parse(JSON.stringify(intersectKeys(newRec, oldRec)));
    let compNewRec = JSON.parse(JSON.stringify(newRec));
    let diff = jsonDiff.diff(compOldObj, compNewRec);
    console.log('diff :: ', diff);
    if (diff || oldRec.status === constants.EligibilityStatus.INELIGIBLE) {
        return true;
    }
    console.log(`nothing to update`);
    return false;
}

function setEid(employee) {
    if (!employee.eid) {
        employee.eid = uuid.v4()
    }
};

function intersectKeys(o1, o2){
    return Object.keys(o1).reduce((o,k) => {
      if(k in o2) o[k] = o2[k];
      return o;
    }, {});
}

const parseCSV = (instream) => {
    return new Promise((resolve, reject) => {
        let results = [];

        instream.on('error', (error) => {
            reject(error.message);
        })
        .pipe(stripBomStream())
        .pipe(csv({
            separator: ',',
        }))
        .on('data', (row) => {
            row['eid'] = uuid.v4()
            results.push(row);
            
        })
        .on('end', () => {
            resolve(results);
        })
        .on('error', (err) => {
            reject(err);
        });
    })
}

function isEmpty(val){
    if(!!!val) return true;
    if(val === '\u0000') return true;
    return false;
}

const valueProcessor = ({ header, index, value }) => {
    // else if (header === 'start_week') return +moment(value, 'MM/DD/YYYY').toDate();
    // else if (header === 'end_week') return +moment(value, 'MM/DD/YYYY').toDate();
    // return !!value ? value : null;
    return isEmpty(value) ? null : value;
}

const folderOf = (key) => {
    return key.slice(0, key.indexOf('/'));
}

function* chunks(arr, n) {
    for (let i = 0; i < arr.length; i += n) {
        yield arr.slice(i, i + n);
    }
}

function getBufferFromS3(bucket, callback){
    const buffers = [];
    const s3 = new AWS.S3();
    const stream = s3.getObject(bucket).createReadStream();
    console.log("create Read Stream" , 933)
    stream.on('data', data => buffers.push(data));
    stream.on('end', () => callback(null, Buffer.concat(buffers)));
    stream.on('error', error => callback(error));
}

function getBufferFromS3Promise(bucket) {
    return new Promise((resolve, reject) => {
        getBufferFromS3(bucket, (error, s3buffer) => {
            if (error) return reject(error);
            return resolve(s3buffer);
        });
    });
};

const convertArrayOfObjectsToCSV = async (array) => {
    if (array.length === 0) {
      return ''; // Return empty string if the array is empty
    }
  
    const headers = Object.keys(array[0]); // Extract headers from the first object
    const rows = [];
  
    // Iterate over each object in the array
    for (const obj of array) {
      const values = Object.values(obj);
  
      // Format values as CSV row
      const row = values.join(',');
  
      rows.push(row);
    }
  
    // Combine headers and rows
    const csvString = `${headers.join(',')}\n${rows.join('\n')}`;
  
    return csvString;
  }
  
  
  // Convert array of objects to CSV

const fileHeaderTransform = (obj) => new Transform({

    transform(chunk, encoding, callback) {
        console.log("fileHeaderTransform runs ... ")
        let newChunk = chunk
        if (obj.parserConf !== null && obj.parserConf !== undefined) {
            let parserConf = (typeof obj.parserConf === 'string') ?  JSON.parse(obj.parserConf) : obj.parserConf

            if (parserConf.headerTransform !== undefined && parserConf.headerTransform.length > 0) {
                console.log("fileHeaderTransform headerTransform exist newChunk before", newChunk.toString())
                for (let i = 0; i < parserConf.headerTransform.length; i++){

                    let encoding = (parserConf.headerTransform[i].encoding !== undefined) ? parserConf.headerTransform[i].encoding : ''

                    let brokenHeader = (encoding === 'base64') ? utils.base64ToString( parserConf.headerTransform[i].brokenHeader) : parserConf.headerTransform[i].brokenHeader
                    let fixedHeader = parserConf.headerTransform[i].fixedHeader

                    // console.log({brokenHeader: brokenHeader, fixedHeader: fixedHeader})
                    let regex = new RegExp(brokenHeader, 'gi')
                    // console.log({regex: regex})

                    if (chunk.toString().search(regex) >= 0) {
                        newChunk = chunk.toString().replace(regex, fixedHeader);
                        console.log("fileHeaderTransform >> found broken header. newChunk after", newChunk.toString())
                        break
                    }
                }
            }
        }
        this.push(newChunk);
        callback();
    }
});

/////// FOR UT ////////
exports.fileHeaderTransform = fileHeaderTransform;
exports.processEligibility = processEligibility;
exports.uploadFileToS3 = uploadFileToS3;
// exports.setupMappingRules = setupMappingRules;
exports.getEmployeeBySpouseCheckField = getEmployeeBySpouseCheckField;
exports.createNewEligibility = createNewEligibility;
exports.transformAndValidateEligList = transformAndValidateEligList;
exports.parseCSV = parseCSV
exports.convertArrayOfObjectsToCSV = convertArrayOfObjectsToCSV
