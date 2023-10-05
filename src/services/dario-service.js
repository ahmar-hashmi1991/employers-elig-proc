const got = require('got');
const secrets = require('./secrets-service');
const crypto = require('crypto');
const db = require('../services/rds-data-service');
const secretName = `${process.env.STAGE}-employers-elig-dario`;

class DarioClient {
    constructor() {
        if (!DarioClient.instance) {
            console.log(`Creating Dario Client instance...`);
            DarioClient.instance = this;

            this.promise = new Promise(function(resolve, reject) {
                initService(resolve,reject);
            });
        }

        return DarioClient.instance;
    }
}

async function initService(resolve, reject){
    let secret = await secrets.getSecret(secretName);

    const instance = got.extend({
        prefixUrl: secret.url,
        responseType: 'json',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${secret.apikey}`
        }
    });
    resolve(instance);
}

module.exports = {
    createDarioUser: async (email, first_name, last_name, phone, language, region , role, isMinor, appEmail, eid, reseller_employee_id, employer_id, b2bData, gender, dob, isTestUser) => {
        if(!email || !employer_id){
            const message = !email ? 'missing user email...' : 'missing employer id...';
            console.log(message);
            return {status: 'fail'}
        }

        let pass = 'Qwerty1!';
        if(process.env.STAGE !== 'stage'){
            pass = `${Date.now()}${pass}`;
        }
        let salt = crypto.createHash('md5').update(pass).digest('hex');
        let password = crypto.createHash('md5').update(`${email}${salt}`).digest('hex');
        const [employer] = await db.getEmployerByID(employer_id);
        console.log('createDarioUser- getEmployerByID',employer[0].external_id, JSON.stringify(employer))
        if(!employer.length){
            console.log(`Employer ${employer_id} was not found`);
            return {status: 'fail'}
        }

        let eligibility_rules = JSON.parse(employer[0].eligibility_rules)
        console.log("membership - ",eligibility_rules.membership)
        const isMrn = eligibility_rules.membership ? eligibility_rules.membership.mrn : false;
        console.log(`isMrn: ${isMrn}`, JSON.stringify(eligibility_rules));

        let body = {
            "email": email,
            "password": password,
            "first_name": first_name,
            "last_name": last_name,
            "srgn": region,
            "slng": language,
            "relation": role,
            "is_minor": isMinor,
            "parent_email": appEmail,
            "eid": eid,
            "employer_id": employer[0].external_id,
            "dob": dob,
            "test_user_ind": isTestUser
        }
        if(phone) body.phone_number = phone;
        if(b2bData.weight) body.weight = b2bData.weight;
        if(b2bData.height) body.height = b2bData.height;
        if(b2bData.hba1c) body.hba1c = b2bData.hba1c;
        if(b2bData.last_fasting_bg) body.last_fasting_bg = b2bData.last_fasting_bg;
        if(gender) body.gender = gender;
        if(isMrn) body.mrn = reseller_employee_id;

        console.log("Dario REQ ---> ", JSON.stringify(body));

        // For unit testing purposes
        if (process.env.NODE_ENV === 'test') {
            body.password = 'jestTest';
            return body;
        }

        let client = await new DarioClient().promise;

        return client.post(`user`, {
            body: JSON.stringify(body)
        });
    },
    assignToClinic: async (clinic_auth, email = false, meta_data = false) => {
        if(!email){
            console.log('missing user email...')
            return {status: 'fail'}
        }

        let body = {
            "email": email
        }

        if(meta_data){
            body.meta_data = JSON.stringify(meta_data);
        }
        
        let client = await new DarioClient().promise;
        console.log("Dario REQ ---> ", JSON.stringify(body));
        return client.post(`provisioning`, {
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${clinic_auth}`
            }
        });
    },
    removeFromClinic: async (clinic_auth, userId = false) => {
        if(!userId){
            console.log('missing user ID...')
            return {status: 'fail'}
        }
        
        let client = await new DarioClient().promise;
        console.log("Dario DELETE ---> ", userId);
        return client.delete(`provisioning/${userId}`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${clinic_auth}`
            }
        });
    },
    DarioUserMembership: async (body) =>{
        let client = await new DarioClient().promise;
        console.log("Dario REQ ---> ", JSON.stringify(body));
        let darioRes = client.put(`membership/user`, {
            body: JSON.stringify(body)
        });
        console.log("Dario RES ---> ", darioRes.body ? JSON.stringify(darioRes.body) : JSON.stringify(darioRes));
        return darioRes
    },
    removeMinorLink: async (email) => {
        if(!email){
            console.log('missing user email...')
            return {status: 'fail'}
        }

        let body = {
            "email": email
        }
        
        let client = await new DarioClient().promise;
        console.log("Dario REQ ---> ", email);

        return client.post(`user/delete_linked_account`, {
            body: JSON.stringify(body),
        });
    }
}