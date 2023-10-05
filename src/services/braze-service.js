const got = require('got');
const secrets = require('./secrets-service');
const crypto = require('crypto');
const { deflate, unzip } = require('zlib');
const { promisify } = require('util');

const secretName = `${process.env.STAGE}-employers-elig-braze`;
const soleraSecretName = `${process.env.STAGE}-employers-elig-solera`;
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

const subscription_groups = [
    {id: '4afb5610-6508-4728-a0f2-cfdc9b8a3f6b', target: 'dario'},
    {id: '7054c5d2-e124-4048-9b06-64fa49c8e880', target: 'dario'},
    {id: '98ccb769-420e-429b-bd21-d60abf9c4aa7', target: 'dario'},
    {id: '871deba4-0d3b-4308-ab86-bd52049b39ee', target: 'dario'},
    {id: 'f3afef55-d791-43a9-a33e-393096e1e77b', target: 'msk'},
    {id: '45583009-70d3-4196-aab1-4b956322f00a', target: 'msk'}
];

class BrazeClient {
    constructor() {
        if (!BrazeClient.instance) {
            console.log(`Creating Braze Client instance...`);
            BrazeClient.instance = this;

            this.secret = secrets.getSecret(secretName);
            this.dario = this.initDarioService();
            this.msk = this.initMskService();
            this.upright = this.initUprightService();
        }

        return BrazeClient.instance;
    }

    async initDarioService(){
        let secret = await this.secret;
    
        const instance = got.extend({
            prefixUrl: secret.url,
            responseType: 'json',
            headers: {
                'Authorization': `Bearer ${secret.apikey}`,
                'Content-Type': 'application/json'
            }
        });
        return instance;
    }

    async initMskService(){
        let secret = await this.secret;
    
        const instance = got.extend({
            prefixUrl: secret.url,
            responseType: 'json',
            headers: {
                'Authorization': `Bearer ${secret.apiKeyMsk}`,
                'Content-Type': 'application/json'
            }
        });
        return instance;
    }

    async initUprightService(){
        let secret = await this.secret;
        const instance = got.extend({
            prefixUrl: secret.url,
            responseType: 'json',
            headers: {
                'Authorization': `Bearer ${secret.apiKeyUpright}`,
                'Content-Type': 'application/json'
            }
        });
        return instance;
    }
}

async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const data = [];
        stream.on('data', (chunk) => {
            data.push(chunk);
        });
        stream.on('end', () => {
            resolve(Buffer.concat(data))
        })
        stream.on('error', (err) => {
            reject(err)
        })
    })
}

async function downloadWhenReady(url) {
    return new Promise((resolve, reject) => {
        let downloadStream;
        let i = 0, max = 10;
        let timer = setInterval(async () => {
            try {
                console.log(`dowaload attemp... ${++i}`);
                downloadStream = got.stream(url);
                downloadStream
                    .on("downloadProgress", ({ transferred, total, percent }) => {
                        const percentage = Math.round(percent * 100);
                        console.log(`segment file progress: ${transferred}/${total} (${percentage}%)`);
                    })
                    .on("error", (error) => {
                        console.error(`Download failed: ${error.message}`);
                    });
                let zipfile = await streamToBuffer(downloadStream);
                clearInterval(timer);
                resolve(zipfile);
            }
            catch (err) {
                console.log(`failed download attemp... ${i}`);
            }
        }, 1000);
    })
}

async function invokeCampaign(campaignId, data, externalId) {
    let client = await new BrazeClient().dario;

    let reqBody = {
        campaign_id: campaignId,
        trigger_properties: data,
        broadcast: false,
        recipients: [
            { external_user_id: externalId }
        ]
    };
    let response = await client.post(`campaigns/trigger/send`, {
        body: JSON.stringify(reqBody)
    });
    console.log('response', response.body);
}

module.exports = {
    generateExternalIds: async (emails)=>{
        if(Array.isArray(emails)){
            let externalIds = emails.map(email => crypto.createHash('md5').update(email).digest('hex'))
            return externalIds;
        }
    },
    sendUserEvent: async (id, eventName, eventProperties, userAttributes, employerId = null) => {
        const unifiedSecrets = await secrets.getSecret(unifiedSecretName);

        console.log(`externalId--`, id);
        console.log(`unifiedSecrets--`, JSON.stringify(unifiedSecrets)); 

        let externalId =  unifiedSecrets.unifiedFlag ?  id :   crypto.createHash('md5').update(id).digest('hex');
        let client;
        if (employerId === 10000) {
            client = await new BrazeClient().upright;
        } else {
            client = await new BrazeClient().dario;
        }
        let reqBody = {
            events: [{
                    external_id: externalId,
                    name: eventName,
                    time: new Date(),
                    properties: eventProperties
            }]
        };

        if(userAttributes){
            if (userAttributes.country && userAttributes.country.length > 2) {
                userAttributes.country = userAttributes.country.slice(0, 2)
            }
            reqBody.attributes = [{
                ...userAttributes,
                external_id: externalId
            }];
        }

        console.log("Braze REQ ---> ", JSON.stringify(reqBody));
        let response = await client.post(`users/track`, {
            body: JSON.stringify(reqBody)
        });
        console.log("Braze RESP <--- ", response.body);
        return response.body;
    },
    updateAttributes: async (id, userAttributes) => {
        const unifiedSecrets = await secrets.getSecret(unifiedSecretName);

        console.log(`externalId--`, id);
        console.log(`unifiedSecrets--`, JSON.stringify(unifiedSecrets)); 

        let externalId =  unifiedSecrets.unifiedFlag ?  id :   crypto.createHash('md5').update(id).digest('hex');

        let client = await new BrazeClient().dario;
        let reqBody = {
            attributes: [{
                ...userAttributes,
                external_id: externalId
            }]
        };

        console.log("Braze REQ ---> ", JSON.stringify(reqBody));
        let response = await client.post(`users/track`, {
            body: JSON.stringify(reqBody)
        });
        console.log("Braze RESP <--- ", response.body);
        return response.body;
    },
    deleteBrazeUser: async (email) => {
       
        let externalId =  crypto.createHash('md5').update(email).digest('hex');
        let client = await new BrazeClient().dario;
        let reqBody = {
            "external_ids": [externalId]
        };
        let response = await client.post(`users/delete`, {
            body: JSON.stringify(reqBody)
        });
        return response.body;
    },
    getSegmentUsers: async (segmentId) => {
        let client = await new BrazeClient().dario;
        let reqBody = {
            segment_id: segmentId,
            output_format: "gzip",
            fields_to_export: [
                "email",
                "custom_attributes"
            ]
        };
        let response = await client.post(`users/export/segment`, {
            body: JSON.stringify(reqBody)
        });
        console.log('response', response.body);
        await new Promise((resolve,reject) => {setTimeout(() => {resolve();}, 2000);});
        if(response.body.message === 'success'){
            
            let zipfile = await downloadWhenReady(response.body.url);
            const do_unzip = promisify(deflate);
            let file = await do_unzip(zipfile);
            return file;
        }
        return null;
    },
    exportSegmentUsers: async (segmentId, callbackUrl) => {
        let client = await new BrazeClient().dario;
        let reqBody = {
            segment_id: segmentId,
            callback_endpoint: callbackUrl,
            output_format: "gzip",
            fields_to_export: [
                "email",
                "custom_attributes"
            ]
        };
        let response = await client.post(`users/export/segment`, {
            body: JSON.stringify(reqBody)
        });
        console.log('response', response.body);
    },
    updateUserSubscriptionGroup: async (externalId, groupId, phone, subscription_state) => {
        let client = await new BrazeClient().dario;
        let reqBody = {
            external_id: externalId,
            subscription_group_id: groupId,
            subscription_state,
            phone: [phone]
        };

        console.log("Braze REQ ---> ", JSON.stringify(reqBody));
        let response = await client.post(`subscription/status/set`, {
            body: JSON.stringify(reqBody)
        });
        console.log("Braze RESP <--- ", response.body);
        return response.body;
    },
    subscribeToAllSubscriptionGroups: async (email, phone, optId = true) => {
        let externalId = crypto.createHash('md5').update(email).digest('hex');
        let darioClient = await new BrazeClient().dario;
        let mskClient = await new BrazeClient().msk;
        let client;

        let promises = subscription_groups.map(async grp => {
            let reqBody = {
                external_id: externalId,
                subscription_group_id: grp.id,
                subscription_state: optId ? 'subscribed' : 'unsubscribed',
                phone: [phone]
            };
            console.log("Braze REQ ---> ", reqBody);
            if(grp.target === 'dario'){
                client = darioClient;
            }
            else{
                client = mskClient;
            }

            let result = await client.post(`subscription/status/set`, {
                body: JSON.stringify(reqBody)
            });
            return result.body;
        });

        let results = await Promise.all(promises);
        console.log("Braze RESP <--- ", results);
        return results;
    },
    setEmailSubscription: async (email, state) => {
        let darioClient = await new BrazeClient().dario;
        let mskClient = await new BrazeClient().msk;

        let reqBody = {
            "email": email,
            "subscription_state": state
        };
        let response = await Promise.all([
            darioClient.post(`email/status`, {
                body: JSON.stringify(reqBody)
            }),
            mskClient.post(`email/status`, {
                body: JSON.stringify(reqBody)
            })
        ]);
        return {
            dario: response[0].body,
            msk: response[1].body
        };
    },
    invokeSoleraMilestonesCampaign: async (email, data, milestoneNumber) => {
        let externalId = crypto.createHash('md5').update(email).digest('hex');

        const soleraSecret = await secrets.getSecret(soleraSecretName);
        const campaignId = soleraSecret[`braze_m${milestoneNumber}_campaign_id`];

        await invokeCampaign(campaignId, data, externalId);
    },
    invokeSoleraCampaign: async (email, data) => {
        let externalId = crypto.createHash('md5').update(email).digest('hex');

        const soleraSecret = await secrets.getSecret(soleraSecretName);
        const campaignId = soleraSecret[`milestones_achieved_campaign_id`];

        await invokeCampaign(campaignId, data, externalId);
    }
}