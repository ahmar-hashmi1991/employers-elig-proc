const got = require('got');
const secrets = require('./secrets-service');

const secretName = `${process.env.STAGE}-employers-elig-engage`;

class EngageClient {
    constructor() {
        if (!EngageClient.instance) {
            console.log(`Creating Engage Client instance...`);
            EngageClient.instance = this;

            this.promise = new Promise(function(resolve, reject) {
                initService(resolve,reject);
            });
        }

        return EngageClient.instance;
    }
}

async function initService(resolve, reject){
    let secret = await secrets.getSecret(secretName);

    const instance = got.extend({
        prefixUrl: secret.url,
        responseType: 'json',
        headers: {
            'Content-Type': 'application/json',
            'x-access-token': secret.api_key
        }
    });
    resolve(instance);
}

module.exports = {
    assignPatientToCoach: async (patientEmail, coachId, employerRules) => {
        let client = await new EngageClient().promise;

        let accountName = (employerRules && employerRules.clinic_meta.channel ? employerRules.clinic_meta.channel : '')
        let subAccountName = (employerRules && employerRules.clinic_meta.sub_channel ? employerRules.clinic_meta.sub_channel : '')

        let reqBody = {
            email: patientEmail,
            channel: accountName,
            sub_channel: subAccountName
        }

        console.log(`Engage REQ, coach ID ${coachId} ---> `, reqBody);
        return client.post(`api/v1/p/coach/${coachId}/assign`, {
            body: JSON.stringify(reqBody)
        });
    },
    sendAcheiveMilestoneToEngage: async (data) => {
        let client = await new EngageClient().promise;

        let reqBody = {
            "milestones": [
                {
                    "ENGAGE_PATIENT_ID": data.ENGAGE_PATIENT_ID,
                    "REPORT_DATE": data.REPORT_DATE,
                    "EXTERNAL_USER_ID": data.EXTERNAL_USER_ID,
                    "UID": data.UID,
                    "EID": data.EID,
                    "MILESTONE_ACHIEVED_DATE": data.MILESTONE_ACHIEVED_DATE,
                    "MILESTONE_ACHIEVED": data.MILESTONE_ACHIEVED,
                    "EXTERNAL_COACH_ID": data.EXTERNAL_COACH_ID,
                    "NEXT_MILESTONE": data.NEXT_MILESTONE,
                    "NEXT_MILESTONE_DUE_DATE": data.NEXT_MILESTONE_DUE_DATE,
                    "REMAINING_MEASUREMENTS": data.REMAINING_MEASUREMENTS,
                    "CREATED_AT": data.CREATED_AT
                }
            ]
        }

        console.log(`Engage REQ, reqBody ---> `, reqBody);
        return client.post(`api/v2/p/patients/achieved-milestones`, {
            body: JSON.stringify(reqBody)
        });
    }
}