const shop = require('../services/shop-service');
const emailSrv = require('../services/email-service');
const solera = require('../services/solera-service');
const db = require('../services/rds-data-service');
const crypto = require("crypto");
const constants = require("../common/constants");
const braze = require('../services/braze-service.js');
const eligibilityController = require('../controllers/eligibility-controller'
)
const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

let offset = 0;
exports.CreateEligibilityOrder = async (event, context) => {
    console.log('Eligibility Order StepFunction Event', event);

    try {
        let orderEvent = JSON.parse(Buffer.from(event.Payload, 'base64'));
        console.log('Order event: ', orderEvent);
        let result = await shop.createEligibilityOrder(orderEvent);
        let shopResult = result.body;

        if (shopResult.state !== 'verified') {
            console.error(`Error creating shop eigibility order, state is not verified`, shopResult);
            // await emailSrv.sendEmail(`Error Creating Eligibility Shop Order for employer ${event.employer_id} (${event.ExecutionName})`, safeStringify(shopResult));
            throw shopResult;
        }
        else {
            console.log('Order created successfully', shopResult);
            return { status: 'success', result: shopResult };
        }
    }
    catch (err) {
        let error = err.response ? err.response.body : err;

        if (error.code === 'rest_not_logged_in') {
            function OrderCreateRetryError(message) {
                this.name = 'OrderCreateRetryError';
                this.message = message;
            }
            OrderCreateRetryError.prototype = new Error();

            let msg = `Order API failed to log-in. restarting...`;
            const error = new OrderCreateRetryError(msg);
            console.log({ status: "error", description: msg, error: JSON.stringify(err.response) });
            throw error;
        }

        console.error(`Error creating shop eigibility order`, error);
        await emailSrv.sendEmail(`Error Creating Eligibility Shop Order for employer ${event.employer_id} (${process.env.STAGE}: ${event.ExecutionName})`, safeStringify(error));
        throw safeStringify(error);
    }
}
const updateEligibleEmptyFields = (eligibility, userData) => {
    let new_record = {};
    for (key in userData) {
        console.log('updateEligibleEmptyFields-check by key', userData[key], eligibility[key])
        //   if (!eligibility[key] && (constants.baseEligibilityFields.indexOf(key) >= 0)) {
        //     new_record[key] = userData[key];
        //   }
        // TODO: either change constants or discuss with Matan
        if (!eligibility[constants.baseEligibilityFields[key]] && constants.baseEligibilityFields[key]) {
            new_record[constants.baseEligibilityFields[key]] = userData[key];
        }
    }
    return new_record;
}

exports.CreatePendingEligibilityOrder = async (event, context) => {
    try {
        console.log('[CreatePendingEligibilityOrder]', event);
        if (!event.Payload) {
            return response({ status: 'error' }, new Error('[CreatePendingEligibilityOrder- Error] - Missing Payload data'));
        }

        let orderEvent = JSON.parse(Buffer.from(event.Payload, 'base64'));
        console.log('[CreatePendingEligibilityOrder] Payload:', orderEvent);
        console.log('[CreatePendingEligibilityOrder] typeof orderEvent: ', typeof orderEvent);

        let userData = (typeof orderEvent.user_data == 'string') ? JSON.parse(orderEvent.user_data) : orderEvent.user_data
        let apiData = (typeof orderEvent.api_data == 'string') ? JSON.parse(orderEvent.api_data)[0] : orderEvent.api_data
        orderEvent.emp_set = (typeof orderEvent.emp_set == 'string') ? JSON.parse(orderEvent.emp_set) : orderEvent.emp_set

        const [employer] = await db.getEmployer(apiData.employer_id);
        if (employer[0].length < 1) {
            return response({ status: 'error' }, new Error('[CreatePendingEligibilityOrder- Error] - Missing employer data'));
        }
        
        const [eligible] = await db.getEligibility(employer[0].id, apiData.eid);
        if (eligible[0].length < 1) {
            return response({ status: 'error' }, new Error('[CreatePendingEligibilityOrder- Error] - Missing eligible data'));
        }

        const recordForUpdate = updateEligibleEmptyFields(eligible[0], userData);
        if (Object.keys(recordForUpdate).length > 0) {

            const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
            let email = recordForUpdate.email || eligible[0].email
            console.log('Update Braze if missing details', email, recordForUpdate.email, eligible[0].email);
            if (email) {
                await braze.updateAttributes( brazeUnifiedFlag ? eligible[0].eid:  email, {
                    b2b_eid: eligible[0].eid,
                    b2b_employer: employer[0].name,
                    b2b_employer_id: employer[0].external_id
                });
                if (!eligible[0].sf_id) {
                    recordForUpdate.sf_id = await eligibilityController.createSalesForceAccount(employer[0], { ...eligible[0], ...recordForUpdate })
                    console.log('createSalesForceAccount ', recordForUpdate.sf_id)
                }
            }
            await db.updateEligibility(recordForUpdate, eligible[0].id)
        }

        // replace keys with reenrollment sku in orderEvent.emp_set

        if(orderEvent.emp_set.eligibility_reenrollment_wm_gsm_sku)
            orderEvent.emp_set.eligibility_wm_gsm_sku = orderEvent.emp_set.eligibility_reenrollment_wm_gsm_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_msk_pst_sku)
            orderEvent.emp_set.eligibility_msk_pst_sku = orderEvent.emp_set.eligibility_reenrollment_msk_pst_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_pst_sku)
            orderEvent.emp_set.eligibility_pst_sku = orderEvent.emp_set.eligibility_reenrollment_pst_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_msk_cva_sku)
            orderEvent.emp_set.eligibility_msk_cva_sku = orderEvent.emp_set.eligibility_reenrollment_msk_cva_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_bp_gsm_sku)
            orderEvent.emp_set.eligibility_bp_gsm_sku = orderEvent.emp_set.eligibility_reenrollment_bp_gsm_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_ig_sku)
            orderEvent.emp_set.eligibility_ig_sku = orderEvent.emp_set.eligibility_reenrollment_ig_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_iphone_sku)
            orderEvent.emp_set.eligibility_iphone_sku = orderEvent.emp_set.eligibility_reenrollment_iphone_sku 
        if(orderEvent.emp_set.eligibility_reenrollment_usbc_sku)
            orderEvent.emp_set.eligibility_usbc_sku = orderEvent.emp_set.eligibility_reenrollment_usbc_sku 

        let result = await shop.createPendingEligibilityOrder(orderEvent);
        let shopResult = result.body ? JSON.parse(result.body) : '';

        // TODO: discuss whether to move to line 91
        shopResult.zipcode = userData.postcode;
        shopResult.b2b = userData.b2b ? userData.b2b : null
        shopResult.actions = userData.actions ? userData.actions : null

        if (shopResult && shopResult.state !== 'verified') {
            console.error(`Error creating pending eligibility order, state is not verified`, shopResult);
            throw shopResult;
        } else {
            console.log('Pending Order created successfully', JSON.stringify(shopResult));
            return { status: 'success', result: shopResult };
        }
    }
    catch (err) {
        await errorHandling(err, event)
    }
}

exports.UpdateEidsForExistingUsersOnShop = async () => {

    try {
        const batchSize = 100;
        let offset = 0;
        return processBatch(batchSize, offset);
    } catch (error) {
        console.log(`UpdateEidsForExistingUsersOnShop`, error);
        throw error;
    }
}

exports.ActivateEligibilityOrder = async (event, context) => {
    try {
        console.log('[ActivateEligibilityOrder]', event);

        if (!event.Payload || !event.eligibleData || !event.shopData) {
            return response({ status: 'error' }, new Error('[ActivateEligibilityOrder - Error] Missing require data'));
        }

        let pndOrderPayload = JSON.parse(Buffer.from(event.Payload, 'base64'));
        let eligProds = event.eligibleData.eligible_products ? event.eligibleData.eligible_products : ''
        let shopData = event.shopData.status ? event.shopData : JSON.parse(event.shopData)
        console.log('[ActivateEligibilityOrder]', pndOrderPayload, eligProds, shopData);

        if (!pndOrderPayload || !eligProds || !shopData) {
            return response({ status: 'error' }, new Error(`[ActivateEligibilityOrder- Error] Missing data. pndOrderPayload: ${pndOrderPayload}, eligProds: ${eligProds}, shopData: ${shopData}`));
        }

        let ordered = []
        Object.keys(eligProds).filter(prod => {
            if (!eligProds[prod]) {
                ordered.push(...prod.split('_'))
                return prod.split('_')
            }
            return false
        })
        let ids = []
        let ids_activate = []

        shopData.result.orders.forEach(val => {
            ids_activate.push(val.order_id)
            ids.push(val.order_id, val.subscription_id)
        })

        let order_body = {
            eligibility_products_selected: pndOrderPayload.form,
            eligibility_products_purchased: ordered,
            billing_cell_phone: event.eligibleData.phone,
            ids: ids,
            ids_activate: ids_activate
        }
        console.log('[ActivateEligibilityOrder]-> order_body', order_body)

        const soleraEmployerExternalId = 20020;
        if (pndOrderPayload.api_data.employer_id == soleraEmployerExternalId) {
            const referenceId = crypto.randomBytes(20).toString('hex');
            const requestId = await handleSoleraEnrollment(pndOrderPayload.user_data.attribute_1, pndOrderPayload.user_data.attribute_2, referenceId);
            await saveSoleraActivity(referenceId, requestId, soleraEmployerExternalId, pndOrderPayload.api_data.eid);
        }

        let result = await shop.activateEligibilityOrder({ order_body });
        let shopResult = result.body ? JSON.parse(result.body) : '';
        console.log('[ActivateEligibilityOrder] -> shopResult: ', shopResult);
        if (shopResult && shopResult.state !== 'verified') {
            console.error(`Error while activating eligibility order, state is not verified`, shopResult);
            throw shopResult;
        }
        else {
            console.log('activated Order successfully', JSON.stringify(shopResult));
            return { status: 'success', result: shopResult };
        }
    }
    catch (err) {
        await errorHandling(err, event)
    }
}

async function processBatch(batchSize, offset) {
    try {
        console.log(`BatchSize ${batchSize}  Offset ${offset}`);
        const [users] = await db.getEligibilityList(batchSize, offset);
        console.log(`Updating Users List`, JSON.stringify(users));

        if (users.length > 0) {
            // Prepare the data in the required format for the API
            const usersData = users.map(result => ({
                shop_email: result.shop_email,
                eid: result.eid,
            }));

            const result = await shop.updateExistingEids(usersData);
            console.log(`Successfully Updated Batch No. ${(offset / batchSize) + 1}`, result)
            offset += batchSize;
            await processBatch(batchSize, offset);
        } else {
            // All batches have been processed
            console.log('EID update completed.');
            return { status: 'success' };
        }
    } catch (error) {
        throw error;
    }

}

async function handleSoleraEnrollment(enrollmentId, programId, referenceId) {
    await solera.getToken();

    const enrollmentActivity = {
        "userId": enrollmentId,
        "referenceId": referenceId,
        "programId": programId,
        "timestamp": new Date().toISOString(),
        "data": {
            "Enrollment": true
        }
    };

    const requestId = await solera.postActivity([enrollmentActivity]);

    return requestId;
}

async function saveSoleraActivity(referenceId, requestId, employerExternalId, eid) {
    const enrollmentRequest = {
        "eid": eid,
        "reference_id": referenceId,
        "request_id": requestId,
        "employer_id": employerExternalId,
        "status": "processing"
    }
    await db.addSoleraActivityRequest(enrollmentRequest);
}

async function errorHandling(err, event) {
    let error = err.response ? err.response.body : err;

    if (error.code === 'rest_not_logged_in') {
        function OrderCreateRetryError(message) {
            this.name = 'OrderCreateRetryError';
            this.message = message;
        }
        OrderCreateRetryError.prototype = new Error();

        let msg = `Order API failed to log-in. restarting...`;
        const error = new OrderCreateRetryError(msg);
        console.log({ status: "error", description: msg, error: JSON.stringify(err.response) });
        throw error;
    }

    console.error(`Error creating shop eigibility order`, error);
    await emailSrv.sendEmail(`Error Creating Eligibility Shop Order for employer ${event.employer_id} (${process.env.STAGE}: ${event.ExecutionName})`, safeStringify(error));
    throw safeStringify(error);
}

function safeStringify(val) {
    if (typeof val === 'object') {
        return JSON.stringify(val);
    }
    else if (IsJsonString(val)) {
        return val;
    }
}

function IsJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}