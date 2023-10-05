const moment = require('moment');
const got = require("got");
const crypto = require('crypto');
const AWS = require('aws-sdk');

const secretsService = require('../services/secrets-service');
const db = require('../services/rds-data-service');
const sv = require('../common/validations.js');
const emailSrv = require('../services/email-service');
const sftpService = require('../services/sftp-user-service');
const { isValidPhoneNumber } = require('libphonenumber-js');
const { getEmployerSFAccount, createEmployerSFAccount, updateEmployerSFAccount } = require('../services/salesforce-service');
const secrets = require('../services/secrets-service');
const decryption = require('../services/decryption-service');

const BUCKET = process.env.EmployersBucket;
const s3 = new AWS.S3();

exports.handleApiRequest = async (event, context) => {
    console.log('event', JSON.stringify(event));
    let operation = event.requestContext.operationName;

    if(operation === 'getEmployerById'){
        let employerId = event.pathParameters.employerId;
        let employer = await getEmployerById(employerId);
        if(!employer || employer.length === 0){
            return {
                statusCode: 404,
                body: JSON.stringify({status: 'NOT FOUND', result: null})
            };
        }
        try{
            const username = employer[0].name.trim().replace(/ /g,'_');
            const secretName = `${process.env.STAGE}/SFTP/${username}`;
            const sftpDetails = await sftpService.getSftpSecretValue(secretName);
            if (Object.keys(sftpDetails).length) {
                employer[0].sftp_info = JSON.stringify(sftpDetails);
            }
            const SFResult = await getEmployerSFAccount(employerId);
            console.log(`getEmployerSFAccount SFResult  ${JSON.stringify(SFResult)}`)
            if(SFResult && SFResult.records && SFResult.records.length>0){
                employer[0].account_line = SFResult.records[0].Account_Line_of_Business__c
                employer[0].account_type = SFResult.records[0].Account_Type__c
            }

        } catch(err) {
            console.log(`Error: ${err}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: employer[0]})
        };
    }
    else if(operation === 'getEmployers'){
        let history = await getEmployersList();

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: history})
        };
    }
    else if(operation === 'getEmployerFileHistory'){
        let employerId = event.pathParameters.employerId;
        const limit = event.queryStringParameters ? event.queryStringParameters.limit || 100 : 100;
        let history = await getEmployerFileHistory(employerId, limit);

        if(!history || history.length === 0){
            return {
                statusCode: 404,
                body: JSON.stringify({status: 'NOT FOUND', result: null})
            };
        }

        history =
            history && history.length > 0
                ? history.map(item=> ({
                        ...item,
                        simulation_mode:
                        JSON.parse(item.eligibility_rules && item.eligibility_rules.trim() ? item.eligibility_rules : '{}')
                            .validation ?? false,
                        eligibility_rules: undefined,
                    }))
                : []

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: history})
        };
    }
    else if(operation === 'getEmployerFileHistoryLog'){
        let employerId = event.pathParameters.employerId;
        let histId = event.pathParameters.histId;
        let filelog = await getEmployerFileHistoryLog(employerId, histId);

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: filelog})
        };
    }
    else if(operation === 'getEnrollmentStatistics'){
        const days = event.queryStringParameters ? event.queryStringParameters.days || 30 : 30;
        let filelog = await getEnrollmentStatistics(days);

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: filelog})
        };
    }
    else if(operation === 'getFilesHistory'){
        const limit = event.queryStringParameters && !isNaN(event.queryStringParameters.limit) ?
            Number.parseInt(event.queryStringParameters.limit) || 1000 : 1000;
        let history = await getFilesHistory(limit);
        history =
            history && history.length > 0
                ? history.map(item=> ({
                        ...item,
                        simulation_mode:
                        JSON.parse(item.eligibility_rules && item.eligibility_rules.trim() ? item.eligibility_rules : '{}')
                            .validation ?? false,
                        eligibility_rules: undefined,
                    }))
                : []
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: history})
        };
    }
    else if(operation === 'getFilesHistoryStatistics'){
        const days = event.queryStringParameters ? event.queryStringParameters.days || 30 : 30;
        let history = await getFilesHistoryStatistics(days);

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: history})
        };
    }
    else if(operation === 'updateReseller'){
        let requestBody =  JSON.parse(event.body);
        const userid = event.requestContext.authorizer.userid;
        //  let validate = await sv.validate('createReseller',requestBody)
        //   console.log('validate', validate)
        // if(!!validate && validate.statusCode !== 400) {
        // requestBody.resellerId = event.pathParameters.resellerId;
        requestBody.sourceIp = event.requestContext.identity.sourceIp;
        let res = await updateResellers(event.pathParameters.resellerId, requestBody, userid);
        if(!!res && res.affectedRows > 0){
            const mailData = {
                reseller: requestBody.name,
                user_name: userid,
                launch_date : getFormattedDate(requestBody.launch_date),
            }
            emailSrv.sendTemplateEmail(`An update to the account had been made: ${requestBody.name}`, mailData, 'update-account-notification-reseller')
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
        // } else return validate;
    }
    else if(operation === 'createReseller'){
        let requestBody =  JSON.parse(event.body);
        const userid = event.requestContext.authorizer.userid;
        // let validate = await sv.validate(operation,requestBody)
        // console.log('validate', validate)
        // if(!!validate && validate.statusCode !== 400) {
        requestBody.sourceIp = event.requestContext.identity.sourceIp;
        let res = await createReseller(requestBody, userid);
        if(!!res && res.insertId > 0){
            const mailData = {
                reseller: requestBody.name,
                user_name: userid,
                launch_date : getFormattedDate(requestBody.launch_date),
            }
            emailSrv.sendTemplateEmail(`A new account has been created: ${requestBody.name}`, mailData, 'new-account-notification-reseller')
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
        // } else return validate;
    }
    else if(operation === 'createNewEmployer'){
        let reqBody = JSON.parse(event.body);
        const userid = event.requestContext?.authorizer?.userid;
        // let validate = await sv.validate(operation,reqBody)
        // console.log('validate', validate)
        // if(!!validate && validate.statusCode !== 400) {
        if (!reqBody || reqBody.length === 0 || reqBody == 'undefined') {
            return {
                statusCode: 404,
                body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
            };
        }
        let resellerEid = event.pathParameters.resellerId;
        const sftp_info = reqBody.sftp_info;
        delete reqBody.sftp_info;
        let result = await createNewEmployer(resellerEid, reqBody, userid);
        if(!!result && result.insertId > 0){

            if( 
                !!reqBody.lp_url && 
                typeof reqBody.lp_url === 'string' && 
                String(reqBody.lp_url).trim() !== '' 
            ){
                const lpMailData = {
                    user_name: userid,
                    lp_url: reqBody.lp_url,
                }

                emailSrv.sendTemplateEmail(`Admin tool notification: a new LP is required`, lpMailData, 'new-lp-required')
            }

            const mailData = {
                reseller: result.reseller_name, // TBD add reseller from result
                user_name: userid,
                launch_date : getFormattedDate(reqBody.launch_date),
                employer_name: reqBody.name
            }
            try {
                const regex= / /ig;
                const name = reqBody.name.trim().replace(regex, '_')
                console.log("SF Employer Name -- ",name)
                const SFResult = await createEmployerSFAccount(name, result.external_id, reqBody.account_line , reqBody.account_type) 
                console.log("SFResult -- ",SFResult)
                if(SFResult.id){
                    const SFDbResult = await db.updateEmployerSalesforceId(result.external_id, SFResult.id)
                    console.log("SFDbResult -- ",SFDbResult)
                    // add check if db updated and uncomment next line
                    // result.sf_eligbility_account_ID = SFResult.id;
                }
            } catch (error) {
                console.log("Error in Create Salesforce account ", error)
            }
            emailSrv.sendTemplateEmail(`A new account has been created: ${reqBody.name}`, mailData, 'new-account-notification-employer')
            // ! Not using it here
            // if (sftp_info) {
                // const username = reqBody.name.trim().replace(/ /g,'_');
                // const employer_sftp_info = JSON.parse(sftp_info);
                // if (typeof(employer_sftp_info) === 'object') {
                //     const res = await sftpService.sftpUserService(username, employer_sftp_info);
                // }
            // }
        }
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'SUCCESS', result: result })
        };
        // } else return validate;
    }
    else if(operation === 'updateEmployer'){
        let reqBody = JSON.parse(event.body);
        const userid = event.requestContext?.authorizer?.userid;
        // let validate = await sv.validate('createNewEmployer',reqBody)
        // console.log('validate', validate)
        // if(!!validate && validate.statusCode !== 400) {
        if (!reqBody || reqBody.length === 0 || reqBody == 'undefined') {
            return {
                statusCode: 404,
                body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
            };
        }
        let resellerId = event.pathParameters.resellerId;
        let employerEid = event.pathParameters.externalId;
        const sftp_info = reqBody.sftp_info;
        delete reqBody.sftp_info;
        let account_line = reqBody.account_line;
        let account_type = reqBody.account_type;
        delete reqBody.account_line
        delete reqBody.account_type

        const [ employerData ] = await getEmployerById(employerEid);
        // console.log("employerData JTEST:", employerData);
        let result = await updateEmployer(resellerId, employerEid, reqBody, userid);
        if(!!result && result.affectedRows > 0){
            const mailData = {
                reseller: result.reseller_name, // TBD add reseller from result
                user_name: userid,
                launch_date : getFormattedDate(reqBody.launch_date),
                employer_name: reqBody.name
            }
            emailSrv.sendTemplateEmail(`An update to the account had been made: ${reqBody.name}`, mailData, 'update-account-notification-employer')
            // ! Not using it here!
            // if (sftp_info) {
                // const username = reqBody.name.trim().replace(/ /g,'_');
                // const employer_sftp_info = JSON.parse(sftp_info);
                // if (typeof(employer_sftp_info) === 'object') {
                //     const res = await sftpService.sftpUserService(username, employer_sftp_info);
                // }
            // }

            if( 
                !!reqBody.lp_url && 
                typeof reqBody.lp_url === 'string' && 
                String(reqBody.lp_url).trim() !== ''  &&
                employerData && typeof employerData === 'object' &&
                employerData.lp_url.trim() !== reqBody.lp_url.trim() 
            ){
                const lpMailData = {
                    user_name: userid,
                    lp_url: reqBody.lp_url,
                }

                emailSrv.sendTemplateEmail(`Admin tool notification: a new LP is required`, lpMailData, 'new-lp-required')
            }
            try {
                const GetSFResult = await getEmployerSFAccount(employerEid);
                if(GetSFResult && GetSFResult.records && GetSFResult.records.length){
                    const SFResult = await updateEmployerSFAccount(employerEid, account_line , account_type) 
                    console.log("updateEmployerSFAccount SFResult -- ",SFResult)
                }else{
                    const SFResult = await createEmployerSFAccount(reqBody.name, employerEid, account_line , account_type) 
                    console.log("SFResult -- ",SFResult)
                }
            } catch (error) {
                console.log(`error in updateEmployerSFAccount  ${JSON.stringify(error)}`)
            }
        }
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'SUCCESS', result: result })
        };
        // } else return validate;
    }
    else if(operation === 'getEmployerChangeHistory'){
        let externalId = event.pathParameters.employerId;
        let history = await getEmployerChangeHistory(externalId);
        if(!history || history.length === 0){
            return {
                statusCode: 404,
                body: JSON.stringify({status: 'NOT FOUND', result: null})
            };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: history})
        };
    }
    else if(operation === 'getResellerHistoryById'){
        let id =  event.pathParameters.resellerId;
        let res = await getResellerHistoryById(id);
        if(!res || res.length === 0){
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Records Not Found', result: null})
            };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
    }
    else if(operation === 'getResellerList'){
        let res = await getResellerList();
        if(!res || res.length === 0){
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Records Not Found', result: null})
            };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
    }
    else if(operation === 'getResellerByExternalId'){
        let id =  event.pathParameters.resellerId;
        let res = await getResellerByExternalId(id);
        if(!res || res.length === 0){
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Records Not Found', result: null})
            };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
    }
    else if(operation === 'getEnrollmentSetupById'){
        let id =  event.pathParameters.employerId;
        let res = await getEnrollmentSetupById(id);
        if(!res || res.length === 0){
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Records Not Found', result: null})
            };
        }
        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: res})
        };
    }
    else if(operation === 'updateEnrollmentSetupById'){
        const respObj = {statusCode: 200, body: 'Employer Enrolment setup has been Updated Successfully'}
        try{
            let id =  event.pathParameters.employerId;
            let reqBody = JSON.parse(event.body);
            let validate = await sv.validate('employerEnrolmentSetup', reqBody);
            if(!!validate && validate.statusCode !== 400) {
                if (!reqBody || reqBody.length === 0 || reqBody === 'undefined') {
                    return {
                        statusCode: 404,
                        body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
                    };
                }
                // * Beginning db transactions process to store DB changes
                await db.beginTransaction();
                let res = await updateEnrollmentSetupById(JSON.stringify(reqBody), id);
                if (!res || res.length === 0) {
                    return {
                        statusCode: 409,
                        body: JSON.stringify({status: 'Records Not Found', result: null})
                    };
                } else {
                    // * If records updated successfully inside db, then sending data to my_dario shop
                    let opts = {
                        method: 'POST',
                        url: `${process.env.MYDARIO_SHOP_URL}/wp-json/api/v1/dr-update-clinic`,
                        json: {
                            ...reqBody
                        },
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    };
                    console.log("\n\n\n\n\n\nMYDARIO_SHOP REQ ---> ", JSON.stringify(opts));
                    let mydarioShopResponse = await got(opts).json();
                    console.log("\n\n\n\n\n\nMYDARIO_SHOP RES ---->>>>", mydarioShopResponse)

                    // * If status comes false from API or any error occurs then reverting all changes
                    if( !mydarioShopResponse || mydarioShopResponse.status == 'false') {
                        throw new Error('Something went wrong while updating the mydario_shop API')
                    }
                    // * Committing DB changes at the end
                    await db.commit();
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            status: 'SUCCESS',
                            result: 'Employer Enrolment setup has been Updated Successfully'
                        })
                    };
                }
            } else return validate;

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e);
            // * Rolling back all db changes due to some error occurred
            await db.rollback();
            respObj.statusCode = 500;
            respObj.body = 'Internal server error';
            respObj.message = e.message;
            return respObj;
        }
    } else if(operation === 'importEmployer'){
        let requestBody = JSON.parse(event.body);
        const userid = event.requestContext.authorizer.userid;
        const data = requestBody.file;
        const text = Buffer.from(data, 'base64').toString('utf8');
        const jsonData = JSON.parse(text);
        let res = await importEmployerFunction(jsonData, userid);
        console.log("res importEmployer function", res)
        if (!res || res.statusCode !== 200) {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    status: res.body || 'Something went wrong',
                    result: null
                })
            };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    status: 'SUCCESS',
                    result: 'File Imported Successfully'
                })
            };
        }
    } else if(operation === 'decryptFileAndSendHeaders'){

        const {fileData, contentType, fileName} = JSON.parse(event.body);
        console.log("fileData ",fileData)
        const bufferData = Buffer.from(fileData, 'base64');
        console.log("bufferData ",bufferData)

        // const isFileValid = validateFileType(contentType,fileName);
        // if (!isFileValid) {
        //     return {
        //         statusCode: 409,
        //         body: JSON.stringify({status: 'Not a valid file type'})
        //     };
        // }
        // console.log("bufferData ", bufferData)
        try {
            const pgpSecret = await secrets.getSecret('dario-pgp');
            const dataFile = await decryption.decryptEligibilityFile(bufferData, pgpSecret);
            console.log("dataFile ",dataFile)
            return {
                statusCode: 200,
                body: JSON.stringify({
                    status: 'SUCCESS',
                    result: {dataFile}
                })
            };
        } catch (error) {
            console.log('Error in decryptFileAndSendHeaders', error)
            return {
                statusCode: 409,
                body: 'Something went wrong'
            };
        }

    } else if(operation === 'exportEmployerResellerData'){
        let params = event.pathParameters;
        params.email = event.requestContext?.user?.email;
        let res = await exportEmployerResellerData(params);
        if (!res || res.length === 0) {
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Records Not Found', result: null})
            };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    status: 'SUCCESS',
                    result: res
                })
            };
        }
    }else if(operation === 'uploadEmployerFile'){
        let params = event.pathParameters;
        console.log('>>>>>>>>>>>>>>', JSON.stringify(event))
    }
    else if( operation === 'deactivateEmployer' ){
        console.log('Inside deactivateAccount API --->')
        const respObj = {statusCode: 200, body: 'Account terminated successfully!'}
        const defaultStatuses = ['active', 'inactive']
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            // * Get Status from request body
            let { status } = event.body ? JSON.parse(event.body) : {}

            console.log('data --->>', employerId, status)
            let [[employer]] = await db.getEmployer(employerId)

            if( !employer ) throw new Error('Invalid employer id')

            console.log('Fetched employer data ---->>>>', employer)

            // * Configure proper status of employer (activation or deactivation)
            status = status && defaultStatuses.includes(status) ? status : defaultStatuses[1]

            // * beginning transaction for temporarily changing db values
            await db.beginTransaction()

            // * update status of employer
            let [statusUpdated] =  await db.updateEmployerStatus(employerId, status)

            // * Checking if employer status gets updated or not
            console.log('Employer Data ---->>>>', statusUpdated)
            if( !statusUpdated || statusUpdated?.changedRows <= 0 ) throw new Error('Unable to update employer status')

            // * Preparing the current date for termination date for eligibility_list related to employer
            const currentDate = moment().format('YYYY-MM-DD')
            console.log('Current Date ---->>>>', currentDate)

            // * If primary key based id not found then throw error (Will be used in eligibility list table)
            let {id: employerCoreId, name: employerName, sftp_users_list} = employer
            if( !employerCoreId || !employerName ) throw new Error('Employer primary key ID or employer name not found')
            console.log('employer primary key id & employerName ---->>>>', employerCoreId, employerName)

            // * update termination date for all users in eligibility list table which are related to this employer
            await db.terminateEligibilityUsersFromEmployerId( employerCoreId, currentDate )

            // * Starting deletion of AWS secrets related to this employer

            // * preparing secretName for deleting AWS secret credentials of that employers
            if( !sftp_users_list ) sftp_users_list = []
            else sftp_users_list = JSON.parse(sftp_users_list)
            for( let i=0; i< sftp_users_list.length; i++ ){
                const item =  sftp_users_list[i]
                const sftpUserName = `${employerId}_${item.id}`
                const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`
                const isSftpUserExist = await secretsService.checkSftpUserExist(secretName)
                if( isSftpUserExist ){
                    // * At last (finally!)... Deleting secret!
                    const userDeletedStatus = await secretsService.deleteSftpUser(secretName)
                    console.log('userDeletedStatus log ---->>>>', userDeletedStatus)
                    if( userDeletedStatus?.statusCode === 400){
                        throw new Error( userDeletedStatus?.body?.message  || 'Something went wrong while deleting the AWS secrets' )
                    }
                }
            }

            // * Kept it for future reference
            // const sftpUserName = employerName.trim().replace(/ /g,'_')
            // const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`

            // const isSftpUserExist = await secretsService.checkSftpUserExist(secretName)

            // if( !isSftpUserExist ){
            //     console.log('SFTP User not exists, so no need to delete')
            //     // * since end of API, commiting DB changes
            //     await db.commit()
            //     return respObj
            // }

            // // * At last (finally!)... Deleting secret!
            // const userDeletedStatus = await secretsService.deleteSftpUser(secretName)

            // console.log('userDeletedStatus log ---->>>>', userDeletedStatus)

            // if( userDeletedStatus?.statusCode === 400){
            //     throw new Error( userDeletedStatus?.body?.message  || 'Something went wrong while deleting the AWS secrets' )
            // }

            // * Committing the db changes at the end
            await db.commit()

            // * send response
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            // * Rolling back all db changes due to some error occurred
            await db.rollback()
            respObj.statusCode = 500
            respObj.body = 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'deleteTestUsers' ){
        console.log('Inside deleteTestUsers API --->')
        const respObj = {statusCode: 200, body: 'Account\'s test users deleted successfully!'}
        const defaultStatuses = ['active', 'inactive']
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            // * Get Status from request body
            let { status } = event.body ? JSON.parse(event.body) : {}

            console.log('data --->>', employerId, status)
            let [[employer]] = await db.getEmployer(employerId)

            if( !employer ) throw new Error('Invalid employer id')

            console.log('Fetched employer data ---->>>>', employer)

            // * Configure proper status of employer (activation or deactivation)
            status = status && defaultStatuses.includes(status) ? status : defaultStatuses[1]

            // * Preparing the current date for termination date for eligibility_list related to employer
            const currentDate = moment().format('YYYY-MM-DD')
            console.log('Current Date ---->>>>', currentDate)

            // * If we get status active from request body, this means we wanted to again mark test users as active
            if(status == 'active') {
                currentDate = ''
            }

            // * If primary key based id not found then throw error (Will be used in eligibility list table)
            const {id: employerCoreId} = employer
            if( !employerCoreId ) throw new Error('Employer primary key ID not found')
            console.log('employer primary key id ---->>>>', employerCoreId)

            // * update termination date for all users in eligibility list table which are related to this employer and test record is 1
            await db.deleteTestUsersFromEmployerId( employerCoreId, currentDate )

            // * send response
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            respObj.statusCode = 500
            respObj.body = 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'fetchSftpList' ){
        console.log('Inside fetchSftpList API --->')
        const respObj = {statusCode: 200, body: 'Sftp users fetched successfully!'}
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            let [[employer]] = await db.getEmployer(employerId)

            if( !employer ) throw new Error('Invalid employer id')

            console.log('Fetched employer data ---->>>>', employer)

            // * Fetch sftp_users_list from employer data
            let {sftp_users_list} = employer
            if( !sftp_users_list ) sftp_users_list = []
            else sftp_users_list = JSON.parse(sftp_users_list)
            console.log('sftp_users_list ---->>>>', sftp_users_list)

            // * send response
            respObj.body = JSON.stringify({sftp_users_list})
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            // respObj.body = 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'createSftpUser' ){
        console.log('Inside createSftpUser API --->')
        const respObj = {statusCode: 200, body: 'Sftp user created successfully!'}
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            const userid = event.requestContext.authorizer.userid;
            console.log("userid ---->>>>", userid)

            // * Get Status from request body
            let { ip } = event.body ? JSON.parse(event.body) : {}

            console.log('data --->>', employerId, ip)
            let [[employer]] = await db.getEmployer(employerId)

            if( !employer ) throw new Error('Invalid employer id')

            console.log('Fetched employer data ---->>>>', employer)

            let employerFolderName = employer.name.trim().replace(/ /g,'_');

            // * beginning transaction for temporarily changing db values
            await db.beginTransaction()

            //* Check if folder exists with this folder name in s3
            console.log('\n\n\n\nMY BUCKET ---->>>> ',BUCKET ,' :END\n\n\n\n')
            let folderExists = await checkFolderExists(BUCKET,employerFolderName)

            if( !folderExists ){
                const keyList = [`${employerFolderName}/claims/`, `${employerFolderName}/test_files/`, `${employerFolderName}/outgoing/`, `${employerFolderName}/eligibility/incoming/Error/`, `${employerFolderName}/eligibility/incoming/Failed/`];
                for (const key of keyList) {
                    const params = {
                        Bucket: BUCKET,
                        Key: key,
                        Body: '',
                    };
                    const s3Upload = await s3.upload(params).promise();
                    if (!s3Upload) {
                        throw new Error(`Folder could not be created ${key}`)
                    }
                }
            }

            // * update folder for employer
            await db.updateEmployerFolder( `${employerFolderName}/eligibility/incoming`, employerId)

            // * generate random password for sftp user
            const sftpPassword = generateRandomPassword(12)

            // * Preparing the current date for storing in sftp users list
            const currentDate = moment().format('YYYY-MM-DD hh:mm:ss')
            console.log('Current Date ---->>>>', currentDate)

            // * Fetch sftp users list from employer data
            let {sftp_users_list} = employer
            if( !sftp_users_list ) sftp_users_list = []
            else sftp_users_list = JSON.parse(sftp_users_list)
            console.log('employer primary key id ---->>>>', sftp_users_list)

            // * A validation check if there are upto 4 sftp users exists already or not?
            if( sftp_users_list.length >=4 ) throw new Error('Only 4 sftp users creation allowed per employer!')

            const new_sftp_user_id = sftp_users_list.length <=0 ? 1 : sftp_users_list[sftp_users_list.length-1].id + 1
            sftp_users_list.push({
                id: new_sftp_user_id,
                datetime: currentDate,
                ...(userid) && {created_by: userid},
                ...(ip) && {ip}
            })

            // * update sftp users list for employer
            await db.updateEmployersSftpUsers( employerId, JSON.stringify(sftp_users_list))

            const sftpUserName = `${employerId}_${new_sftp_user_id}`
            const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`

            const isSftpUserExist = await secretsService.checkSftpUserExist(secretName)
            const secretData = {
                'Password': sftpPassword,
                'HomeDirectory': `${employerFolderName}`,
                ...(ip) && {'IPWhiteList': ip}
            }

            const secretParams = {
                'SecretId': secretName,
                'SecretString': JSON.stringify(secretData),
            }

            let secretRes = null
            if( !isSftpUserExist ) {
                secretParams['Tags'] = [{Key: 'Application', Value: 'admin'}]
                secretParams['Name'] = secretName
                delete secretParams['SecretId']
                secretRes = await secretsService.createSftpUser(secretParams)
            }else{
                secretRes = await secretsService.updateSftpUser(secretParams)
            }

            console.log('secretRes log ---->>>>', secretRes)

            if( secretRes?.statusCode === 400){
                throw new Error( secretRes?.body?.message  || 'Something went wrong while creating/updating the AWS secrets' )
            }

            // * Committing the db changes at the end
            await db.commit()

            // * send response
            respObj.body = JSON.stringify({
                message:respObj.body,
                data: {
                    credentials: `username=${sftpUserName}\npassword=${sftpPassword}`,
                    new_user: {
                        id: new_sftp_user_id,
                        datetime: currentDate,
                        ...(userid) && {created_by: userid},
                        ...(ip) && {ip}
                    }
                }
            })
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            await db.rollback()
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'deleteSftpUser' ){
        console.log('Inside deleteSftpUser API --->')
        const respObj = {statusCode: 200, body: 'Sftp user deleted successfully!'}
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            // * Get Status from request body
            let { sftp_user_id } = event.body ? JSON.parse(event.body) : {}

            console.log('data --->>', employerId, sftp_user_id)
            let [[employer]] = await db.getEmployer(employerId)

            if( !employer || !sftp_user_id ) throw new Error('Invalid employer id or sftp_user_id')

            console.log('Fetched employer data ---->>>>', employer)

            // * Fetch sftp users list from employer data
            let {sftp_users_list} = employer
            if( !sftp_users_list ) sftp_users_list = []
            else sftp_users_list = JSON.parse(sftp_users_list)
            console.log('employer sftp_users_list ---->>>>', sftp_users_list)

            // * Filtering the sftp data for sftp_users_list
            sftp_users_list = sftp_users_list.filter(item=>item.id != sftp_user_id)

            // * beginning transaction for temporarily changing db values
            await db.beginTransaction()

            // * update employer data with the updated sftp users list
            await db.updateEmployersSftpUsers( employerId, JSON.stringify(sftp_users_list) )

            // * preparing secretName for deleting AWS secret credentials of that employers
            const sftpUserName = `${employerId}_${sftp_user_id}`
            const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`

            const isSftpUserExist = await secretsService.checkSftpUserExist(secretName)

            if( !isSftpUserExist ){
                console.log('SFTP User not exists, so no need to delete')
                // * since end of API, commiting DB changes
                await db.commit()
                return respObj
            }

            // * At last (finally!)... Deleting secret!
            const userDeletedStatus = await secretsService.deleteSftpUser(secretName)

            console.log('userDeletedStatus log ---->>>>', userDeletedStatus)

            if( userDeletedStatus?.statusCode === 400){
                throw new Error( userDeletedStatus?.body?.message  || 'Something went wrong while deleting the AWS secrets' )
            }

            // * Committing the db changes at the end
            await db.commit()

            // * send response
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            // * Rolling back all db changes due to some error occurred
            await db.rollback()
            respObj.statusCode = 500
            // respObj.body = 'Internal server error'
            respObj.body = e.message ?? 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'updateSftpUserIp' ){
        console.log('Inside updateSftpUserIp API --->')
        const respObj = {statusCode: 200, body: 'Sftp users ip updated successfully!'}
        try{
            //* Get Employer ID URL query params
            const employerId =  event.pathParameters.employerId
            console.log("EMPLOYERID ---->>>>", employerId)

            // * Get Status from request body
            let { ip } = event.body ? JSON.parse(event.body) : {}

            console.log('data --->>', employerId, ip)

            let [[employer]] = await db.getEmployer(employerId)

            if( !employer ) throw new Error('Invalid employer id')
            if ( !ip || typeof ip === 'string' && ip.trim() === '' ) ip = ''
            console.log('Fetched employer data ---->>>>', employer)

            // * Starting transaction
            await db.beginTransaction()

            // * Fetch sftp user list from employer data
            let {sftp_users_list} = employer
            if( !sftp_users_list ) sftp_users_list = []
            else sftp_users_list = JSON.parse(sftp_users_list)
            console.log('employer sftp users list ---->>>>', sftp_users_list)

            // * updating employer sftp IPs into employers table
            sftp_users_list = sftp_users_list.map(item=>({...item, ip}))
            await db.updateEmployersSftpUsers( employerId, JSON.stringify(sftp_users_list) )

            // * Updating secret ip for each sftp user associated with employer
            for( let i=0; i< sftp_users_list.length; i++ ){
                const item =  sftp_users_list[i]
                const sftpUserName = `${employerId}_${item.id}`
                const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`
                const isSftpUserExist = await secretsService.checkSftpUserExist(secretName)
                if( isSftpUserExist ){
                    // * At last (finally!)... Updating secret!
                    const secretValue = await secretsService.getSecret(secretName)
                    if( !ip ) delete secretValue.IPWhiteList
                    const secretData = {
                        ...secretValue,
                        ...(ip) && {'IPWhiteList': ip}
                    }
                    const secretParams = {
                        'SecretId': secretName,
                        'SecretString': JSON.stringify(secretData),
                    }
                    const secretRes = await secretsService.updateSftpUser(secretParams)
                    console.log('userDeletedStatus log ---->>>>', secretRes)
                    if( secretRes?.statusCode === 400){
                        throw new Error( secretRes?.body?.message  || 'Something went wrong while updating the AWS secrets' )
                    }
                }
            }

            // * Committing changes
            await db.commit()

            // * send response
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            await db.rollback()
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            // respObj.body = 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if( operation === 'getSkusList' ){
        console.log('Inside getSkusList API --->')
        const respObj = {statusCode: 200, body: 'Skus List Fetched Successfully'}
        try{
            let [data] = await db.getEligibilitySkusList()

            if( !data ) data = []
            console.log('Fetched sku list ---->>>>', data)

            respObj.body = JSON.stringify({data})

            // * send response
            return respObj

        }catch(e){
            console.log(`ERROR OCCURRED: ${e.message}`, e)
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            respObj.message = e.message
            return respObj
        }
    }
    else if(operation === 'getUsers'){
        let users = await getAdminUsersList()

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: users})
        };
    }
    else if(operation === 'getUserById'){
        // Get User ID from URL query params
        const userId =  event.pathParameters.userId
        let user = await getAdminUserByID(userId)

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: user})
        };
    }
    else if(operation === 'createUser'){
        // Create admin user
        let reqBody = JSON.parse(event.body)
        const userid = event.requestContext.authorizer.userid
        try{
            if (!reqBody || reqBody.length === 0 || reqBody == 'undefined') {
                return {
                    statusCode: 404,
                    body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
                }
            }

            let res = await createAdminUser(reqBody)
            if(!!res && res.insertId > 0){
                const mailData = {
                    email: reqBody.email,
                    user_name: userid,
                }
                // Send email to IT support for new SSO user creation
                emailSrv.sendITSupportEmail(`Create SSO for Backoffice access for: ${reqBody.email}`, mailData, 'new-admin-user-notification')
            }
            return {
                statusCode: 200,
                body: JSON.stringify({status: 'SUCCESS', result: res})
            }
        }
        catch(e) {
            console.log(`ERROR OCCURRED: ${e.message}`, JSON.stringify(e))
            let respObj = {}
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            return respObj
        }
    }
    else if(operation === 'getUserByEmail'){
        // Get admin user details by email id
        let user_email = event.pathParameters.email
        try{
            if (!user_email) {
                return {
                    statusCode: 404,
                    body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
                }
            }

            let res = await getAdminUserByEmail(user_email)
            return {
                statusCode: 200,
                body: JSON.stringify({status: 'SUCCESS', result: res})
            }
        }
        catch(e) {
            console.log(`ERROR OCCURRED: ${e.message}`, JSON.stringify(e))
            let respObj = {}
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            return respObj
        }
    }
    else if(operation === 'updateUser'){
        let reqBody = JSON.parse(event.body)
        // Get Admin User ID URL query params
        const userId =  event.pathParameters.userId
        try{
            if (!userId || !reqBody || reqBody.length === 0 || reqBody == 'undefined') {
                return {
                    statusCode: 404,
                    body: JSON.stringify({status: 'Request Body Not Found', result: 'Invalid Input!'})
                }
            }

            let res = await updateAdminUser(reqBody, userId)
            return {
                statusCode: 200,
                body: JSON.stringify({status: 'SUCCESS', result: res})
            }
        }
        catch(e) {
            console.log(`ERROR OCCURRED: `, JSON.stringify(e))
            let respObj = {}
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            return respObj
        }
    }
    else if(operation === 'updateUserLogin'){
        // Get Admin User ID URL query params
        const userId =  event.pathParameters.userId
        try{
            let [user] = await getAdminUserByID(userId)
            console.log(user.email);
            if (!user || user == 'undefined') {
                return {
                    statusCode: 404,
                    body: JSON.stringify({status: 'User Not Found', result: 'Invalid Input!'})
                }
            }

            let res = await updateAdminUserLogin(user, userId)
            return {
                statusCode: 200,
                body: JSON.stringify({status: 'SUCCESS', result: res})
            }
        }
        catch(e) {
            console.log(`ERROR OCCURRED: ${e.message}`, JSON.stringify(e))
            let respObj = {}
            respObj.statusCode = 500
            respObj.body = e.message ?? 'Internal server error'
            return respObj
        }
    }
    else if(operation === 'getUserRoles'){
        // Get Admin User roles from table
        let userRoles = await getAdminUserRoles()

        return {
            statusCode: 200,
            body: JSON.stringify({status: 'SUCCESS', result: userRoles})
        };
    }
    const result = {
        statusCode: 200,
        body: JSON.stringify({status: 'SUCCESS',})
    };
    return result;
}


async function checkFolderExists(bucketName, folderName) {
    try {
        //* Check if the folder exists by trying to retrieve its metadata
        const params = {
        Bucket: bucketName,
        Key: folderName
        };

        await s3.headObject(params).promise();

        //* If headObject does not throw an error, the folder exists
        return true;
    } catch (error) {
        //* If headObject throws a "NotFound" error, the folder does not exist
        if (error.code === 'NotFound') {
        return false;
        }

        //* Handle other errors
        console.error('Error:', error);
        throw error;
    }
}

function generateRandomPassword(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
    const password = [];
    for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, characters.length);
        password.push(characters.charAt(randomIndex));
    }
    return password.join('');
}

async function getFilesHistory(limit){
    let [hist] = await db.getFileHistory(limit);
    return hist;
}

async function getFilesHistoryStatistics(days){
    let [stats] = await db.getFileHistoryStatistics(days);
    return stats;
}

async function getEnrollmentStatistics(days){
    let [stats] = await db.getEnrollmentStatistics(days);
    return stats;
}

async function getEmployersList(){
    let [hist] = await db.getEmployersList();
    return hist;
}

async function getEmployerById(employerId){
    let [emp] = await db.getEmployer(employerId);
    return emp;
}

async function getEmployerFileHistory(employerId, limit){
    let [hist] = await db.getEmployerFileHistory(employerId, limit);
    return hist;
}

async function getEmployerFileHistoryLog(employerId, histId){
    let [log] = await db.getEmployerFileHistoryLog(employerId, histId);
    return log;
}

async function createReseller(data, userid){
    let result = await db.createReseller(data, userid);
    return result;

}
async function updateResellers(resellerId, data, userid) {
    let result = await db.updateResellers(resellerId, data, userid);
    return result;
}
async function createNewEmployer(resellerEid, reqBody, userid){
    let empResult = await db.createNewEmployer(resellerEid, reqBody, userid);
    return empResult;
}
async function updateEmployer(resellerEid, employerEid, reqBody, userid){
    let updateEmpResult = await db.updateEmployer(resellerEid, employerEid, reqBody, userid);
    return updateEmpResult;
}

async function getEmployerChangeHistory(externalId){
    let [empChangeHistory] = await db.getEmployerChangeHistory(externalId);
    return empChangeHistory;
}
async function getResellerHistoryById(id){
    let [log] = await db.getResellerHistoryById(id);
    return log;
    /*await convertToJson(log,['eligibility_rules','configurations']);*/
}
async function getResellerList(){
    let [log] = await db.getResellerList();
    return log;
    //console.log(' resller detailssss', log)
    //return await convertToJson(log,['eligibility_rules','configurations']);
}
async function getResellerByExternalId(id){
    let [log] = await db.getResellerByExternalID(id);
    //console.log(' resller detailssss', log)
    //return await convertToJson(log,['eligibility_rules','configurations']);
    return log;
}
async function getEnrollmentSetupById(id){
    let [log] = await db.getEnrollmentSetupById(id);
    return log;
}
async function updateEnrollmentSetupById(data,id){
    let log = await db.updateEnrollmentSetupById(data,id);
    return log;
}
async function exportEmployerResellerData(params){
    let log = await db.exportEmployerResellerData(params);
    return log;
}
async function getReseller(params){
    let [log] = await db.getReseller(params);
    return log;
}
async function importEmployerFunction(reqBody, userEmail){
    let uploadResult = [];
    if(reqBody.length > 0){
        for (const data of reqBody) {
            if (!data?.reseller) throw new Error(`ERROR: Reseller data does not exist`);
            if (!data?.employer) throw new Error(`ERROR: Employer data does not exist`);
            if (data?.reseller?.id) delete data.reseller.id;
            if (data?.employer?.id) delete data.employer.id;
            let resellerDetails = data.reseller;
            let empResult = "";
            let validation = await validateReseller(data.reseller);
            console.log(" -- validation ..", validation)
            if(validation){
                if(!(!!data?.reseller?.eid)){
                    console.log(" -- inside validation ..", validation)
                    let resellerCreateRes = await createReseller(data.reseller, userEmail);
                    [resellerDetails] = await getReseller(resellerCreateRes.insertId);
                }
            }else{
                console.log("validation failed..", validation)
                return {
                    statusCode: 400,
                    body: 'Resller data validation failed, please check the file data (unique name, phone, email) again'
                };
            }
            if(!!data?.employer?.external_id ){
                console.log(" -- calling employer validation for updation ")
                let empValidation = await validateEmployer(data.employer);
                console.log(" -- empValidation  ", empValidation)
                if(empValidation){
                    console.log("--- inside validation employer update if  ", empValidation)
                    empResult =  await updateEmployer(resellerDetails?.eid, data?.employer?.external_id, data.employer, userEmail);
                }else{
                    console.log("Employer validation failed...", empValidation)
                    return {
                        statusCode: 400,
                        body: 'Employer data validation failed, please check the file data (unique name, phone, email) again'
                    };
                }
            } else {
                let empValidation = await validateEmployer(data.employer);
                console.log(" -- empValidation  ", empValidation)
                if(empValidation){
                    console.log("--- inside validation employer create else  ", empValidation)
                    empResult = await createNewEmployer(resellerDetails?.eid, data.employer, userEmail);
                }else{
                    return {
                        statusCode: 400,
                        body: 'Employer data validation failed, please check the file data (unique name, phone, email) again'
                    };
                }
            }
            
            console.log("  -- empResult global  ", empResult)
            if (!empResult || empResult.length === 0) {
                console.log("  -- empResult if ", empResult)
                
                return {
                    statusCode: 400,
                    body: 'Something went wrong'
                };
            } else {
                console.log("  -- empResult else ", empResult)

                uploadResult.push(empResult.insertId);
            }
        }

    }
    console.log(" -- uploadResult  ", uploadResult)
    return {
        statusCode: 200,
        body: `Successfully uploaded file data for ${uploadResult} entries`
    };
}

// Function to get Admin users
async function getAdminUsersList(){
    let [users] = await db.getAdminUsersList()
    return users;
}

// Function to get Admin user by ID
async function getAdminUserByID(id){
    let [user] = await db.getAdminUserByID(id)
    return user;
}

// Function to create Admin user
async function createAdminUser(data){
    let res = await db.createAdminUser(data)
    return res;
}

// Function to update Admin user
async function updateAdminUser(data, userId){
    let res = await db.updateAdminUser(data, userId)
    return res;
}

// Function to update Admin user Login
async function updateAdminUserLogin(data, userId){
    let res = await db.updateAdminUserLogin(data, userId)
    return res;
}

// Function to get Admin user details by email id
async function getAdminUserByEmail(email){
    let res = await db.getAdminUserByEmail(email)
    return res;
}

// Function to get Admin users roles
async function getAdminUserRoles(){
    let [roles] = await db.getAdminUserRoles()
    return roles;
}

async function convertToJson(data, key){
    if(data.length >0 ){
        data.forEach(obj=>{
            for(let i=0; i< key.length; i++) {
                if(!!obj[key[i]] && obj[key[i]] !== "" && !!obj[key[i]].includes("{")) {
                    obj[key[i]] = JSON.parse(obj[key[i]]);
                }
            }
        });
    }
    return data;
}

function getFormattedDate(date){
    let a = new Date(date);
    let d = a.getDate();
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    let m = monthNames[a.getMonth()];
    let y = a.getFullYear();
    return `${d}-${m}-${y}`;
}

async function validateReseller(data){
    let nameValidation, phoneValidation, emailValidation;
    console.log("-- validating reseller --")
    nameValidation = await validateResellerName(data.name)
    phoneValidation = await validatePhone(data.support_phone)
    emailValidation = await validateEmail(data.support_email)
    console.log(" -- nameValidation  ", nameValidation)
    console.log(" -- phoneValidation  ", phoneValidation)
    console.log(" -- emailValidation  ", emailValidation)
    console.log("nameValidation && phoneValidation && emailValidation  ", (nameValidation && phoneValidation && emailValidation))
    if(nameValidation && phoneValidation && emailValidation){
        return true;
    }
    return false;
}

async function validateResellerName(name){
    let resellers = await getResellerList()
    const nameExists = resellers.some( e => e.name === name )
    if(nameExists){
        return false
    }
    return true;
}

async function validatePhone(phone){
    const isValid = isValidPhoneNumber(phone);
    if(isValid) return true
    return false;
}

async function validateEmail(email){
    const emailRege = /^[a-zA-Z0-9._%+-]{1,64}(@[a-zA-Z0-9.-]{1,200})+\.[a-z]{2,55}$/g;
    const emailValid = emailRege.test(email);
    if(emailValid) return true
    return false
}

async function validateEmployer(data){
    let nameValidation, phoneValidation, emailValidation;
    console.log("-- validating employer --")
    nameValidation = await validateEmployerName(data)
    phoneValidation = await validatePhone(data.support_phone)
    emailValidation = await validateEmail(data.support_email)
    console.log(" -- nameValidation  ", nameValidation)
    console.log(" -- phoneValidation  ", phoneValidation)
    console.log(" -- emailValidation  ", emailValidation)
    console.log("nameValidation && phoneValidation && emailValidation  ", (nameValidation && phoneValidation && emailValidation))
    if(nameValidation && phoneValidation && emailValidation){
        return true;
    }
    return false;
}


async function validateEmployerName(data){
    let nameExists;
    if(data.externalId){
        let employer = getEmployerById(data.external_id)
        console.log(" -- employer  ", employer)
        if(employer.name === data.name){
            nameExists = false   
            console.log("data not changed ..")
        }else{
            let employers = await getEmployersList()
            nameExists = employers.some( e => e.name === data.name )
            console.log("-- data changed nameExists  ", nameExists)
        }
    }else{
        let employers = await getEmployersList()
        nameExists = employers.some( e => e.name === data.name )   
    }
    if(nameExists){
        return false
    }
    return true;
}

function validateFileType (fileType,fileName){
    if (!fileType) {
        const extension = fileName.substring(fileName.lastIndexOf('.') + 1,fileName.length)
        switch (extension) {
            case 'pgp':
                return true
            default:
                return false
        }
      }
      const acceptedFileTypes = [
        'text/plain'
      ];
      const isFileAccepted = acceptedFileTypes.includes(fileType.toLowerCase());
      if (!isFileAccepted) {
        return false;
      }
      return true;
}