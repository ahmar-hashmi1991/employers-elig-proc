const got = require('got');
const secrets = require('./secrets-service');
const email = require('./email-service');
const redis = require('../services/redis-service');

const SOLERA_SECRET_NAME = `${process.env.STAGE}-employers-elig-solera`;
const ONE_MINUTE_IN_MS = 60000;
const RETRY_CONFIGURATION = {
    limit: 3,
    methods: [
        'GET',
        'POST'
    ],
    calculateDelay: ({computedValue}) => {
        if (!computedValue) {
            // Maybe pass the AWS Function name as we need to get OAuth token (getUserToken) anyway
            email.sendEmail(
                'Solera error',
                'Solera error in function "test_function_name"' 
            );
            
            return 0; // No retry
        }

        return ONE_MINUTE_IN_MS; // 1 minute in ms
    }
};
const REDIS_CONFIG_SECRET = 'solera-token';
const REDIS_CACHE_VERSION = 'v1';
const TOKEN_PRE_REFRESH_IN_SECONDS = 90; //TODO: find more appropriate last part of the name

class SoleraOAuthService {
    static instance = null

    constructor() {
        if (!SoleraOAuthService.instance) {
            console.log(`Creating Solera OAuth instance...`);
            SoleraOAuthService.instance = this;
            this.initClient = new Promise((resolve, reject) => SoleraOAuthService.initService(resolve, reject));
        }
        return SoleraOAuthService.instance;
    }

    static async initService(resolve, reject) {
        const secret = await secrets.getSecret(SOLERA_SECRET_NAME);
        const instance = got.extend({
            prefixUrl: secret.oAuthUrl, //https://solera-stg.auth0.com/
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json'
            },
            retry: RETRY_CONFIGURATION
        });
        resolve(instance);
    }
}

class SoleraPartnerNetworkService {
    static instance = null;
    static accessToken = null;

    constructor(accessToken) {
        if (!SoleraPartnerNetworkService.instance) {
            console.log(`Creating Solera Partner Network instance...`);
            SoleraPartnerNetworkService.instance = this;
            this.initClient = new Promise((resolve, reject) => SoleraPartnerNetworkService.initService(resolve, reject, accessToken));
        }
        else if (accessToken && accessToken !== SoleraPartnerNetworkService.accessToken) {
            console.log(`Updating Solera Partner Network instance...`);
            SoleraPartnerNetworkService.instance = this;
            SoleraPartnerNetworkService.accessToken = accessToken;
            this.initClient = new Promise((resolve, reject) => SoleraPartnerNetworkService.initService(resolve, reject, accessToken));
        }
        return SoleraPartnerNetworkService.instance;
    }

    static async initService(resolve, reject, accessToken) {
        const secret = await secrets.getSecret(SOLERA_SECRET_NAME);
        const instance = got.extend({
            prefixUrl: secret.baseUrl, //https://solera-api-gateway-stg.azure-api.net/ --> provider/v2/userinfo/
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            retry: RETRY_CONFIGURATION
        });
        resolve(instance);
    }
}

/**
 * @returns {Object} Response object
 */
const getToken = async () => {
    let accessToken = await redis.get(`${REDIS_CONFIG_SECRET}-${REDIS_CACHE_VERSION}`);
    console.log('[soleraService.getToken] token from redis: ', accessToken); //TODO: remove after debug
    if (!accessToken) {
        console.log('[soleraService.getToken] empty access token in redis'); //TODO: remove after debug
        const secret = await secrets.getSecret(SOLERA_SECRET_NAME);
        const soleraOAuthClient = await new SoleraOAuthService().initClient;
        const body = {
            client_id: secret.clientId,
            client_secret: secret.clientSecret,
            audience: "wavePartnerAPI",
            grant_type: "client_credentials",
        };
        const response = await soleraOAuthClient.post('oauth/token', {
            json: body,
        });
        
        accessToken = response.body.access_token;
        const ttl = response.body.expires_in - TOKEN_PRE_REFRESH_IN_SECONDS;

        await redis.set(`${REDIS_CONFIG_SECRET}-${REDIS_CACHE_VERSION}`, accessToken, ttl);
        console.log('[soleraService.getToken] set token to redis: ', accessToken); //TODO: remove after debug
    }

    new SoleraPartnerNetworkService(accessToken);
}

/**
 * @param {string} lookupKey 
 * @returns 
 */
const getUserDetails = async (lookupKey) => {
    const soleraPartnerNetworkClient = await new SoleraPartnerNetworkService().initClient

    const response = await soleraPartnerNetworkClient.get(`provider/v2/userinfo/${lookupKey}`)

    return response.body;
}

/**
 * @param {string} userId
 * @param {string} programId
 * 
 * @returns {bool} enrolled
 */
const getEligibilityStatus = async (userId, programId) => {
    const soleraPartnerNetworkClient = await new SoleraPartnerNetworkService().initClient

    const response = await soleraPartnerNetworkClient.get(`provider/v2/program/${programId}/${userId}/enrolled`);

    return response.body.enrolled;
}

/**
 * 
 * @param {Array} activities
 * 
 * @returns {string} requestId
 */
const postActivity = async (activities) => {
    const soleraPartnerNetworkClient = await new SoleraPartnerNetworkService().initClient

    console.log('[soleraService.postActivity] json', {"activities": activities});

    const response = await soleraPartnerNetworkClient.post(`provider/v2/activities`, {
        json: {
            "activities": activities
        }
    });

    return response.body.requestId;
}

/**
 * 
 * @param {string} requestId 
 * 
 * @returns {Object} 
 */
const getActivityStatus = async (requestId) => {
    const soleraPartnerNetworkClient = await new SoleraPartnerNetworkService().initClient

    const response = await soleraPartnerNetworkClient.get(`provider/v2/activities/batch/${requestId}/status`);

    return {
        status: response.body.data.status,
        successes: response.body.data.successes,
        errors: response.body.data.errors,
    }
}

/**
 * @param {string} enrollmentId
 * @param {string} programId
 * 
 * @returns {bool} enrolled
 */
 const getMilestonesStatus = async (enrollmentId, programId) => {
    const soleraPartnerNetworkClient = await new SoleraPartnerNetworkService().initClient

    const response = await soleraPartnerNetworkClient.get(`provider/v2/milestones/${programId}/${enrollmentId}`);

    return response.body;
}

module.exports = {
    getToken,
    getUserDetails,
    getEligibilityStatus,
    postActivity,
    getActivityStatus,
    getMilestonesStatus,
}