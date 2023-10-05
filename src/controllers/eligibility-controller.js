const db = require('../services/rds-data-service');
const braze = require('../services/braze-service');
const sforce = require('../services/salesforce-service');
const shop = require('../services/shop-service');
const constants = require('../common/constants');
const utils = require('../common/utils');
const firewall = require('../handlers/api-gw-firewall-handler');
const darioUser = require('../handlers/dario-user-handler');
const engage = require('../services/engage-service.js');
const queue = require('../services/sqs-service');
const states = require('../services/step-function-service');
const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`
const got = require("got");
const _ = require('lodash');

const unifiedUserSecretName = `${process.env.STAGE}-unified-flag`
const TEST_EMAIL_REGEX = '^testqa';

const createNewEligibilityInDB = async (eligRec, employer, fileHistoryID, originalRecord) => {
    if(!!!eligRec.email){
        const { unifiedFlag } = await secrets.getSecret(unifiedUserSecretName);
        eligRec.email = utils.generateFakeEmail(employer.name, unifiedFlag);
        eligRec.generated_email = 1;
    }
    let [[dbres], histres] = await db.addEligibilityTrx(
        eligRec,
        employer.id,
        fileHistoryID,
        constants.EligibilityStatus.ELIGIBLE,
        constants.EligibilityStage.NEW,
        JSON.stringify(originalRecord)
    );

    await db.addEligibilityLog(dbres.insertId, constants.EligibilityLogAction.UPDATE, 'new eligibility added');
    return dbres;
};

const createNewEligibilityInReferrals = async (eligRec, employer, fileHistoryID, eligibilityId) => {
    let addressData = {
        address_1: eligRec.address_1,
        address_2: eligRec.address_2,
        city: eligRec.city,
        state: eligRec.state,
        zipcode: eligRec.zipcode,
        country: eligRec.country
    }

    const sfEmployerName = await getEmployerNameForSalesForce(employer, eligRec);
    const isTestRecord = (eligRec.test_record) ? true : false;
    let sfRec = await sforce.createOrUpdateEligibility(undefined, eligRec.eid,
        eligRec.email, eligRec.first_name, eligRec.last_name, eligRec.dob, employer.sf_eligbility_account_ID, eligRec.phone, eligRec.home_phone,
        sfEmployerName, employer.external_id, constants.EligibilityStatus.ELIGIBLE, constants.EligibilityStage.NEW, eligRec.targeting, addressData, eligRec.gender, isTestRecord);
    console.log('SalesForce result', sfRec);
    // eligRec.sf_id = sfRec.id

    await db.updateEligibilitySalesForceIDTrx(sfRec.id, fileHistoryID, eligibilityId);

    //firewall
    await firewall.callHandleProvisioning(eligRec.email, null, employer.name);
    const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
    let [employer_attribute] = await db.getEmployerAttribute(employer.id, "virtual_account", eligRec.external_employer_id);

    await Promise.all([
        braze.sendUserEvent(  brazeUnifiedFlag ?  eligRec.eid : eligRec.email, constants.Braze.NEW, {}, {
            email: eligRec.email,
            first_name: eligRec.first_name,
            last_name: eligRec.last_name,
            phone: eligRec.phone,
            gender: eligRec.gender,
            dob: eligRec.dob,
            address: eligRec.address_1,
            city: eligRec.city,
            address_zipcode: eligRec.zipcode,
            address_state: eligRec.state,
            country: eligRec.country,
            is_b2b: true,
            b2b_eid: eligRec.eid,
            b2b_role: eligRec.role,
            b2b_fake_email: eligRec.generated_email,
            b2b_reseller: employer.reseller_name,
            b2b_employer: employer.name,
            b2b_employer_id: employer.external_id,
            b2b_targeting: eligRec.targeting,
            b2b_eligibility_status: constants.EligibilityStatus.ELIGIBLE,
            b2b_eligibility_stage: constants.EligibilityStage.NEW,
            b2b_sub_account : (employer_attribute[0] && employer_attribute[0].value) ? employer_attribute[0].value : null
        }, employer.id),
        //flows log
        db.addEligibilityFlowLogTrx(eligibilityId, 1000, `new eligibility from file history ${fileHistoryID}`),
        db.addEligibilityFlowLogTrx(eligibilityId, 1020, `new eligibility in Salesforce account ${sfRec.id}`),
        db.addEligibilityFlowLogTrx(eligibilityId, 1030, `new eligibility in Braze`),
        db.addEligibilityFlowLogTrx(eligibilityId, 1200, `new eligibility pending for 1st mail`),
        db.addEligibilityFlowLogTrx(eligibilityId, 1250, `new eligibility pending for 1st call`)
    ]);
};

module.exports = {
    createNewEligibilityInDB,
    createNewEligibilityInReferrals,
    createNewEligibilityAsync: async (eligRec, employer, fileHistoryID, originalRecord) => {
        try {
            console.log(`adding new eligibility [ASYNC] ${eligRec.eid}`);
            const dbres = await createNewEligibilityInDB(eligRec, employer, fileHistoryID, originalRecord);
            // await createNewEligibilityInReferrals(eligRec, employer, fileHistoryID, dbres.insertId);
            await queue.sendMessage({
                eligRec,
                employer,
                fileHistoryID,
                enigibilityId: dbres.insertId
            }, constants.EligibilityWorkerAction.CREATE_ELIBIGILITY_IN_REFERRALS, process.env.SQS_EXTERNAL_QUEUE_URL)
            return dbres;
        }
        catch (error) {
            console.error('ERROR in createNewEligibility [ASYNC]', error);
            await db.reportToFileLog('error', 'add-eligibility', error, JSON.stringify(eligRec), fileHistoryID);
        }
    },
    createNewEligibility: async (eligRec, employer, fileHistoryID, originalRecord) => {
        try {
            console.log(`adding new eligibility ${eligRec.eid}`);
            const dbres = await createNewEligibilityInDB(eligRec, employer, fileHistoryID, originalRecord);
            await createNewEligibilityInReferrals(eligRec, employer, fileHistoryID, dbres.insertId);
            return dbres;
        }
        catch (error) {
            console.error('ERROR in createNewEligibility', error);
            await db.reportToFileLog('error', 'add-eligibility', error, JSON.stringify(eligRec), fileHistoryID);
        }
    },
    updateAndEnableEligibility: async (newEligRec, currElig, employer, fileHistoryID, originalRecord, queueAwait) => {
        try {
            console.log(`updating eligibility ${newEligRec.reseller_employee_id}-${newEligRec.role}`);
            // status and stage both from historyEligRecord if historyEligRecord length more than 0
            let newStatus = currElig.status === constants.EligibilityStatus.INELIGIBLE ? constants.EligibilityStatus.ELIGIBLE : currElig.status;
            let newStage = currElig.status === constants.EligibilityStatus.INELIGIBLE ? constants.EligibilityStage.NEW : currElig.stage;
            
            if (typeof employer.eligibility_rules.behaviors == "object"
                && !Array.isArray(employer.eligibility_rules.behaviors)
                && currElig.record_source
                && employer.eligibility_rules.behaviors[currElig.record_source]) {

                console.log("behaviors", employer.eligibility_rules.behaviors[currElig.record_source]);
                employer.eligibility_rules.behaviors = employer.eligibility_rules.behaviors[currElig.record_source];
            }

            if (currElig.status === constants.EligibilityStatus.INELIGIBLE && 
                currElig.stage === constants.EligibilityStage.INELIGIBLE && 
                utils.shouldUseBehaviour(employer.eligibility_rules, constants.Behaviors.REENROLLMENT)) {
                console.log(`updateAndEnableEligibility shouldUseBehaviour currElig.status - ${currElig.status}, `);
                console.log(`currElig.stage - ${currElig.stage}, `);
                console.log(`eligibility_rules : ${employer.eligibility_rules} `);
                console.log(`<--> Behaviors.REENROLLMENT : ${constants.Behaviors.REENROLLMENT} `);
                const historyEligRecord = await checkandreenroll({newEligRec, currElig, employer, originalRecord})
                console.log(`updateAndEnableEligibility historyEligRecord -- ${JSON.stringify(historyEligRecord)}`)
                if(historyEligRecord.length>0){
                    console.log(`updateAndEnableEligibility inside historyEligRecord condition `)
                    await createReEnrolledPendingOrder({newEligRec, currElig, employer})
                    newStatus = historyEligRecord[0].status
                    newStage = historyEligRecord[0].stage
                    // await removeAndPushRedeemedProductsToHistory(currElig.id) // remove and push redeemed product to
                }
            }
            console.log(`updateAndEnableEligibility {newStatus, newStage} -- ${JSON.stringify({newStatus, newStage})}`)
            let newElig = { ...currElig, ...newEligRec, employer_id: employer.id, status: newStatus, stage: newStage };
            console.log(`updateAndEnableEligibility {newElig} -- ${JSON.stringify({newElig})}`)

            await Promise.all([
                db.updateEligibilityTrx(newElig, employer.id, fileHistoryID, currElig.id, JSON.stringify(originalRecord), currElig),
                db.addEligibilityLog(currElig.id, constants.EligibilityLogAction.UPDATE, `update eligibility parameters and status - ${newStatus}, stage - ${newStage}`),
            ]);

            //firewall
            if(currElig.email !== newElig.email){
                console.log(`email changed from ${currElig.email} to ${newElig.email}, updating firewall.`)
                await firewall.callHandleProvisioning(currElig.email, newElig.email, employer.name);
            }
            //engage assignment to coach
            await handlePCPAssignment(employer, currElig, newElig);
            //flows log
            await db.addEligibilityFlowLogTrx(currElig.id, 1010, `update eligibility from file history ${fileHistoryID}`);

            let employer_id = newEligRec.employer_id
            if(queueAwait){
               await  queue.sendMessage({employer_id, newEligRec, currElig, employer, newStatus, newStage}, constants.EligibilityWorkerAction.UPDATE_EXTERNAL_SERVICES, process.env.SQS_EXTERNAL_QUEUE_URL)
               return;

            }
            queue.sendMessage({employer_id, newEligRec, currElig, employer, newStatus, newStage}, constants.EligibilityWorkerAction.UPDATE_EXTERNAL_SERVICES, process.env.SQS_EXTERNAL_QUEUE_URL)

        }
        catch (error) {
            console.error('ERROR in updateAndEnableEligibility', error);
            await db.reportToFileLog('error', 'update-eligibility', error, JSON.stringify(eligRec), fileHistoryID);
        }
    },
    disableEligibility: async (disabledElig, fileHistoryID) => {
        try {
            console.log(`removing eligibility ${disabledElig.eid}`);
            console.log('disabledElig',disabledElig);
            let [redeemed, flds] = await db.getRedeemedProductsList(disabledElig.id);
            console.log(`redeemed product of ${disabledElig.eid}`)
            //add redeemed products history
            redeemed.forEach(cancelledRedeemedProduct => {
              //don't await to add history
              db.addRedeemedProductHistory(cancelledRedeemedProduct)
                .catch(error => console.log('addRedeemedProductHistory error for product:', { error, cancelledRedeemedProduct }))
            })
            //------------------------------
            let ordersToCancel = redeemed.map(rd => rd.order_id);
            let subsToCancel = Array.from(new Set(redeemed.map(rd => rd.subscription_id)));
            const disenrolledDate = new Date()
            try {
            await Promise.all([
                db.updateEligibilityStatusTrx(constants.EligibilityStatus.INELIGIBLE, constants.EligibilityStage.INELIGIBLE, fileHistoryID, disabledElig.id, disenrolledDate),
                db.addEligibilityLog(disabledElig.id, constants.EligibilityLogAction.UPDATE, ordersToCancel.length > 0 ? 'eligibility_terminated' : 'revoke eligibility'),
                db.addEligibilityFlowLogTrx(disabledElig.id, 9500, `de-listed from eligibility file`),
                db.updateRedeemedProductsStatus(constants.RedeemedProductStatus.DISENROLLED, disabledElig.id),
                shop.cancelOrders(ordersToCancel),
                shop.cancelSubscription(subsToCancel),
                darioUser.DisableDarioUserMembership(disabledElig)
            ]);
            } catch (error) {
                console.log(`catch block disableEligibility promise all ${error}`)
            }

            //flows log
            await db.addEligibilityFlowLogTrx(disabledElig.id, 9900, `revoke eligibility from file history ${fileHistoryID}`);
            console.log('[disableEligibility] before sending message to queue')
            let employer_id = disabledElig.employer_id
            await queue.sendMessage({employer_id, disabledElig, ordersToCancel, subsToCancel}, constants.EligibilityWorkerAction.REMOVE_EXTERNAL_SERVICES, process.env.SQS_EXTERNAL_QUEUE_URL)
        }
        catch (error) {
            console.error('ERROR in disableEligibility', error.stack);
            await db.reportToFileLog('error', 'remove-eligibility', error, JSON.stringify(disabledElig), fileHistoryID);
        }
    },
    graceEligibility: async (disabledElig, fileHistoryID, employer_id) => {
        try {

            let [employers_list] = await db.getEmployerByID(employer_id)
            let employer = employers_list[0]

            let eligibility_rules = employer.eligibility_rules ? JSON.parse(employer.eligibility_rules) : {};
            const grace  = eligibility_rules.grace ? eligibility_rules.grace : 30

            const date = new Date();
            date.setDate(date.getDate() + grace);
            const grace_period_date = date.toISOString().split('T')[0];

            const eligStage = constants.EligibilityStage.GRACE_STARTED

            await Promise.all([
                db.updateEligibilityStageTrx(eligStage, fileHistoryID, disabledElig.id),
                db.updateEligibilityGracePeriodTrx(grace_period_date, fileHistoryID, disabledElig.id)
            ]);
            // flows log
            await db.addEligibilityFlowLogTrx(disabledElig.id, 9700, `adding eligibility a grace period ${fileHistoryID}`);
        }
        catch (error) {
            console.error('ERROR in graceEligibility', error);
            await db.reportToFileLog('error', 'remove-eligibility', error, JSON.stringify(eligRec), fileHistoryID);
        }
    },
    unGraceEligibility: async (disabledElig, fileHistoryID, employer_id) => {
        try {
            const eligStage = constants.EligibilityStage.GRACE_REMOVED

            await Promise.all([
                db.updateEligibilityStageTrx(eligStage, fileHistoryID, disabledElig.id),
                db.updateEligibilityGracePeriodTrx(null, fileHistoryID, disabledElig.id)
            ]);
            // flows log
            await db.addEligibilityFlowLogTrx(disabledElig.id, 9700, `remove eligibility a grace period ${fileHistoryID}`);
        }
        catch (error) {
            console.error('ERROR in graceEligibility', error);
            await db.reportToFileLog('error', 'remove-eligibility', error, JSON.stringify(eligRec), fileHistoryID);
        }
    },
    disabledEligExternalServices: async (disabledElig, ordersToCancel, subsToCancel) => {
        try {
            console.log(`[disabledEligExternalServices] -> invoked by queue`, disabledElig, ordersToCancel, subsToCancel);

            const { unifiedFlag } = await secrets.getSecret(sforce.unifiedUserSecretName);

            let differentshopEmail = disabledElig.shop_email && disabledElig.shop_email !== disabledElig.email;

            const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);

            const allPromises = [
                sforce.updateEligibilityStatus(unifiedFlag ? disabledElig.eid : disabledElig.email, constants.EligibilityStatus.INELIGIBLE, constants.EligibilityStage.INELIGIBLE),
                sforce.cancelOrders(ordersToCancel),
                sforce.cancelSFSubscriptions(subsToCancel)
            ]
            console.log('[disabledEligExternalServices] -> brazeUnifiedFlag, differentshopEmail, disabledElig.email, disabledElig.shop_email',brazeUnifiedFlag, differentshopEmail, disabledElig.email, disabledElig.shop_email);

            if(!brazeUnifiedFlag){
                // case: different emails & shop emal non-null
                if(differentshopEmail && disabledElig.shop_email){
                    allPromises.push(braze.sendUserEvent( disabledElig.email, constants.Braze.REVOKED, {b2b_eligibility_status: constants.EligibilityStatus.INELIGIBLE}))
                    allPromises.push(braze.sendUserEvent( disabledElig.shop_email, constants.Braze.REVOKED, {b2b_eligibility_status: constants.EligibilityStatus.INELIGIBLE}))
                }

                // case: same emails OR shop email is NULL
                if(!differentshopEmail || !disabledElig.shop_email){
                    allPromises.push(braze.sendUserEvent( disabledElig.email, constants.Braze.REVOKED, {b2b_eligibility_status: constants.EligibilityStatus.INELIGIBLE}))
                }
            }
            else{
                allPromises.push(braze.sendUserEvent(disabledElig.eid, constants.Braze.REVOKED, {}, {
                    b2b_eligibility_status: constants.EligibilityStatus.INELIGIBLE
                }))
            }

            const response = await Promise.all(allPromises)
            console.log('[disabledEligExternalServices] -> response',response)
        } catch(err){
            console.error('disabledEligExternalServices', err);
        }

    },
    updateAndEnableEligExternalServices: async (newEligRec, currElig, employer, newStatus, newStage) => {
        try {
            console.log(`[updateAndEnableEligExternalServices] -> invoked by queue`, newEligRec, currElig, employer);

            let sfEmployerName = await getEmployerNameForSalesForce(employer, newEligRec);
            let brazeEvent = currElig.status === constants.EligibilityStatus.INELIGIBLE ? constants.Braze.ENABLED : constants.Braze.UPDATE;

            let addressData = {
                address_1: newEligRec.address_1,
                address_2: newEligRec.address_2,
                city: newEligRec.city,
                state: newEligRec.state,
                zipcode: newEligRec.zipcode,
                country: newEligRec.country
            }

        const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
        let [employer_attribute] = await db.getEmployerAttribute(currElig.employer_id, "virtual_account", newEligRec.external_employer_id);
        const isTestRecord = recogniseTestUser(newEligRec);
           let [sforceRes, brazeRes] = await Promise.all([
                sforce.createOrUpdateEligibility(currElig.sf_id, newEligRec.eid,
                    newEligRec.email, newEligRec.first_name, newEligRec.last_name, newEligRec.dob, employer.sf_eligbility_account_ID, newEligRec.phone, newEligRec.home_phone,
                    sfEmployerName, employer.external_id, newStatus, newStage, currElig.targeting, addressData, newEligRec.gender, isTestRecord),
                braze.sendUserEvent( brazeUnifiedFlag ?  currElig.eid: newEligRec.email, brazeEvent, {}, {
                    email: newEligRec.email,
                    first_name: newEligRec.first_name,
                    last_name: newEligRec.last_name,
                    phone: newEligRec.phone,
                    gender: newEligRec.gender,
                    dob: newEligRec.dob,
                    address: newEligRec.address_1,
                    city: newEligRec.city,
                    address_zipcode: newEligRec.zipcode,
                    address_state: newEligRec.state,
                    country: newEligRec.country,
                    is_b2b: true,
                    b2b_eid: currElig.eid,
                    b2b_role: newEligRec.role,
                    b2b_fake_email: newEligRec.generated_email,
                    b2b_reseller: employer.reseller_name,
                    b2b_employer: employer.name,
                    b2b_employer_id: employer.external_id,
                    b2b_targeting: currElig.targeting,
                    b2b_eligibility_status: newStatus,
                    b2b_sub_account : (employer_attribute[0] && employer_attribute[0].value) ? employer_attribute[0].value : null
                }, employer.id)
            ])
            console.log(`[updateAndEnableEligExternalServices] -> events were sent sforceRes: ${JSON.stringify(sforceRes)}, brazeRes: ${JSON.stringify(brazeRes)}`)
            // flow logs
            await db.addEligibilityFlowLogTrx(currElig.id, 1021, `update eligibility in Salesforce account ${currElig.sf_id}`);
            await db.addEligibilityFlowLogTrx(currElig.id, 1031, `update eligibility in Braze`);
        } catch(err) {
            console.error('updateAndEnableEligExternalServices', err, newEligRec.sf_id);
        }
    },
    getEmployerNameForSalesForce,
    createSalesForceAccount: async (employer, eligRec) => {
        console.log('createSalesForceAccount', JSON.stringify(employer), JSON.stringify(eligRec))
        const sfEmployerName = await getEmployerNameForSalesForce(employer, eligRec);

        const addressData = {
            address_1: eligRec.address_1,
            address_2: eligRec.address_2,
            city: eligRec.city,
            state: eligRec.state,
            zipcode: eligRec.zipcode,
            country: eligRec.country
        }
        
        const isTestRecord = (eligRec.test_record) ? true : false;
        const sfRec =
            await sforce.createOrUpdateEligibility(undefined, eligRec.eid,
            eligRec.email, eligRec.first_name, eligRec.last_name, eligRec.dob, employer.sf_eligbility_account_ID, eligRec.phone, eligRec.home_phone,
            sfEmployerName, employer.external_id, constants.EligibilityStatus.ELIGIBLE, constants.EligibilityStage.NEW, eligRec.targeting, addressData, eligRec.gender, isTestRecord);

            console.log('SF result', sfRec);
            return sfRec.id
    },
    createReEnrolledPendingOrder

}

async function checkandreenroll(data) {
    console.log(`checkandreenroll START`);
    let isReenrolled = [];
    const { currElig, employer } = data;
    const employer_id = employer.id;
    const currentDate = new Date();
    const autoPeriod = employer?.eligibility_rules?.behaviorsParams?.reenrollment?.autoPeriod || 0;
    try {
        let records = await db.getEligibilityHistory(currElig, employer_id , 1)
        if(records && records.length>0 && records[0].length>0){
            console.log(`records in checkandreenroll ${JSON.stringify(records[0])}`)
            const disenrolledDate = new Date(records[0][0].created_at);
            const diffDays = getDiffDays(currentDate, disenrolledDate);
            console.log(`diffDays in checkandreenroll ${diffDays}`)
            isReenrolled = diffDays <= autoPeriod ? records[0] : [];
            console.log(`isReenrolled in checkandreenroll ${isReenrolled}`)
        }
    } catch (error) {
        console.log(`error in checkandreenroll ${error}`)
    }
    return isReenrolled;
}

async function createReEnrolledPendingOrder(data){
    console.log(`createReEnrolledPendingOrder Start`)
    // Deep copy using Lodash
    const deepCopy = _.cloneDeep(data);
    const { employer, productJson, isNewEnrollment = false } = deepCopy;
    console.log(`createReEnrolledPendingOrder deepCopynewEligRec, deepCopycurrElig, employer ---- ${JSON.stringify({deepCopynewEligRec : deepCopy.newEligRec, deepCopycurrElig:deepCopy.currElig, employer})}`)
    deepCopy.currElig.employer_id = employer.external_id; // passing external id from employer as we are getting id instead of external id
    try {
    // let opts = {
    //     method: 'GET',
    //     url: `${process.env.MYDARIO_SHOP_URL}/wp-json/wc/v3/drGetEmployer?emp_id=${employer.name}`,
    //     headers: {
    //         'Content-Type': 'application/json'
    //     }
    // };
    // let empData = await got(opts).json();
    // console.log(`createReEnrolledPendingOrder empData ---- ${JSON.stringify({empData})}`);
    const empData = await shop.getEmployerWithEName(employer.external_id);
    console.log(`createReEnrolledPendingOrder empShopData ---- ${JSON.stringify({empData})}`)
    if(!isNewEnrollment){
        empData.eligibility_reenrollment_wm_gsm_sku = constants.MembershipOnlySKUs.eligibility_mo_wm_gsm_sku
        empData.eligibility_reenrollment_msk_pst_sku = constants.MembershipOnlySKUs.eligibility_mo_msk_pst_sku
        empData.eligibility_reenrollment_pst_sku = constants.MembershipOnlySKUs.eligibility_mo_pst_sku
        empData.eligibility_reenrollment_msk_cva_sku = constants.MembershipOnlySKUs.eligibility_mo_msk_cva_sku
        empData.eligibility_reenrollment_bp_gsm_sku = constants.MembershipOnlySKUs.eligibility_mo_bp_gsm_sku
        empData.eligibility_reenrollment_ig_sku = constants.MembershipOnlySKUs.eligibility_mo_ig_sku
        empData.eligibility_reenrollment_iphone_sku = constants.MembershipOnlySKUs.eligibility_mo_ig_sku
        empData.eligibility_reenrollment_usbc_sku = constants.MembershipOnlySKUs.eligibility_mo_ig_sku
    
        deepCopy.newEligRec.dob = deepCopy.currElig.dob; // to map record with shop
        deepCopy.newEligRec.phone = deepCopy.currElig.shop_phone;// to map phone with shop phone 
        deepCopy.newEligRec.email = deepCopy.currElig.shop_email;// to map email with shop email 
    }

    let redeemedProducts = await db.getRedeemedProductsList(deepCopy.currElig.id);
    console.log(`createReEnrolledPendingOrder redeemedProducts[0] ---- ${JSON.stringify(redeemedProducts[0])}`)

    let redeemedProductsList = [...new Set(redeemedProducts[0].map(item => item.product_type))];
    const convertArrayToObject = (array, key) => {
        return array.reduce((obj, item) => {
            obj[item] = true;
            return obj;
          }, {});
      };
    const selectedProduct = isNewEnrollment? productJson : convertArrayToObject(redeemedProductsList,'product_type'); // get product_type and map record as per shop request
    const prodsWithConnectors = generateConnectors(empData.products, selectedProduct)

    const reqBody = {
        employer_id : deepCopy.currElig.employer_id,
        Payload : Buffer.from(JSON.stringify({
            api_data: deepCopy.currElig,
            user_data: deepCopy.newEligRec,
            emp_set: empData,
            products_json: prodsWithConnectors,
        })).toString('base64')
    }
    console.log(`createReEnrolledPendingOrder reqBody---- ${JSON.stringify({reqBody})}`)
    let createPendingOrderSMResult = await states.executeCreatePendingOrderStateMachine(reqBody);
    console.log('createReEnrolledPendingOrder --> create pending order state machine executoion', createPendingOrderSMResult);
    return true
    } catch (errorShop) {
        console.log(`createReEnrolledPendingOrder errorShop ---- ${new Error(errorShop).stack}`)
    }
}

function generateConnectors(empProducts, selectedProductsMap) {
    const generateObj = {}
  
    Object.keys(selectedProductsMap).forEach((prod) => {
      if (selectedProductsMap[prod]) {
        if (Object.keys(empProducts[prod.toLowerCase()]).length > 1) {
            const res = Object.keys(empProducts[prod.toLowerCase()]).find((key) => empProducts[prod.toLowerCase()][key])
            generateObj[prod] = res
        } else {
          generateObj[prod] = Object.keys(empProducts[prod.toLowerCase()])[0]
        }
      }
    })
    return generateObj
  }

function getDiffDays(date1, date2) {
    const msInOneDay = 1000 * 60 * 60 * 24
    const diffMs = date1 - date2
    return diffMs / msInOneDay
}

async function removeAndPushRedeemedProductsToHistory(id){
    try {
        // const [reenrolledRedeemedProducts] = await db.getRedeemedProductsList(id)
        // reenrolledRedeemedProducts.forEach(reenrolledRedeemedProduct => {
        //     //don't await to add history
        //     db.addRedeemedProductHistory(reenrolledRedeemedProduct)
        //     .catch(error => console.log('removeAndPushRedeemedProductsToHistory error for product:', { error, reenrolledRedeemedProduct }))
        // })
        //delete all redeemed products
        const deleteResp = await db.deleteAllRedeemedProductTList(id)
        console.log(`[removeAndPushRedeemedProductsToHistory] deleteResp ${JSON.stringify({deleteResp})}`)
    } catch (error) {
      console.log(`Error in removeAndPushRedeemedProductsToHistory ${error}`);
    }
    return
  }

async function getEmployerNameForSalesForce(employer, eligibility) {
    let sfEmployerName = employer.name;
    let eligibility_rules = employer.eligibility_rules;

    console.log("Employer eligibility rules:-- ", eligibility_rules);
    console.log("type of employer eligibility rules:", typeof eligibility_rules);
    console.log("membership:- ", eligibility_rules.membership);

    eligibility_rules = (typeof eligibility_rules == "string") ? JSON.parse(eligibility_rules) : eligibility_rules;

    if (eligibility_rules.membership) {
        let membership = eligibility_rules.membership;
        console.log("employer.eligibility_rules.membership");
        if (membership.clinic_meta) {
            console.log("employer.eligibility_rules.membership.clinic_meta");
            if (membership.clinic_meta.sub_channel) {
                console.log("employer.eligibility_rules.membership.clinic_meta.sub_channel");
            }
            if (membership.clinic_meta.channel) {
                console.log("employer.eligibility_rules.membership.clinic_meta.channel");
            }
        }
    }

    if (eligibility_rules.membership && eligibility_rules.membership.clinic_meta && eligibility_rules.membership.clinic_meta.sub_channel && eligibility_rules.membership.clinic_meta.channel) {
        console.log("Clinic Mamebership + Meta/SubChannel Exists");
        let ChannelRef = eligibility_rules.membership.clinic_meta.channel;
        let subChannelRef = eligibility_rules.membership.clinic_meta.sub_channel;

        if(subChannelRef.startsWith('$')){
            // Virtual sub account
            let key = eligibility[subChannelRef.replace('$','')]
            let [attr] = await db.getEmployerAttribute(employer.id, 'virtual_account', key);
            if (attr && attr.length === 1) {
                sfEmployerName = `${sfEmployerName} - ${attr[0].value}`;
            }
        } else {
            // Regular sub account
            return `${ChannelRef} - ${subChannelRef}`;
        }
    }
    return sfEmployerName;
}


async function handlePCPAssignment(employer, currElig, newElig) {
    if (employer.eligibility_rules.provisioning && employer.eligibility_rules.provisioning.dario &&
        (currElig.stage === constants.EligibilityStage.ENROLLED || currElig.status === constants.EligibilityStatus.ENROLLED)) {

        if(!!newElig.pcp_id && currElig.pcp_id !== newElig.pcp_id){
            await assignToPCP(currElig.pcp_id, newElig.pcp_id, newElig.email, employer);
        }

        if(!!newElig.pcp_id_2 && currElig.pcp_id_2 !== newElig.pcp_id_2){
            await assignToPCP(currElig.pcp_id_2, newElig.pcp_id_2, newElig.email, employer);
        }
    }
}

async function assignToPCP(current_pcp_id, new_pcp_id, new_elig_email, employer) {
    console.log(`New assignment to primary care provider (PCP)  ${current_pcp_id} --> ${new_pcp_id}`);
    let [coachMapping] = await db.getEmployerAttribute(employer.id, 'pcp', new_pcp_id);
    let membershipRules = employer.eligibility_rules.membership

    if(membershipRules) {
        console.log('Membership Rules', membershipRules)
    }

    if (coachMapping && coachMapping.length === 1) {
        let engageRes = await engage.assignPatientToCoach(new_elig_email, coachMapping[0].value, membershipRules);
        console.log('Engage response', engageRes.body);
    }
    else {
        console.log(`WARNING: could not find coach mapping for PCPID ${new_pcp_id}`);
    }
}

function recogniseTestUser(userRecord) {
    const regexp = new RegExp(TEST_EMAIL_REGEX, 'gm');
    const isTestEmail = regexp.test(userRecord.email);
  
    const isTestRecord = !!userRecord.test_record;
  
    if (!isTestEmail && !isTestRecord) {
      return false;
    }
  
    if (isTestRecord && !isTestRecord) {
      return true;
    }  
    return true;
  }