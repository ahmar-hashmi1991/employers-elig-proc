const brazeService = require('../services/braze-service');
const db = require('../services/rds-data-service');
const solera = require('../services/solera-service');
const queue = require('../services/sqs-service');
const email = require('../services/email-service');
const crypto = require("crypto");
const constants = require('../common/constants');
const engageService = require('../services/engage-service');

const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

exports.sendDevErrorEmail = async (event, context) => {
    try {
        console.log('sendDevErrorEmail event and context:', { event, context });
        const { subject, message } = JSON.parse(event.body);
        const resSendEmail = await email.sendEmail(
            subject || 'Solera Request Error',
            message || 'To many failed requests to Solera API'
        );
        console.log('sendDevErrorEmail resSendEmail:', resSendEmail);
        return response({ success: true })
    } catch (error) {
        console.log('sendDevErrorEmail error:', error.message);
    }
}

exports.getSoleraUser = async (event, context) => {
    console.log('[getSoleraUser] event', JSON.stringify(event));

    await solera.getToken();

    const data = JSON.parse(event.body);
    const lookupKey = data.lookupKey;

    console.log('[getSoleraUser] lookupKey', lookupKey);

    const soleraResponse = await solera.getUserDetails(lookupKey);

    return response(soleraResponse);
}

exports.cronSoleraEnrollmentStatusHandler = async (event, context) => {
    console.log('[cronSoleraEnrollmentStatusHandler] event', JSON.stringify(event));

    await solera.getToken();

    const soleraEmployerExternalId = 20020;
    let [employers] = await db.getEmployer(soleraEmployerExternalId);
    console.log(`[cronSoleraEnrollmentStatusHandler] employer =${JSON.stringify(employers[0])}`);

    let [users] = await db.getEmployerEligibilityList(employers[0].id);
    console.log(`[cronSoleraEnrollmentStatusHandler] users =${JSON.stringify(users)}`);
    if (users.length < 1) {
        console.log('[cronSoleraEnrollmentStatusHandler] users empty');
        return;
    }

    let disenrolledUserIds = [];
    for (const [id, user] of users.entries()) {
        const eligibilityStatus = await solera.getEligibilityStatus(user.attribute_1, user.attribute_2);

        if (!eligibilityStatus && user.termination_date == null) {
            disenrolledUserIds.push(user.id);
        }
    }
    console.log(`[cronSoleraEnrollmentStatusHandler] disenrolled user ids=${disenrolledUserIds}`);

    if (disenrolledUserIds.length < 1) {
        console.log('[cronSoleraEnrollmentStatusHandler] disenrolledUserIds empty');
        return;
    }

    for(const [id, disenrolledUserId] of disenrolledUserIds.entries()) {
        const body = {
                userId: disenrolledUserId
        };
        await queue.sendSoleraMessage(body);
    }
}

exports.cronSoleraMilestoneStatusHandler = async (event, context) => {
    console.log('[cronSoleraEnrollmentStatusHandler] event', JSON.stringify(event));

    await solera.getToken();

    const soleraEmployerExternalId = 20020;
    let [employers] = await db.getEmployer(soleraEmployerExternalId);
    console.log(`[cronSoleraEnrollmentStatusHandler] employer =${JSON.stringify(employers[0])}`);

    let [users] = await db.getEmployerEligibilityList(employers[0].id);
    console.log(`[cronSoleraEnrollmentStatusHandler] users =${JSON.stringify(users)}`);
    if (users.length < 1) {
        console.log('[cronSoleraEnrollmentStatusHandler] users empty');
        return;
    }

    for (const [id, user] of users.entries()) {
        if (user.attribute_1 == null || user.attribute_2 == null) {
            // await email.sendEmail(
            //     'Solera Milestones Error',
            //     `Solera error in function ${context.functionName} - user ${user.eid} doesn't have attribute_1 or 2`
            // );
            console.log(`[cronSoleraEnrollmentStatusHandler] Solera error in function ${context.functionName} - user ${user.eid} doesn't have attribute_1 or 2`);
            continue;
        }

        const response = await solera.getMilestonesStatus(user.attribute_1, user.attribute_2);

        if (response.length == 0) {
            // await email.sendEmail(
            //     'Solera Milestones Error',
            //     `Solera error in function ${context.functionName} - user ${user.eid} doesn't have milestones info`
            // );
            console.log(`[cronSoleraEnrollmentStatusHandler] Solera error in function ${context.functionName} - user ${user.eid} doesn't have milestones info`);

            continue;
        }

        if ('status' in response[0]) {
            // await email.sendEmail(
            //     'Solera Milestones Error',
            //     `Solera error in function ${context.functionName} - user ${user.eid} recieved status code 400`
            // );
            console.log(`Solera error in function ${context.functionName} - user ${user.eid} recieved status code 400`);

            continue;
        }
    }
}

exports.sqsDisenrolmentHandler = async (event, context) => {
    console.log('[sqsDisenrolmentHandler] event', event);

    for (record of event.Records) {
        try {
          console.log('[sqsDisenrolmentHandler] - user id to add to disenrollment', record.body);
          const data = JSON.parse(record.body)
          const disenrolledUserId = data.userId;

          let terminationDate = new Date();

            await db.updateEligibility({
                termination_date: terminationDate.toISOString().substring(0, 10)
            },
                disenrolledUserId);

          console.log('Terminated user', disenrolledUserId);
        }
        catch(error){
          console.log(error);
          new Error(`ERROR: ${error.message}`)
        }
    }
}

exports.cronSoleraActivitiesStatusHandler = async (event, context) => {
    console.log('[cronSoleraActivitiesStatusHandler] event', event);

    const date = new Date();
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1)

    const [yesterdayDate] = date.toISOString().split('T');
    const [yesterdayTime] = date.toTimeString().split(' ');

    const [activities] = await db.getProcessingActivityRequestsOlderThen(`${yesterdayDate} ${yesterdayTime}`);

    console.log('[cronSoleraActivitiesStatusHandler] activities', JSON.stringify(activities));
    if (activities.length < 1) {
        console.log('[cronSoleraActivitiesStatusHandler] activities empty');
        return;
    }

    const successActivityIds = {
        referenceIds: [],
        requestIds: []
    };
    const failedActivityIds = {
        referenceIds: [],
        requestIds: []
    };

    await solera.getToken();
    for (const [id, activity] of activities.entries()) {
        const results = await solera.getActivityStatus(activity.request_id);

        if (results.status != 'completed') {
            continue;
        }

        if (results.successes.length > 0) {
            successActivityIds.referenceIds.push(results.successes[0].referenceId);
            successActivityIds.requestIds.push(activity.request_id);
        }

        if (results.errors.length > 0) {
            failedActivityIds.referenceIds.push(results.errors[0].referenceId);
            failedActivityIds.requestIds.push(activity.request_id);
        }
    }

    if (successActivityIds.referenceIds.length > 0) {
        console.log('[cronSoleraActivitiesStatusHandler] success activities', JSON.stringify(successActivityIds));
        for (const [id, activity] of successActivityIds.referenceIds.entries()) {
            await db.updateProcessingActivityRequests('success', successActivityIds.referenceIds[id], successActivityIds.requestIds[id]);
        }
    }

    if (failedActivityIds.referenceIds.length > 0) {
        console.log('[cronSoleraActivitiesStatusHandler] failed activities', JSON.stringify(failedActivityIds));
        for (const [id, activity] of failedActivityIds.referenceIds.entries()) {
            await db.updateProcessingActivityRequests('failed', failedActivityIds.referenceIds[id], failedActivityIds.requestIds[id]);
        }
    }
}

const handleSoleraMeasurements = async (data) => {
    console.log('[handleAPIRequest.solera_measurements] data', data);

    const referenceId = crypto.randomBytes(20).toString('hex');

    const [users] = await db.getEligibilityByFields(`eid = ?`, [data.EID]);
    const user = users[0];
    console.log('[handleAPIRequest.solera_measurements] user', user);

    const measureActivity = {
        "userId": user.attribute_1,
        "referenceId": referenceId,
        "programId": user.attribute_2,
        "timestamp": new Date(data.MEASURE_DATE).toISOString(),
        "data": {
            "SystolicBloodPressure": `${data.BP_SYS}`,
            "DiastolicBloodPressure": `${data.BP_DIS}`,
        }
    }

    await solera.getToken();
    const requestId = await solera.postActivity([measureActivity]);

    const soleraEmployerExternalId = 20020;

    const measureAcitivityRecord = {
        "eid": user.eid,
        "reference_id": referenceId,
        "request_id": requestId,
        "employer_id": soleraEmployerExternalId,
        "status": "processing"
    }

    await db.addSoleraActivityRequest(measureAcitivityRecord);
}

const handleSoleraClinicStatus = async (data) => {
    console.log('[handleAPIRequest.solera_clinic_status] data', data);

    const [users] = await db.getEligibilityByFields(`eid = ?`, [data.EID]);
    const user = users[0];
    console.log('[handleAPIRequest.solera_clinic_status] user', user);

    const triggerProperties = {
        "m4_measurements_completed": data.MEASUREMENTS_COMPLETED,
        "m4_sustain": data.SUSTAIN,
        "m4_out_of_range": data.OUT_OF_RANGE,
        "m4_completed_last_10_days": data.COMPLETED_LAST_10_DAYS,
        "m4_sustain_last_10_days": data.SUSTAIN_LAST_10_DAYS,
        "m4_out_of_range_last_10_days": data.OUT_OF_RANGE_LAST_10_DAYS,
        "m4_clinic_status_last_10_days": data.CLINIC_STATUS_LAST_10_DAYS,
        "m4_completed_last_15_days": data.COMPLETED_LAST_15_DAYS,
        "m4_sustain_last_15_days": data.SUSTAIN_LAST_15_DAYS,
        "m4_out_of_range_last_15_days": data.OUT_OF_RANGE_LAST_15_DAYS,
        "m4_clinic_status_last_15_days": data.CLINIC_STATUS_LAST_15_DAYS,
        "m4_completed_last_20_days": data.COMPLETED_LAST_20_DAYS,
        "m4_sustain_last_20_days": data.SUSTAIN_LAST_20_DAYS,
        "m4_out_of_range_last_20_days": data.OUT_OF_RANGE_LAST_20_DAYS,
        "m4_clinical_status_last_20_days": data.CLINICAL_STATUS_LAST_20_DAYS,
        "m4_completed_last_25_days": data.COMPLETED_LAST_25_DAYS,
        "m4_m4_sustain_last_25_days": data.M4_SUSTAIN_LAST_25_DAYS,
        "m4_out_of_range_last_25_days": data.OUT_OF_RANGE_LAST_25_DAYS,
        "m4_clinical_status_last_25_days": data.CLINICAL_STATUS_LAST_25_DAYS,
        "m4_completed_last_29_days": data.COMPLETED_LAST_29_DAYS,
        "m4_sustain_last_29_days": data.SUSTAIN_LAST_29_DAYS,
        "m4_out_of_range_last_29_days": data.OUT_OF_RANGE_LAST_29_DAYS,
        "m4_clinical_status_last_29_days": data.CLINICAL_STATUS_LAST_29_DAYS,
    }

    // Vlad Novitsky: actualy this one for milestones 4 and 5, but 5 is redundant so it's 4 here
    const milestoneNumber = 4;

    const email = getEmailForBraze(user);

    await brazeService.invokeSoleraMilestonesCampaign(email, triggerProperties, milestoneNumber);
}

const getEmailForBraze = (user) => {
    return user.app_email != null ? user.app_email
                    : user.shop_email != null ? user.shop_email
                    : user.email;
}

const handleMilestonesStatus = async (data, milestoneNumber) => {
    console.log('[handleAPIRequest.solera_milestones] data', data);

    const [users] = await db.getEligibilityByFields(`eid = ?`, [data.EID]);
    const user = users[0];
    console.log('[handleAPIRequest.solera_milestones] user', user);

    const triggerProperties = {
        "measurements_completed": data.MEASUREMENTS_COMPLETED
    };

    const email = getEmailForBraze(user);

    await brazeService.invokeSoleraMilestonesCampaign(email, triggerProperties, milestoneNumber);
}

const handleMilestonesAchieved = async (data) => {
    console.log('[handleAPIRequest.solera_milestones] data', data);

    const [users] = await db.getEligibilityByFields(`eid = ?`, [data.EID]);
    const user = users[0];
    console.log('[handleAPIRequest.solera_milestones] user', user);

    const eventName = constants.BrazeSolera[`M${data.MILESTONE_ACHIEVED}_MILESTONE`];

    const triggerProperties = {
        "engage_patient_id": data.ENGAGE_PATIENT_ID,
        "report_date": data.REPORT_DATE,
        "external_user_id": data.EXTERNAL_USER_ID,
        "uid": data.UID,
        "eid": data.EID,
        "milestone_achieved_date": data.MILESTONE_ACHIEVED_DATE,
        "milestone_achieved": data.MILESTONE_ACHIEVED,
        "external_coach_id": data.EXTERNAL_COACH_ID,
        "next_milestone": data.NEXT_MILESTONE,
        "next_milestone_due_date": data.NEXT_MILESTONE_DUE_DATE,
        "remaining_measurements": data.REMAINING_MEASUREMENTS,
        "created_at": data.CREATED_AT
    };

    const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);

    const email = getEmailForBraze(user);
    await brazeService.sendUserEvent( brazeUnifiedFlag ?   data.EID: email, eventName, {}, {});
    await brazeService.invokeSoleraCampaign(email, triggerProperties);
    await engageService.sendAcheiveMilestoneToEngage(data);
   
}

const response = (res, err) => {
    return {
        statusCode: err ? '400' : '200',
        body: err ? JSON.stringify({ success: false, error: err.message }) : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    }
}

exports.handleAPIRequest = async (event, context) => {
    console.log('[handleAPIRequest] event', event);

    const operationName = event.requestContext.operationName;

    try {
        switch (`${operationName}`) {
            case 'solera_measurements':
                const measurementsData = JSON.parse(event.body);
                await handleSoleraMeasurements(measurementsData);

                break;
            case 'solera_clinic_status':
                const clinicStatusData = JSON.parse(event.body);
                await handleSoleraClinicStatus(clinicStatusData);

                break;
            case 'solera_milestones_achieved':
                const milestonesAchievedData = JSON.parse(event.body);
                await handleMilestonesAchieved(milestonesAchievedData);

                break;
            case 'solera_milestone_two':
                const milestoneTwoData = JSON.parse(event.body);
                await handleMilestonesStatus(milestoneTwoData, 2);

                break;
            case 'solera_milestone_three':
                const milestoneThreeData = JSON.parse(event.body);
                await handleMilestonesStatus(milestoneThreeData, 3);

                break;
            default:
                return response({ success: false }, new Error(`ERROR: Unsupported Operation`));
        }
    } catch (error) {
        console.log(error);
        console.log(error.message);
        return response({ success: false }, new Error(`ERROR: Uknown Error Occured`));
    }
    return response({ success: true });
}