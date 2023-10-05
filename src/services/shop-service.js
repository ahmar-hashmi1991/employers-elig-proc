const got = require('got');
const secrets = require('./secrets-service');
const db = require('./rds-data-service');
const constants = require('../common/constants');
const emailSrv = require('./email-service')

const secretName = `${process.env.STAGE}-employers-elig-shop`;
const secretNameCfuk = `${process.env.STAGE}-employers-elig-cfuk`;

class ShopClient {
    constructor() {
        if (!ShopClient.instance) {
            console.log(`Creating Shop Client instance...`);
            ShopClient.instance = this;

            this.promise = new Promise(function(resolve, reject) {
                initService(resolve,reject);
            });
        }

        return ShopClient.instance;
    }
}

async function initService(resolve, reject){
    let secret = await secrets.getSecret(secretName);

    const instance = got.extend({
        prefixUrl: secret.url,
        responseType: 'json',
        searchParams: {
            consumer_key: secret.consumer_key,
            consumer_secret: secret.consumer_secret
        },
        headers: {
            'Content-Type': 'application/json'
        }
    });
    resolve(instance);
}

const modifyOrderDataForReenrolledUser = async (orderData) => {
    const { RedeemedProductStatus, Behaviors, MembershipOnlySKUsKeys } = constants;
    const { emp_set, api_data, user_data } = orderData;
    console.log('[modifyOrderDataForReenrolledUser] orderData: ', JSON.stringify(orderData));
    const employer = await db.getEmployerByExternalID(emp_set.eligibility_api_id);
    console.log('[modifyOrderDataForReenrolledUser] employer: ', JSON.stringify(employer));
    let { behaviors, membershipSKU } = (typeof employer.eligibility_rules === 'string')? JSON.parse(employer.eligibility_rules) : employer.eligibility_rules;
    console.log('[modifyOrderDataForReenrolledUser] behaviors: ', JSON.stringify(behaviors));

    const [employees] = await db.getEligibility(employer.id, api_data.eid);
    const employee = employees && employees[0];

    if (typeof behaviors == "object"
    && !Array.isArray(behaviors)
    && employee.record_source
    && behaviors[employee.record_source])
  {
    console.log("behaviors", behaviors[employee.record_source]);
    behaviors = behaviors[employee.record_source];
  }

  const hasReenrollmentBehavoir = behaviors && behaviors.some(b => b === Behaviors.REENROLLMENT);
  console.log('[modifyOrderDataForReenrolledUser] hasReenrollmentBehavoir: ', hasReenrollmentBehavoir);
  if (!hasReenrollmentBehavoir) {
      console.log('[modifyOrderDataForReenrolledUser] inside hasReenrollmentBehavoir: ', hasReenrollmentBehavoir);
    return;
  }

    const [redeemedProducts] = await db.getRedeemedProductsList(employee.id);
    console.log('[modifyOrderDataForReenrolledUser] redeemedProducts.length: ', redeemedProducts.length);
    if (!redeemedProducts || !redeemedProducts.length) {
        return;
    }

    console.log(`[modifyOrderDataForReenrolledUser] redeemedProducts before ---> ${JSON.stringify(redeemedProducts)}`)
    console.log(`[modifyOrderDataForReenrolledUser] user_data.newReenroledProducts ${user_data.newReenroledProducts}`)
    if(!(user_data.newReenroledProducts === true)){ // if user ask for product to be deliver ( No change in SKU)
        console.log(`[modifyOrderDataForReenrolledUser] user_data.isManualReEnrollment ${user_data.isManualReEnrollment}`)
        if(user_data.isManualReEnrollment === true){ // change skus to membership only
            console.log(`[modifyOrderDataForReenrolledUser] orderData.api_data.eligible_products ---> ${JSON.stringify(orderData.api_data.eligible_products)}`)
            const previousSelectedProducts = Object.keys(orderData.api_data.eligible_products).filter(key => orderData.api_data.eligible_products[key] === false);
            const commonProducts = Object.keys(orderData.products_json).filter(productType => previousSelectedProducts.includes(productType)); // common products in 
            console.log(`[modifyOrderDataForReenrolledUser] commonProducts ---> ${JSON.stringify(commonProducts)}`)
            for (const key of commonProducts) {
                const value = MembershipOnlySKUsKeys[key];
                console.log(`[modifyOrderDataForReenrolledUser] value ${value} = membershipSKU ${membershipSKU[key]} = key ${key}`)
                if(value){
                    if (typeof value === 'object') {
                      for (const subKey in value) {
                        emp_set[value[subKey]] = membershipSKU[key];
                      }
                    } else {
                      emp_set[value] = membershipSKU[key];
                    }
                }
            }
            for (const key in MembershipOnlySKUsKeys) {
                const mappedKey = key.toLowerCase(); // Convert key to lowercase
                if(commonProducts.includes(key)){
                    if (mappedKey in emp_set.products) {
                        const nestedObject = emp_set.products[mappedKey];
                        if (typeof nestedObject === 'object') {
                          for (const subKey in nestedObject) {
                            nestedObject[subKey] = membershipSKU[key];
                          }
                        }
                    }
                }
            }
        }
    }

};

const sendNotificationCfUK = async (orderData) => {
    console.log("[sendNotificationCfUK]  orderData ---> ",orderData)
    const checkSendEmail = !!orderData.emp_set &&
    orderData.emp_set.eligibility_internal_id === "cf_industries" &&
    !!orderData.user_data &&
    orderData.user_data.country === "GB" &&
    !!orderData.products_json &&
    !!orderData.products_json.BG;
    
    if(checkSendEmail === false){
        return
    }

    const secret = await secrets.getSecret(secretNameCfuk);
    const emails = secret.cf_uk_emails

    const firstName = orderData.user_data.first_name
    const lastName = orderData.user_data.last_name || ''
    
    const shippingEmail = orderData.user_data.email
    const phone = orderData.user_data.phone
    const address1 = orderData.user_data.address_1 || ''
    const address2 = orderData.user_data.address_2 || ''
    const city = orderData.user_data.city || ''
    const state = orderData.user_data.state || ''
    const postcode = orderData.user_data.postcode || ''
    
    const fullAdress = `${address1}, ${address2}, ${city}, ${state}, ${postcode}`

    let message = `
    BTB client: CF Industries<br>
    Client (BTBTC) name: ${firstName} ${lastName}<br>
    Address for shipment: ${fullAdress}<br>
    Contact details: ${shippingEmail} ${phone}<br>
    `;

    let tableHTML = "<table border='1'><tr><th>SKU</th><th>Qty</th></tr>";

    if (
        secret.products &&
        JSON.parse(secret.products)[orderData.products_json.BG]
      ) {
        products = JSON.parse(secret.products)[orderData.products_json.BG];
        
        for (const product of products) {
          const sku = Object.keys(product)[0];
          const qty = product[sku];
    
          tableHTML += `<tr><td>${sku}</td><td>${qty}</td></tr>`;
        }
    
        tableHTML += "</table>";
      }
      message += tableHTML;
    
    console.log('[sendNotificationCfUK]',message,emails);

    await emailSrv.sendEmail("CF UK BG Order",message,emails)

    console.log('send order notification')
    
}

module.exports = {
    modifyOrderDataForReenrolledUser,
    cancelOrders: async orderIds => {
        if(!orderIds || orderIds.length === 0){
            console.log('no orders to cancel in shop')
            return {status: 'success'}
        }

        let reqBody = {
            update: orderIds.map(id => ({id: id, status: 'cancelled'}))
        }

        let client = await new ShopClient().promise;
        console.log("Shop REQ ---> ", JSON.stringify(reqBody));
        return client.post(`wp-json/wc/v3/orders/batch`, {
            body: JSON.stringify(reqBody)
        });
    },
    cancelSubscription: async subscriptionIds => {
        if(!subscriptionIds || subscriptionIds.length === 0){
            console.log('no subscriptions to cancel in shop')
            return {status: 'success'}
        }

        let reqBody = {
            subscription: { status: 'cancelled' }
        }

        let client = await new ShopClient().promise;
        console.log("Shop REQ ---> ", JSON.stringify(reqBody));
        let promises = subscriptionIds.map(subid => client.put(`wc-api/v3/subscriptions/${subid}`, { body: JSON.stringify(reqBody) }));
        return Promise.all(promises);
    },
    createOrder: async orderData => {
        if(!orderData){
            console.log('no order data to send to the shop')
            return {status: 'fail'}
        }

        let client = await new ShopClient().promise;
        console.log("Shop REQ ---> ", JSON.stringify(orderData));
        return client.post(`wp-json/wc/v3/drAddVitFlexOrder`, {
            body: JSON.stringify(orderData)
        });
    },
    createEligibilityOrder: async orderData => {
        if(!orderData){
            console.error('missing order data');
            return {status: 'fail'}
        }

        let client = await new ShopClient().promise;
        console.log("Shop REQ ---> ", JSON.stringify(orderData));
        return client.post(`wp-json/wc/v3/drAddElgOrder`, {
            body: JSON.stringify(orderData)
        });
    },
    createPendingEligibilityOrder: async (orderData) => {
        if (!orderData) {
            console.error('missing order data');
            return { status: 'fail' };
        }

        await modifyOrderDataForReenrolledUser(orderData)

        const client = await new ShopClient().promise;
        console.log("Shop Pending order REQ ---> ", JSON.stringify(orderData));

        // send Email for CF UK
        await sendNotificationCfUK(orderData)
        
        return client.post(`wp-json/wc/v3/drAddPndElgOrder`, {
            body: JSON.stringify(orderData)
        });
    },
    updateExistingEids: async (usersData) => {
        if (!usersData) {
            console.error('missing  user  data');
            return { status: 'fail' };
        }

        const client = await new ShopClient().promise;
        console.log("Shop Update Existing Eids REQ ---> ", JSON.stringify(usersData));
        return client.post(`wp-json/wc/v3/drUpdateExistingEids`, {
            body: JSON.stringify(usersData)
        });
    },
    activateEligibilityOrder: async orderData => {
        if(!orderData){
            console.error('[activateEligibilityOrder] missing order data', orderData);
            return {status: 'fail'}
        }

        let client = await new ShopClient().promise;
        console.log("Shop activate order REQ ---> ", JSON.stringify(orderData));
        return client.post(`wp-json/wc/v3/drActivateElgOrder`, {
            body: JSON.stringify(orderData)
        });
    },
    getEmployerWithEName: async empName => {
        try {
            // const secret = await secrets.getSecret(secretName);
            // let opts = {
            //     method: 'GET',
            //     responseType: 'json',
            //     url:`${secret.url}/wp-json/wc/v3/drGetEmployer?emp_id=${empName}`,
            //     searchParams: {
            //         consumer_key: secret.consumer_key,
            //         consumer_secret: secret.consumer_secret
            //     },
            //     headers: {
            //         'Content-Type': 'application/json'
            //     }
            // };
            // console.log(`getEmployerWithEName opts --  ${JSON.stringify(opts)}`)
            // const resp = await got(opts).json();
            // console.log(`createReEnrolledPendingOrder resp ---- ${JSON.stringify({resp})}`);
            // return resp; 

            const secret = await secrets.getSecret(secretName);
            const client = await new ShopClient().promise;
            console.log(`Shop getEmployerWithEName empName ---> ${empName}`);
            const resp = await client.get(`wp-json/wc/v3/drGetEmployer`, {
                searchParams: {
                    emp_id: empName,
                    consumer_key: secret.consumer_key,
                    consumer_secret: secret.consumer_secret
                }
            });
            console.log(`createReEnrolledPendingOrder resp.body ---- ${JSON.stringify(resp.body)}`);
            return resp.body; 
        } catch (error) {
            console.log(`Error in getEmployerWithEName ${JSON.stringify(error)}`)
            throw error
        }
    }
}