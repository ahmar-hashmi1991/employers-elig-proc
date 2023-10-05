const got = require('got');
const qs = require('qs');
const secrets = require('./secrets-service');
const cache = require('./redis-service');
DEFAULT_TOKEN_TTL = 60;

const secretName = `${process.env.STAGE}-employers-elig-vitality-flex-api`


class FlexAPIClient {
    constructor() {
        if (!FlexAPIClient.instance) {
            console.log(`Creating Flex API Client Client instance...`);
            FlexAPIClient.instance = this;

            this.promise = new Promise(function (resolve, reject) {
                initService(resolve, reject);
            });
        }

        return FlexAPIClient.instance;
    }
}

async function initService(resolve, reject) {
    let secret = await secrets.getSecret(secretName);
    const instance = got.extend({
        responseType: 'json',
        prefixUrl: secret.url,
        headers: {
            'user-agent': 'Dario/v1',
            'Authorization': `${secret.authHeader}`
        },
    });
    resolve(instance);
}

async function getApiToken() {
    console.log('GET api token');
    let access_token = await cache.get('VitalityAccessToken');
    console.log('GET api token from cache', access_token);
    if (!access_token) {
        let client = await new FlexAPIClient().promise;
        try {
            console.log('GOT request api token');
            let response = await client.post(`api/token`, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: qs.stringify({ grant_type: 'client_credentials' }),
            });
            console.log('GOT response', response);
            let token = response.body;
            console.log('GOT response token', token);

            let ttl = token.expires_in ? token.expires_in - 10 : DEFAULT_TOKEN_TTL;
            await cache.set('VitalityAccessToken', token.access_token, ttl);
            access_token = token.access_token;
        } catch (err) {
            console.log('ERROR in API call ', err);
            throw new Error(err);
        }
    }
    return access_token;
}

module.exports = {
    getOrder: async (order_number) => {
        let access_token = await getApiToken();
        let client = await new FlexAPIClient().promise;
        try {
            let response = await client.get(`api/flex/1.0/orders/${order_number}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                }
            });
            return response.body;
        } catch (err) {
            console.log('ERROR: ERROR in API call ', err);
            throw new Error(err);
        }
    },
    checkEligibility: async (member_id) => {
        let access_token = await getApiToken();
        let client = await new FlexAPIClient().promise;
        try {
            let response = await client.get(`api/flex/1.0/eligibility/${member_id}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                }
            });
            console.log('GOT response eligibility', response.body);
            return response.body;
        } catch (err) {
            console.log('ERROR: ERROR in API call ', err);
            throw new Error(err);
        }
    },
    updateOrderToCompleted: async (order_number) => {
        let access_token = await getApiToken();
        let client = await new FlexAPIClient().promise;
        let dateISOString = new Date().toISOString();
        let date = dateISOString.slice(0,dateISOString.indexOf('.')) + '+0000';
        try {
            let response = await client.post(`api/flex/1.0/order_status/${order_number}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${access_token}`,
                },
                json: {
                    status: 'PROCESSED',
                    date: date
                }
            });
            console.log('GOT response eligibility', response.body);
            return response.body;
        } catch (err) {
            console.log('ERROR: ERROR in API call ', err);
            throw new Error(err);
        }
    },
    sendEvents: async (member_id, eventCode) => {
        let access_token = await getApiToken();
        let client = await new FlexAPIClient().promise;
        let dateISOString = new Date().toISOString();
        let date = dateISOString.slice(0,dateISOString.indexOf('.')) + '+0000';
        try {
            let response = await client.post(`api/flex/1.0/event`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${access_token}`,
                },
                json: {
                    memberId: member_id,
                    eventCode: eventCode,
                    eventDate: date
                }
            });
            console.log('GOT response events', response.body);
            return response.body;
        } catch (err) {
            console.log('ERROR: ERROR in API call ', err);
            throw new Error(err);
        }
    }
}