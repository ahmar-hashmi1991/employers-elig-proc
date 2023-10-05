const got = require('got');
const secrets = require('./secrets-service');

const secretName = `${process.env.STAGE}-employers-elig-msk`;

class UprightClient {
    constructor() {
        if (!UprightClient.instance) {
            console.log(`Creating Upright MSK Client instance...`);
            UprightClient.instance = this;

            this.client = initService();
        }

        return UprightClient.instance;
    }
}

async function initService(){
    let secret = await secrets.getSecret(secretName);

    const instance = got.extend({
        prefixUrl: secret.url,
        responseType: 'json',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    return instance;
}

module.exports = {
    createMSKUser: async (email, eid, first_name, last_name, phone, employer_id, dario_external_id, ordered, test_user_ind) => {
        let client = await new UprightClient().client;
        let body = {
            email,
            phone,
            employer_id,
            dario_external_id,
            first_name,
            last_name,
            ordered,
            eid,
            test_user_ind
        }

        console.log("Upright REQ  body ---> ", body);
        return client.post(`v1/enrollment/user`, {
            json: body
        });
    }
}