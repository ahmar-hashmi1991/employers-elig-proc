const jsforce = require('jsforce');
const secrets = require('./secrets-service');
const utils = require('../common/utils');

const secretName = `${process.env.STAGE}-employers-elig-salesforce`;
const unifiedUserSecretName = `${process.env.STAGE}-unified-flag`

class SalesforceClient {
    constructor() {
        if (!SalesforceClient.instance) {
            console.log(`Creating Salesforce Client instance...`);
            SalesforceClient.instance = this;

            this.promise = new Promise(function(resolve, reject) {
                initService(resolve,reject);
            });
        }

        return SalesforceClient.instance;
    }
}

async function initService(resolve, reject){
    let secret = await secrets.getSecret(secretName);

    const conn = new jsforce.Connection({
        loginUrl: secret.url
    });
    let token = secret.token;
    let buff = Buffer.from(token, 'base64');
    let up = buff.toString('ascii').split(':');

    console.log(`Connecting to Salesforce ...`);
    conn.login(up[0], up[1], (err, res) => {
        if (err) {
            return console.log('Salesforce connection error -', err);
        }
        console.log('Salesforce connection successful!', res);
        resolve(conn);
    });
}

module.exports = {
    unifiedUserSecretName,
    findAccountByEmail: async (email) => {
        let sfconn = await new SalesforceClient().promise;
        return sfconn.sobject("Account").find({ PersonEmail: email }).execute();
    },
    findAccountByEid: async (elig_id) => {
        const sfconn = await new SalesforceClient().promise;
        return sfconn.sobject("Account").find({ Eligibility_ID__c: elig_id }).execute();
    },
    getEmployerSFAccount: async (employerId) => {
        let sfconn = await new SalesforceClient().promise;
        return sfconn.query(`SELECT Account_Line_of_Business__c,Account_Type__c,Eligibility_Account_ID__c FROM Eligibility_Account__c WHERE Eligibility_Account_ID__c = '${employerId}'`);
    },
    createEmployerSFAccount: async (employerName, employerId, account_line, account_type) => {
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Eligibility_Account__c").create({
            Name: employerName,
            Eligibility_Account_ID__c: employerId,
            Account_Line_of_Business__c : account_line,
            Account_Type__c : account_type
        });
        console.log('SF Create new Account result: ', results);
        return results;
    },
    updateEmployerSFAccount: async (employerId, account_line, account_type) => {
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Eligibility_Account__c").find({ Eligibility_Account_ID__c: employerId }).update({
            Account_Line_of_Business__c: account_line,
            Account_Type__c: account_type
        });
        console.log('Employer SF account update result: ', results);
        return results;
    },
    createOrUpdateEligibility: async (
        sf_id,
        elig_id,
        email,
        FirstName,
        LastName,
        birthdate,
        sf_eligbility_account_ID,
        PersonMobilePhone,
        HomePhone,
        employerName,
        employerId,
        status,
        stage,
        targeting = 0,
        address,
        gender = '',
        isTestRecord = false) => {
        const { unifiedFlag } = await secrets.getSecret(unifiedUserSecretName);
        const sfEmail = unifiedFlag && utils.isFakeEmail(email) ? '' : email;
        console.log('[SF] createOrUpdateEligibility Started', 'sf_id', sf_id, 'sfEmail', sfEmail);
        const sfconn = await new SalesforceClient().promise;
        console.log('[SF] Connected');
        let account;
        if (sf_id) {
            console.log('[SF] find by sf_id STARTED', sf_id);
            try {
                account = await sfconn.sobject("Account").retrieve(sf_id);
                console.log('[SF] find by sf_id DONE', account);
            } catch(err) {
                console.log('[SF] find by eid STARTED', elig_id);
                const results = await sfconn.query(`SELECT Account.Id FROM Account where Eligibility_ID__c = '${elig_id}'`);
                if (results.length) {
                    console.log('[SF] found existing account by eid: ', results);
                    account = results[0];
                } else {
                    console.error(err, `ERROR update SF account by id - missing or invalid id value: ${sf_id}`)
                }
                console.log('[SF] find by eid DONE', account);
            }
        }

        console.log('[SF] account details', account);

        //Update existing SF account
        if (account) {
            const sfParams = {
                PersonEmail: sfEmail,
                PersonBirthdate: birthdate,
                Eligibility_Employer__c: employerName,
                Eligibility_Employer_ID__c: employerId,
                Eligibility_Status__c: status,
                Eligibility_Stage__c: stage,
                Eligibility_ID__c: elig_id,
                Eligibility_Targeting__c: targeting,
                test_user_ind__c: isTestRecord
            };
            if (address && !account.Billing_Address_1__c) {
                console.log('[SF] updating account address...');
                sfParams.Billing_Address_1__c = address.address_1;
                sfParams.Billing_Address_2__c = address.address_2;
                sfParams.Billing_City__c = address.city;
                sfParams.Billing_State__c = address.state;
                sfParams.Billing_Zipcode__c = address.zipcode;
                sfParams.Billing_Country__c = (address.country ? address.country.slice(0, 2) : 'US')
            }
            if (gender) sfParams.Gender__pc = gender;
            if (PersonMobilePhone) sfParams.PersonMobilePhone = PersonMobilePhone;
            if (HomePhone) sfParams.Phone = HomePhone;
            if (FirstName) sfParams.FirstName = FirstName;
            if (LastName) sfParams.LastName = LastName;

            console.log('[SF] update existing account started: ', sfParams);
            const sfIdResults = await sfconn.sobject("Account").find({ Id: account.Id }).update(sfParams);
            console.log('[SF] update existing account result: ', sfIdResults);
            return sfIdResults[0];
        };

        //Creating new SF Account
        console.log('[SF] Account does not exist, creating new Account.');
        const sfNewAccount = {
            PersonEmail: sfEmail,
            FirstName,
            LastName,
            PersonBirthdate: birthdate,
            Eligibility_Account_Name__c: sf_eligbility_account_ID,
            PersonMobilePhone,
            Phone: HomePhone,
            Eligibility_Employer__c: employerName,
            Eligibility_Employer_ID__c: employerId,
            Eligibility_Status__c: status,
            Eligibility_Stage__c: stage,
            Eligibility_ID__c: elig_id,
            Eligibility_Targeting__c: targeting,
            test_user_ind__c: isTestRecord
        };
        if (address) {
            sfNewAccount.Billing_Address_1__c = address.address_1;
            sfNewAccount.Billing_Address_2__c = address.address_2;
            sfNewAccount.Billing_City__c = address.city;
            sfNewAccount.Billing_State__c = address.state;
            sfNewAccount.Billing_Zipcode__c = address.zipcode;
            sfNewAccount.Billing_Country__c = (address.country ? address.country.slice(0, 2) : 'US');
        };
        if (gender) sfNewAccount.Gender__pc = gender;
        console.log('[SF] creating new Account.', JSON.stringify(sfNewAccount));
        const sfCreateNewAccountResults = await sfconn.sobject("Account").create(sfNewAccount);
        console.log('[SF] creating new Account result: ', sfCreateNewAccountResults);
        return sfCreateNewAccountResults;
    },
    updateSFAccountTargeting: async (sf_id, targeting) => {
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Account").find({ Id: sf_id }).update({
            Eligibility_Targeting__c: targeting
        });
        console.log('[SF] account targeting update result: ', results);
        return results;
    },
    updateAccountEligibility: async (sf_id, elig_id, employerName, employerId, status, stage) => {
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Account").find({ Id: sf_id }).update({
            Eligibility_Employer__c: employerName,
            Eligibility_Employer_ID__c: employerId,
            Eligibility_Status__c: status,
            Eligibility_Stage__c: stage,
            Eligibility_ID__c: elig_id
        });
        console.log('[SF] account update result: ', results);
        return results;
    },
    updateEligibilityStatus: async (elig_id, status, stage) => {
        const sfconn = await new SalesforceClient().promise;
        const { unifiedFlag } = await secrets.getSecret(unifiedUserSecretName);
        const searchKey = unifiedFlag ? 'Eligibility_ID__c' : 'PersonEmail'; // for unifiedFlag === true elig_id is email
        const results = await sfconn.sobject("Account").find({ [searchKey]: elig_id }).update({ Eligibility_Status__c: status, Eligibility_Stage__c: stage });
        console.log('[SF] status update result: ', results);
        return results;
    },
    updateEligibilityStage: async (sf_id, stage) => {
        let sfconn = await new SalesforceClient().promise;
        const results = await sfconn.sobject("Account").find({ Id: sf_id }).update({ Eligibility_Stage__c: stage });
        console.log('[SF] stage update by SF id result: ', results);
        return results;
    },
    cancelOrders: async orderIds => {
        if(!orderIds || orderIds.length === 0){
            console.log('no orders to cancel in SF')
            return {status: 'success'}
        }
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Opportunity").find({ Order_ID__c: {$in: orderIds} }).update({ StageName: 'Cancel' });
        console.log('[SF] order cancel result: ', results);
        return results;
    },
    cancelSFSubscriptions: async subscriptionIds => {
        if(!subscriptionIds || subscriptionIds.length === 0){
            console.log('no subscriptions to cancel in SF')
            return {status: 'success'}
        }
        subscriptionIds = subscriptionIds.map(s => Number(s));
        let sfconn = await new SalesforceClient().promise;
        let results = await sfconn.sobject("Subscription__c").find({ Subscription_Number_For_flow__c: {$in: subscriptionIds}}).update({ Status__c: 'Cancelled' });
        console.log('[SF] subscription cancel result: ', results);
        return results;
    },
    updateSFFlags: async (sf_id,flags) => {
        let sfconn = await new SalesforceClient().promise;
        let flagsToUpdate = {}
        if(flags.activate_grocery_scanner) flagsToUpdate.Grocery_Scanner__c = flags.activate_grocery_scanner;
        if(flags.activate_healthkit_observers) flagsToUpdate.Device_Integration__c = flags.activate_healthkit_observers;
        if(flags.activate_prescription_manager) flagsToUpdate.Medication_Cabinet__c = flags.activate_prescription_manager;
        const results = await sfconn.sobject("Account").find({ Id: sf_id }).update({ ...flagsToUpdate });
        console.log('Update flags by SF id result: ', results);
        return results;
    }
}
