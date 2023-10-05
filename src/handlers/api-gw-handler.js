const db = require('../services/rds-data-service');
const constants = require('../common/constants');
const secrets = require('../services/secrets-service');
const salesforce = require('../services/salesforce-service');
const braze = require('../services/braze-service.js');
const dario = require('../services/dario-service.js');
const engage = require('../services/engage-service.js');
const utils = require('../common/utils');
const states = require('../services/step-function-service');
const emailSrv = require('../services/email-service');
const objectMapper = require('object-mapper');
const jsonMap = require('../common/json-map');
const uuid = require('uuid');
const { createNewEligibilityAsync, getEmployerNameForSalesForce } = require('../controllers/eligibility-controller');
const darioUser = require('../handlers/dario-user-handler');
const flowEvents = require('./api-gw-flow-handler');
const queue = require('../services/sqs-service');
const DUMMY_FILE_HIST_ID = 1;
const TEST_EMAIL_REGEX = '^testqa';

const s3CsvHandler = require('../handlers/s3-csv-handler')
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

const eligibilityResponseFields = [
  'eid',
  'email',
  'phone',
  'status',
  'stage',
  'first_name',
  'last_name',
  'gender',
  'dob',
  'created_at',
  'updated_at',
  'employee_id',
  'employer_id',
  'reseller_employee_id',
  'role',
  'eligible_products',
  'support_email',
  'support_phone',
  'app_email',
  'shop_phone',
  'shop_email',
  'address_1',
  'address_2',
  'city',
  'state',
  'country',
  'zipcode',
  'generated_email',
  'test_record',
  'parent_eid',
  'attribute_1',
  "isManualReEnrollment",
  "reenrollmentSkus",
  "isManualEnrollmentDatePassed",
];

const eligibilityUpdateFields = [
  'status',
  'stage',
  'first_name',
  'last_name',
  'gender',
  'dob',
  'employee_id',
  'shop_phone',
  'sf_id',
  'braze_id',
  'dario_app_uid',
  'app_email',
  'targeting'
];

const eligibilityDBFields = [
  'email',
  'status',
  'stage',
  'first_name',
  'last_name',
  'gender',
  'dob',
  'employee_id',
  'reseller_employee_id',
  'role',
];

const shopEligibility = jsonMap.setupMappingRules({
  first_name: "first_name",
  last_name: "last_name",
  email: {
    key: "email?",
    transform: "email"
  },
  phone: "phone?",
  EmployeeID: {
    key: "reseller_employee_id",
    transform: "hash:first_name:last_name:dob"
  },
  role: {
    key: "role",
    default: "EE"
  },
  gender: "gender",
  dob: {
    key: "dob",
    transform: "date:YYYY-MM-DD"
  },
  address_1: "address_1",
  address_2: "address_2",
  city: "city",
  state: "state",
  postcode: "zipcode",
  attribute_1: "attribute_1",
  attribute_2: "attribute_2",
  attribute_3: "attribute_3",
  attribute_4: "attribute_4",
  attribute_5: "attribute_5"
});

const response = (res, err) => {
  return {
    statusCode: err ? '400' : '200',
    body: err ? err.message : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  }
};

const updateEligibilityStatusToEnrolled = async (eligibility, employer, shopdata, skipOnExternalSrv) => {
  if (eligibility.status === constants.EligibilityStatus.ENROLLED) {
    return false;
  }

  let differentshopEmail = eligibility.shop_email && eligibility.shop_email !== eligibility.email;
  var completedAllRedeemProducts = true;
  for (key in eligibility.eligible_products) {
    if (eligibility.eligible_products[key] === true) {
      let eligibility_rules = JSON.parse(employer.eligibility_rules);

      if (eligibility_rules.removeProductTypesForCountry && 
        eligibility_rules.removeProductTypesForCountry[eligibility.country] &&
        eligibility_rules.removeProductTypesForCountry[eligibility.country].includes(key)) {
          continue;
        }
      completedAllRedeemProducts = false;
    }
  }

  const rules = await getEligibilityRules(employer);

  if (rules.provisioning && rules.provisioning.dario) {
    let provisioningEmail = !!eligibility.app_email ? eligibility.app_email : eligibility.shop_email;
    let orders = shopdata.orders ? shopdata.orders : [];
    let targets = rules.provisioning.targets ? rules.provisioning.targets : [];
    let isMinor = utils.isMinorAge(rules, eligibility.dob)

    await AssignUserToClinicV2(provisioningEmail, targets, eligibility, orders, isMinor, shopdata, rules);

    if (!!eligibility.pcp_id) {
      console.log('Assign patient to primary care provider (PCP)...');
      let [coachMapping] = await db.getEmployerAttribute(employer.id, 'pcp', eligibility.pcp_id);

      if (coachMapping && coachMapping.length === 1) {
        let engageRes = await engage.assignPatientToCoach(eligibility.email, coachMapping[0].value, rules.membership);
        console.log('Engage response', engageRes.body);
      }
      else {
        console.log(`WARNING: could not find coach mapping for PCPID ${eligibility.pcp_id}`);
      }
    }
  }

  // if(!!eligibility.phone){
  //   console.log('Subscribing to all SMS groups in Braze');
  //   await braze.subscribeToAllSubscriptionGroups(eligibility.email, eligibility.phone);
  // }
  const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
  await braze.updateAttributes( brazeUnifiedFlag ?  eligibility.eid  :eligibility.email , { b2b_eligibility_stage: constants.EligibilityStage.ENROLLED, b2b_eid: eligibility.eid  });

  if (completedAllRedeemProducts) {
    console.log('Completed all redeem product options...');
    let actions = [
      db.updateEligibilityStatusStage(constants.EligibilityStatus.ENROLLED, constants.EligibilityStage.ENROLLED, eligibility.id),
      db.addEligibilityLog(eligibility.id, constants.EligibilityLogAction.UPDATE, 'eligibility status set to enrolled')
    ]
    if (!skipOnExternalSrv) {
      console.log('Send to external services - skipOnExternalSrv', skipOnExternalSrv);
      let sfEmployerName = await getEmployerNameForSalesForce(employer, eligibility);
      actions.push(
        salesforce.updateAccountEligibility(eligibility.sf_id, eligibility.eid, sfEmployerName, employer.external_id, constants.EligibilityStatus.ENROLLED, constants.EligibilityStage.ENROLLED),
        differentshopEmail ? braze.sendUserEvent(brazeUnifiedFlag ?  eligibility.eid  :eligibility.email, constants.Braze.ENROLLED_OTHER, { b2b_shop_email: eligibility.shop_email }, { b2b_shop_email: eligibility.shop_email }, employer.id) : null
      )
    }
    return Promise.all(actions);
  }
  else {
    let actions = [
      db.updateEligibilityStage(constants.EligibilityStage.ENROLLED, eligibility.id),
      db.addEligibilityLog(eligibility.id, constants.EligibilityLogAction.UPDATE, 'eligibility stage set to enrolled')
    ]
    if (!skipOnExternalSrv) {
      actions.push(
        salesforce.updateEligibilityStage(eligibility.sf_id, constants.EligibilityStage.ENROLLED),
        differentshopEmail ? braze.sendUserEvent(brazeUnifiedFlag ?  eligibility.eid  :eligibility.email, constants.Braze.ENROLLED_OTHER, { b2b_shop_email: eligibility.shop_email }, { b2b_shop_email: eligibility.shop_email }, employer.id) : null
      )
    }
    return Promise.all(actions);
  }
};


const getEligibility = async (employer, eligibility_id, raw = false) => {
  let [results] = await db.getEligibility(employer.id, eligibility_id);
  if (!raw) {
    if (results[0]) {
      const rules = await getEligibilityRules(employer);
      results[0] = await addProductEigibilityInfo(rules.productTypes, results[0]);
      results[0] = await addSupportPhoneAndEmail(results[0], employer);
    } else {
      results = [];
      results[0] = await addSupportPhoneAndEmail({}, employer);
    }
  }
  return Promise.resolve(results);
};

const updateEligibility = async (data, currentEligibility, employer, skipOnExternalSrv) => {
  console.log('[updateEligibility] --> updating eligibility. data:', data, 'currentEligibility:', currentEligibility);
  if (data.stage && !Object.values(constants.EligibilityStage).includes(data.stage)) {
    return await Promise.reject(new Error("Invalid Stage Value"));
  }

  if (data.status && !Object.values(constants.EligibilityStatus).includes(data.status)) {
    return await Promise.reject(new Error("Invalid Status Value"));
  }

  if (recogniseTestUser(data)) {
    data.test_record = true
  }

  let [recordResult, redeemResult] = await Promise.all([
    updateEligibilityRecord(data, currentEligibility, employer, skipOnExternalSrv),
    updateRedeemRecords(data, currentEligibility),
  ]);

  console.log(`update results [updateEligibilityRecord, updateRedeemRecords]`, [recordResult, redeemResult]);
  return [recordResult, redeemResult];
};

async function CreateDarioUser(eligibility, shopdata) {
  console.log('eligibility', eligibility, eligibility.role)
  if (!!eligibility.app_email) {
    console.log('Dario user already created...');
    return;
  }
  console.log('Creating Dario user...');
  let email = !!eligibility.shop_email ? eligibility.shop_email : eligibility.email;
  let phone = !!eligibility.shop_phone ? eligibility.shop_phone : eligibility.phone;
  let country = !!shopdata.country ? shopdata.country : 'US';
  phone = utils.tryParsePhoneNumber(phone);
  try {
    let darioRes = await dario.createDarioUser(email, eligibility.first_name, eligibility.last_name, phone, 'en', country);
    console.log('Daio user created successfully.', darioRes.statusCode, darioRes.body);
    return await db.updateEligibilityAppEmail(email, eligibility.id);
  }
  catch (err) {
    if (err.response.statusCode === 400 && err.response.body.error && err.response.body.error.code === 10) {
      console.log(`user already exists in Dario - ${err.response.body.error.description}`);
      //user exist make sure to update the eligibility record with it's app email
      if (!!!eligibility.app_email) {
        return await db.updateEligibilityAppEmail(email, eligibility.id);
      }
    }
    else {
      console.error('ERROR in Create Dario user.', err.response.body);
      await emailSrv.sendTemplateEmail(`Error in creation of Dario user during enrollment`, {
        error: JSON.stringify(err.response.body),
        eid: eligibility.eid
      }, 'failed-dario-user-creation');
    }
  }
}

async function AssignUserToClinic(email, products, clinic_auth, eligibility, orders) {
  let should_assign_to_clinic = products.length === 0 ? true : false;
  for (let i in orders) {
    let order = orders[i];
    if (products.indexOf(order.product_type) >= 0) {
      should_assign_to_clinic = true;
    }
  }
  if (should_assign_to_clinic) {
    //execute step function
    let result = await states.executeAssignUserToClinic({ clinic_auth, email, system: 'upright', eligibility });
    console.log('Dario Provisioning StepFunction Response', result);
  }
}

async function AssignUserToClinicV2(email, targets, eligibility, orders, isMinor, shopdata, rules) {
  if (orders.length < 1) {
    console.log('Empty order', shopdata, eligibility);
    return `Empty order`;
  }

  let orderTargets = targets.filter(target => orders.some(o => (typeof target.product.isArray ? target.product.includes(o.product_type) : o.product_type === target.product)))
  let result = await states.executeAssignUserToClinicV2(email, orderTargets, eligibility, isMinor, shopdata, rules);
  console.log('Dario Provisioning StepFunction Responses', result);
}

function generateUpdateRecord(currentEligibility, shopData) {
  let new_record = JSON.parse(JSON.stringify(currentEligibility));
  for (key in shopData) {
    if (key in currentEligibility && (eligibilityUpdateFields.indexOf(key) >= 0)) {
      new_record[key] = shopData[key];
      currentEligibility[key] = shopData[key];
    }
  }
  return new_record;
}

const externalServices = async (currentEligibility, data, employer) => {
  console.log('[externalServices]', currentEligibility, data, employer)

  const new_record = generateUpdateRecord(currentEligibility, data);
  console.log('[externalServices - new_record]', new_record)
  if (data.email) new_record.shop_email = data.email;
  if (data.phone) new_record.shop_phone = data.phone;
  if (data.test_record) new_record.test_record = data.test_record;

  let [employer_attribute] = await db.getEmployerAttribute(currentEligibility.employer_id, "virtual_account", currentEligibility.external_employer_id);

  let brazeRec = {
    b2b_targeting: new_record.targeting,
    b2b_eligibility_status: new_record.status,
    b2b_eligibility_stage: new_record.stage,
    b2b_reseller: employer.reseller_name
  };

  if (employer_attribute[0] && employer_attribute[0].value) {
    brazeRec.b2b_sub_account = employer_attribute[0].value;
  }

  if (data.phone) brazeRec.phone = data.phone;

  const isTestRecord = recogniseTestUser(data);

  new_record.test_record = isTestRecord ? 1 : 0;

  if (data.email && data.email !== currentEligibility.email) {
    let newProfileBrazeRec = {
      email: data.email,
      first_name: new_record.first_name,
      last_name: new_record.last_name,
      phone: data.phone || new_record.phone,
      gender: new_record.gender,
      dob: new_record.dob,
      is_b2b: true,
      b2b_eid: new_record.eid,
      b2b_reseller: employer.reseller_name,
      b2b_employer: employer.name,
      b2b_employer_id: employer.external_id,
      b2b_targeting: new_record.targeting,
      b2b_eligibility_status: new_record.status,
      b2b_eligibility_stage: new_record.stage,
      test_user: isTestRecord ? 'yes' : 'no'
    };

    if (employer_attribute[0] && employer_attribute[0].value) {
      newProfileBrazeRec.b2b_sub_account = employer_attribute[0].value;
    }

    if (data.zipcode) newProfileBrazeRec.address_zipcode = data.zipcode;

    const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
    if (utils.isFakeEmail(currentEligibility.email)) {
      console.log(`updating real email from fake ${currentEligibility.email} --> ${data.email} `);
      new_record.email = data.email;
      new_record.generated_email = 0;
      newProfileBrazeRec.b2b_fake_email = 0;



      await braze.sendUserEvent( brazeUnifiedFlag ? new_record.eid :  currentEligibility.email, constants.Braze.ENROLLED_OTHER, { b2b_shop_email: data.email },
        { b2b_shop_email: data.email }, employer.id);
      brazeRec = newProfileBrazeRec;

      const updatedNewBrazeProfile = await braze.sendUserEvent(brazeUnifiedFlag ? new_record.eid : data.email, constants.Braze.UPDATE, {}, { ...newProfileBrazeRec, b2b_shop_email: data.email }, employer.id);
      console.log('updated new users profile in braze', updatedNewBrazeProfile, 'profile body:', newProfileBrazeRec)

      const { unifiedFlag } = await secrets.getSecret(salesforce.unifiedUserSecretName);
      const existingSFAccount = unifiedFlag ? await salesforce.findAccountByEid(new_record.eid) : await salesforce.findAccountByEmail(data.email);
      console.log('Existing SF account result', existingSFAccount);
      if (existingSFAccount.length) {
        const new_sf_id = existingSFAccount[0].Id;
        console.log(`found existing SF account for user with eid '${new_record.eid}' for given email '${data.email}'. Switching to new account '${new_sf_id}'`);
        new_record.sf_id = new_sf_id;
        currentEligibility.sf_id = new_sf_id;
      }
    }
    else { //need one more update - for shop email. elig email remains the same
      console.log(`provided email address is different from eligibility '${currentEligibility.email}' --> '${data.email}'`);
      let result = await braze.sendUserEvent( brazeUnifiedFlag ? new_record.eid : data.email, constants.Braze.UPDATE, {}, newProfileBrazeRec);
      console.log('additional braze update for shop email ', result);
    }
  }

  if (data.app_email && data.app_email !== currentEligibility.email) {
    console.log(`provided app_email address is different from eligibility '${currentEligibility.email}' --> '${data.app_email}'`);
    let result = await braze.sendUserEvent(brazeUnifiedFlag ? new_record.eid : data.app_email, constants.Braze.UPDATE, {}, {
      email: data.app_email,
      first_name: new_record.first_name,
      last_name: new_record.last_name,
      phone: new_record.phone,
      gender: new_record.gender,
      dob: new_record.dob,
      is_b2b: true,
      b2b_eid: new_record.eid,
      b2b_reseller: employer.reseller_name,
      b2b_employer: employer.name,
      b2b_employer_id: employer.external_id,
      b2b_targeting: new_record.targeting,
      b2b_eligibility_status: new_record.status,
      b2b_eligibility_stage: new_record.stage,
      test_user: data.test_record ? 'yes' : ''
    }, employer.id);
    console.log('additional braze update for application email ', result);
  }

  if (Array.isArray(data.orders)) {
    let ordered = []
    data.orders.map(o => {
      ordered.push(...o.product_type.split('_'))
    })
    brazeRec.b2b_product_type_list = { add: ordered };
  }

  return [brazeRec, new_record]
};

const recogniseTestUser = (userRecord) => {
  const regexp = new RegExp(TEST_EMAIL_REGEX, 'gm');
  const isTestEmail = regexp.test(userRecord.email);

  const isTestRecord = !!userRecord.test_record;

  if (!isTestEmail && !isTestRecord) {
    return false;
  }

  if (isTestRecord && !isTestRecord) {
    return true;
  }

  return true;
}

const updateEligibilityRecord = async (data, currentEligibility, employer, skipOnExternalSrv) => {
  console.log(`[updateEligibilityRecord ] data: ${JSON.stringify(data)}, currentEligibility: ${JSON.stringify(currentEligibility)} `)
  let [brazeRec, new_record] = await externalServices(currentEligibility, data, employer);

  console.log('[updateEligibilityRecord - External res ] brazeRec: ', brazeRec, 'new_record: ', new_record)

  if (skipOnExternalSrv) {
    let [log] = await Promise.all([
      db.addEligibilityLog(currentEligibility.id, 'update', `eligibility updated from api. status: '${new_record.status}', stage: '${new_record.stage}'`)
    ]);

    console.log('[updateEligibilityRecord] --> skipOnExternalSrv- updating eligibility log: ', log)
    console.log('[updateEligibilityRecord] --> skipOnExternalSrv- updating eligibility. new record:', new_record, ' current eligibility:', currentEligibility);
    let [eligibility] = await db.updateEligibility(new_record, currentEligibility.id);

    return [eligibility, log];
  }

  let sfEmployerName = await getEmployerNameForSalesForce(employer, new_record);

  const isTestRecord = recogniseTestUser(data);

  let addressData = {
    address_1: new_record.address_1,
    address_2: new_record.address_2,
    city: new_record.city,
    state: new_record.state,
    zipcode: new_record.zipcode,
    country: new_record.country
  }
  const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
  let [log, saleforceResult, brazeResult] = await Promise.all([
    db.addEligibilityLog(currentEligibility.id, 'update', `eligibility updated from api. status: '${new_record.status}', stage: '${new_record.stage}'`),
    salesforce.createOrUpdateEligibility(currentEligibility.sf_id, new_record.eid, data.email, new_record.first_name, new_record.last_name, new_record.dob, employer.sf_eligbility_account_ID,
      new_record.phone, new_record.home_phone, sfEmployerName, employer.external_id, new_record.status, new_record.stage, new_record.targeting, addressData, new_record.gender, isTestRecord),
    braze.sendUserEvent( brazeUnifiedFlag ? new_record.eid : new_record.email, constants.Braze.UPDATE, {}, brazeRec, employer.id)
  ]);

  console.log('[updateEligibilityRecord] --> updating eligibility log, SF, BRAZE, Results: ', log, saleforceResult, brazeResult)

  if (!new_record.sf_id && saleforceResult && saleforceResult[0] && saleforceResult[0].success === true) {
    new_record.sf_id = saleforceResult[0].id;
  }

  console.log('[updateEligibilityRecord] --> updating eligibility. new record:', new_record, ' current eligibility:', currentEligibility);
  let [eligibility] = await db.updateEligibility(new_record, currentEligibility.id);

  return [eligibility, log, saleforceResult, brazeResult];
};

const updateRedeemRecords = async (data, currentEligibility) => {
  if (!data.orders) {
    return false;
  }
  var recordToAddPromises = [];
  const [redeemed] = await db.getRedeemedProductsList(currentEligibility.id);
  console.log(`[updateRedeemRecords] redeemed ${JSON.stringify(redeemed)}`)
  const transformedObject = redeemed.reduce((result, item) => {
    result[item.product_type] = item.status;
    return result;
  }, {});
  console.log(`[updateRedeemRecords] transformedObject ${JSON.stringify(transformedObject)}`)
  for (key in data.orders) {
    let order = data.orders[key];
    const oldOrder = redeemed.find(item => item.product_type === order.product_type)
    recordToAddPromises.push(
    (transformedObject[order.product_type] && oldOrder)? // if products exist in redeemed products, change status to reenrolled
    (db.deleteRedeemedProductWithOrderId(oldOrder.order_id),
    db.addRedeemedProductToList(currentEligibility.id, {
      order_id: order.order_id,
      subscription_id: order.subscription_id,
      product_type: order.product_type,
      redeemed_at: order.date,
      status: constants.RedeemedProductStatus.REENROLLED,
    }), 
    db.addRedeemedProductHistory(oldOrder)):      
    db.addRedeemedProductToList(currentEligibility.id, {
      order_id: order.order_id,
      subscription_id: order.subscription_id,
      product_type: order.product_type,
      redeemed_at: order.date,
      status: constants.RedeemedProductStatus.ENROLLED,
    }));
    if (!currentEligibility.eligible_products) {
      currentEligibility.eligible_products = {};
    }
    currentEligibility.eligible_products[order.product_type] = false;
  }
  return await Promise.all(recordToAddPromises);
};

const formatEligibilityInfo = async (rawData) => {
  var response = {};
  for (key in rawData) {
    if (eligibilityResponseFields.indexOf(key) >= 0) {
      response[key] = rawData[key];
    }
  }
  return response;
};

const chooseRulesSet = (form_data, rules) => {
  if (rules.validationFields.some(rule => !Array.isArray(rule))) {
    return rules
  }

  let newRules = { ...rules }
  newRules.validationFields = []
  // only arrays are exists in employer's validationFields
  for (let i = 0; i < rules.validationFields.length; i++) {
    let rulesNotMatchedToForm = rules.validationFields[i].some(rule => !(rule in form_data))
    if (!rulesNotMatchedToForm) {
      newRules.validationFields.push(rules.validationFields[i])
    }
  }
  // default rules in case of required rules weren't appeared in form data
  if (newRules.validationFields.length < 1) {
    newRules.validationFields = rules.validationFields[0]
  }
  console.log("chooseRulesSet: newRules ", newRules)
  return newRules
}

const getEligibilityRules = async (reseller_or_employer, form_data) => {
  var rules = [];
  try {
    console.log('[getEligibilityRules] eligibility rules:', reseller_or_employer.eligibility_rules);

    rules = JSON.parse(reseller_or_employer.eligibility_rules);
    if (form_data && Object.keys(form_data).length > 0) {
      rules = chooseRulesSet(form_data, rules)
    }
  } catch (e) {
    console.error('Error Parsing JSON eligibility_rules', e);
  }
  return Promise.resolve(rules);
}

const checkEligibility = async (employers, form_data, reseller) => {
  console.log('[checkEligibility]', employers, form_data, reseller);
  var employer, reseller_rules = [];
  if (reseller) {
    reseller_rules = await getEligibilityRules(reseller, form_data);
  }

  console.log('searchEligiblityMatches clean form_data', JSON.stringify(form_data));

  let results = await searchEligiblityMatches(employers, form_data, reseller_rules);
  console.log('searchEligiblityMatches results', JSON.stringify(results));
  if (!results || !results[0] || !results[0].employer_id) {
    if (shouldAutoCreateEligibility(reseller_rules)) {
      configurations = (reseller.configurations ? JSON.parse(reseller.configurations) : '');
      console.log('normalizing -> ', form_data);
      let normalized = objectMapper(form_data, shopEligibility);
      if (configurations && configurations.autoAssignPCP) {
        normalized.pcp_id = configurations.autoAssignPCP
      }
      console.log('normalized rec -> ', normalized);
      let createResult = await createNewEligibilityRecord(normalized, employers[0], DUMMY_FILE_HIST_ID);
      console.log('createNewEligibilityRecord createResult ', JSON.stringify(createResult));
      let [newEligibility] = await db.getEligibilityById(createResult.insertId);
      results = newEligibility;
      console.log('createNewEligibilityRecord results ', JSON.stringify(results));
    }
    else {
      return [];
    }
  }

  let eligibilityRec = results[0];

  if (employers.length === 1) {
    employer = employers[0];
  }
  else if (employers.length > 1) {
    let [employers_list] = await db.getEmployerByID(eligibilityRec.employer_id);
    if (!employers_list || !employers_list[0]) {
      console.log('getEligibilityByFields empty employer list', eligibilityRec.employer_id);
      return results;
    }
    employer = employers_list[0];
  }
  const rules = await getEligibilityRules(employer, form_data);
  if (rules.validationFields) {
    form_data = Object.keys(form_data).filter(val => form_data[val]).reduce((obj, key) => {
      obj[key] = form_data[key]
      return obj
    }, {});

    console.log('searchEligiblityMatches clean form_data', JSON.stringify(form_data));
    const validation_result = validateEligibilityFields(form_data, rules.validationFields);

    if (!validation_result) {
      console.log(`checkEligibility - Missing parameter "${JSON.stringify(form_data)}"`);
      for (key in rules.validationFields) {
        let field_name = rules.validationFields[key];
        if (Array.isArray(field_name)) {
          if (!field_name.some(e => form_data[e])) {
            console.log(`checkEligibility - Missing parameter in OR condition "${JSON.stringify(form_data)}"`);
            return results;
          }
        }
        else if (!form_data[field_name.split(/[|@+]/)[0]]) {
          let error = `Missing parameters "${JSON.stringify(form_data)}"`;
          console.log('checkEligibility', error);
          return results;
        }
      }
    }

    if (results[0]) {
      results[0] = await reenrollEligibility(results[0], rules)
      if (rules.productTypes && rules.productTypes.length > 0) {
        results[0] = await addProductEigibilityInfo(rules.productTypes, results[0]);
      }
      if (reseller) {
        results[0] = await addSupportPhoneAndEmail(results[0], reseller);
      }
      if (employer && employer.external_id) {
        results[0].employer_id = employer.external_id;
        results[0].employer_name = employer.name;
      }

      let isMinor = utils.isMinorAge(rules, results[0].dob)
      console.log('is minor-check eligibility', isMinor)
      if (isMinor && results[0].reseller_employee_id) {
        let [parent] = await db.getEligibilityByResellerRoleEmpId(results[0].reseller_employee_id, employer.id, constants.EligibilityRole.EMPLOYEE)
        console.log('parent response for minor', parent)
        if (parent[0]) {
          results[0].parent = parent[0]
        }
        if (parent.length > 1) {
          console.log(`finding ${parent.length} records for the same reseller_employee_id and role equal to EE. (reseller_employee_id: ${results[0].reseller_employee_id})`);
        }
      }
    }
  }

  //successful eligibility check
  if (eligibilityRec && !!eligibilityRec.email && !!form_data.email && eligibilityRec.email.toLowerCase() !== form_data.email.toLowerCase()) {
    console.log(`Eligibility check success using new email address ${eligibilityRec.email} -> ${form_data.email}`);
    const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);
    await braze.updateAttributes( brazeUnifiedFlag ? eligibilityRec.eid:  form_data.email, {
      email: form_data.email,
      b2b_eid: eligibilityRec.eid,
      b2b_employer: employer.name,
      b2b_employer_id: employer.external_id,
      b2b_eligibility_status: eligibilityRec.status,
      b2b_eligibility_stage: eligibilityRec.stage
    });
  }
  console.log('[checkEligibility] results', JSON.stringify(results));
  return Promise.resolve([results]);
}

async function reenrollEligibility(eligibilityRecord, eligibilityRules) {
  console.log("[reenrollEligibility]", eligibilityRecord, eligibilityRules);
  const { EligibilityStatus, EligibilityStage, EligibilityLogAction, Behaviors, RedeemedProductStatus } = constants;
  let { behaviors, behaviorsParams } = eligibilityRules;
  
  if (typeof behaviors == "object"
    && !Array.isArray(behaviors)
    && eligibilityRecord.record_source
    && behaviors[eligibilityRecord.record_source])
  {
    console.log("behaviors", behaviors[eligibilityRecord.record_source]);
    behaviors = behaviors[eligibilityRecord.record_source];
  }

  const hasReenrollmentBehavoir = behaviors && behaviors.some(b => b === Behaviors.REENROLLMENT);
  eligibilityRecord.isManualReEnrollment = false;
  if (!hasReenrollmentBehavoir) {
    console.log('[reenrollEligibility] hasReenrollmentBehavoir =', hasReenrollmentBehavoir);
    return eligibilityRecord;
  };

  const { status, stage, id, eid, employer_id } = eligibilityRecord;
  let { disenrolled_at } = eligibilityRecord;
  const [reenrolledRedeemedProducts] = await db.getRedeemedProductsList(id)
  console.log('[reenrollEligibility] eligibilityRecord =', JSON.stringify(eligibilityRecord));
  const isEligible = (status === EligibilityStatus.ELIGIBLE && stage === EligibilityStage.NEW && reenrolledRedeemedProducts.length>0)
  if (!isEligible ) {
    console.log('[reenrollEligibility] eligible new with redeemed products');
    return eligibilityRecord;
  };
  
  eligibilityRecord.isManualReEnrollment = true;

  if(!disenrolled_at){
    let records = await db.getEligibilityHistory(eligibilityRecord, employer_id , 1)
    if(records && records.length>0 && records[0].length>0){
        console.log(`records in checkandreenroll ${JSON.stringify(records[0])}`)
        disenrolled_at = records[0][0].created_at;
    }
  }
  
  const currentDate = new Date();
  const disenrolledDate = new Date(disenrolled_at);
  const diffDays = getDiffDays(currentDate, disenrolledDate);
  const { manualPeriod } = behaviorsParams.reenrollment;
  console.log('reenrollEligibility:', { diffDays, manualPeriod });
  const canBeReenerolled = (diffDays > manualPeriod);
  if (!canBeReenerolled) {
    eligibilityRecord.isManualEnrollmentDatePassed = false
    console.log('[reenrollEligibility] canBeReenerolled =', canBeReenerolled);
  }else{
    eligibilityRecord.isManualEnrollmentDatePassed = true
    console.log('[reenrollEligibility] canBeReenerolled =', canBeReenerolled);
  }
  return eligibilityRecord;
  // not performing reenrollment 
  console.log('[reenrollEligibility] start'); 
  // only updating redeemed products as status and stage alreadu eligible and new
  // const reenrollResult = await Promise.all([
  //   db.updateEligibilityStatusTrx(EligibilityStatus.ELIGIBLE, EligibilityStage.NEW, DUMMY_FILE_HIST_ID, id),
  //   db.addEligibilityLog(id, EligibilityLogAction.UPDATE, 'reenroll eligibility'),
  //   db.updateRedeemedProductsStatus(RedeemedProductStatus.REENROLLED, id)
  // ])
  //   const reenrollResult = await db.updateRedeemedProductsStatus(RedeemedProductStatus.REENROLLED, id)
  // console.log('[reenrollEligibility] finish. Reenrollment result =', reenrollResult);

  // //add redeemed products history
  // reenrolledRedeemedProducts.forEach(reenrolledRedeemedProduct => {
  //   //don't await to add history
  //   db.addRedeemedProductHistory(reenrolledRedeemedProduct)
  //     .catch(error => console.log('addRedeemedProductHistory error for product:', { error, reenrolledRedeemedProduct }))
  // })
  // //------------------------------

  // const [[reenrolledEligibilityRecord]] = await db.getEligibility(employer_id, eid);
  // reenrolledEligibilityRecord.isManualReEnrollment = eligibilityRecord.isManualReEnrollment;
  // reenrolledEligibilityRecord.isManualEnrollmentDatePassed = eligibilityRecord.isManualEnrollmentDatePassed;
  // console.log('[reenrollEligibility] reenrolledEligibilityRecord:', reenrolledEligibilityRecord);
  // return reenrolledEligibilityRecord
};

function getDiffDays(date1, date2) {
  const msInOneDay = 1000 * 60 * 60 * 24
  const diffMs = date1 - date2
  return diffMs / msInOneDay
}

function validateEligibilityFields(form_data, validation_fields) {
  for (const field_group of validation_fields) {
    if (Array.isArray(field_group)) {
      if (field_group.every(field => Object.keys(form_data).includes(field) && form_data[field])) {
        return true;
      }
    }
  }
  return false;
}

function shouldAutoCreateEligibility(reseller_rules) {
  return Array.isArray(reseller_rules.behaviors) && reseller_rules.behaviors.some(b => b === constants.Behaviors.AUTO_CREATE);
}

async function createNewEligibilityRecord(eligRec, employer, fileHistoryID) {
  console.log(`adding eligibility of ${eligRec.reseller_employee_id}-${eligRec.role}`);
  let b2bTargeting = employer.eligibility_rules.targeting ? employer.eligibility_rules.targeting.default === true : false;
  eligRec.targeting = b2bTargeting;
  eligRec.eid = uuid.v4();

  let eligibility = await createNewEligibilityAsync(eligRec, employer, fileHistoryID);
  console.log('new eligibility record:', eligibility);
  return eligibility;
}

function generateFilterField(form_data, field) {
  if (field.includes('|')) { //partial compare - initial x characters
    let fieldQ = field.split('|');
    let field_name = fieldQ[0];
    let numComp = fieldQ[1];

    if (!(field_name in form_data)) return null;
    let fieldVal = form_data[field_name];
    cmpStr = fieldVal.substring(0, numComp);
    return [`${field_name} like LCASE(?)`, `${cmpStr.toLowerCase()}%`];
  }
  else if (field.includes('@')) { //REGEXP compare - ignore trailing spaces etc...
    let field_name = field.split('@')[0];
    if (!(field_name in form_data)) return null;
    let fieldVal = form_data[field_name];
    return [`${field_name} REGEXP ?`, `^[[:space:]]*${fieldVal.toLowerCase()}[[:space:]]*$`];
  }
  else if (field.includes('+')) { //numeric compare - ignore trailing zeroes
    let field_name = field.split('+')[0];
    if (!(field_name in form_data)) return null;
    let fieldVal = form_data[field_name];
    return [`${field_name} = ?`, +fieldVal];
  }

  if (!(field in form_data)) return null;
  let fieldVal = form_data[field];

  if (Array.isArray(fieldVal)) {
    return [`${field} in (?)`, fieldVal];
  }
  else {
    return [`${field} = LCASE(?)`, fieldVal.toLowerCase()];
  }
}

async function searchEligiblityMatches(employers, form_data, reseller_rules) {
  console.log('searchEligiblityMatches validationFields', JSON.stringify(reseller_rules.validationFields))
  // Do we need to flat it
  if (reseller_rules.validationFields.length === 1) {
    reseller_rules.validationFields = reseller_rules.validationFields.flat()
    console.log('searchEligiblityMatches validationFields flat', JSON.stringify(reseller_rules.validationFields))
  }
  const rules_count_min = reseller_rules.validationFields.length;
  const rules_count_max = reseller_rules.validationFields.flat().length;

  form_data = Object.keys(form_data).filter(val => form_data[val]).reduce((obj, key) => {
    obj[key] = form_data[key]
    return obj
  }, {});

  let formFields = Object.keys(form_data);
  const countOfArrays = reseller_rules.validationFields.filter(val => Array.isArray(val))

  let q_and_operands = reseller_rules.validationFields.reduce((out, vf) => {
    if (Array.isArray(vf)) {
      let orpart = vf.map(of => generateFilterField(form_data, of));
      const ifArrExists = orpart.find(val => Array.isArray(val))
      orpart = ifArrExists && orpart.reduce((arr, p) => {
        if (p) {
          arr[0].push(p[0]);
          arr[1].push(p[1]);
        }
        if (arr.length) {
          return arr;
        }
        return;
      }, [[], []]);
      if (orpart) {
        const condition = countOfArrays.length > 1 ? " AND " : " OR ";
        out[0].push(`(${orpart[0].join(condition)})`);
        out[1] = out[1].concat(orpart[1]);
      }
    } else {
      let f_field = formFields.find(ff => ff === vf.split(/[|@+]/)[0]);
      if (f_field) {
        let [q, v] = generateFilterField(form_data, vf);
        out[0].push(q);
        out[1].push(v);
      }
    }
    return out;
  }, [[], []]);

  let where = countOfArrays.length > 1 ? q_and_operands[0].join(" OR ") : q_and_operands[0].join(" AND ");
  let fields = q_and_operands[1];
  console.log("searchEligiblityMatches - where", where, "fields", fields, 'q_and_operands', q_and_operands);

  if (fields.length < rules_count_min || fields.length > rules_count_max) {
    let error = `Missing parameters "${JSON.stringify(form_data)} Validation fields: ${JSON.stringify(reseller_rules.validationFields)}"`;
    console.error('getEligibilityFromData', error);
    return [];
  }
  if (where === '') {
    console.error(`data missing match fields from rules`, form_data);
    return [];
  }
  if (employers.length == 1) {
    where += ` AND employer_id = ?`;
    fields.push(employers[0].id);
  }
  else if (employers.length > 1) {
    where += ` AND employer_id IN (?)`;
    let ids = [];
    for (key in employers) {
      ids.push(employers[key].id);
    }
    fields.push(ids);
  }
  console.log("Query where: ", where);
  console.log("Query fields: ", fields);

  let [records] = await db.getEligibilityByFields(where, fields);
  let form_json = JSON.stringify(form_data);
  let emp_id = employers[0].id;

  console.log({ activity: 'searchEligiblityForm', form_data, result: records });

  if (!records || !records.length) {
    // Eligibility no records found
    console.log({ activity: 'searchEligiblityMatches', status: 'no match', form_data, query: where, fields: fields, result: records });
    let [result] = await db.addEligibilityCheckFailedLog(emp_id, form_json, 'No records found');
    console.log('eligibility check failed log added', result);
  } else if (records.length === 1) {
    return records;
  };

  //------- records.length > 1 -------

  //split records for eligible and ineligible
  const { eligibleRecords, ineligibleRecords } = records.reduce((acc, record) => {
    record.status === 'ineligible'
      ? acc.ineligibleRecords.push(record)
      : acc.eligibleRecords.push(record);
    return acc;
  }, { eligibleRecords: [], ineligibleRecords: [] });

  //if we have one or more eligible/enrolled records, return first one
  //if we don't have any eligible records, return first ineligible
  const matchedRecord = eligibleRecords.length ? eligibleRecords[0] : ineligibleRecords[0];
  return [matchedRecord];
};

const addProductEigibilityInfo = async (eligibileProductTypes, eligibility) => {
  const [redeemedProducts] = await db.getRedeemedProductsList(eligibility.id);
  console.log('[addProductEigibilityInfo] redeemed product list: ', redeemedProducts);
  const eligible_products = {};
  eligibileProductTypes.forEach(productType => (eligible_products[productType] = true));
  redeemedProducts.length && redeemedProducts.forEach(redeemedProduct => {
    if (
      (eligibility.stage !== constants.EligibilityStage.NEW && redeemedProduct.status == constants.RedeemedProductStatus.REENROLLED) || // added condition for auto re-enrollment, as for manual, stage will be new
      redeemedProduct.status !== constants.RedeemedProductStatus.REENROLLED) {
      eligible_products[redeemedProduct.product_type] = false;
    };
  });
  eligibility.eligible_products = eligible_products
  return Promise.resolve(eligibility);
};

const addSupportPhoneAndEmail = async (eligibility, reseller_or_employer) => {
  eligibility["support_email"] = "";
  eligibility["support_phone"] = "";

  if (reseller_or_employer.support_email) {
    eligibility.support_email = reseller_or_employer.support_email;
  }
  if (reseller_or_employer.support_phone) {
    eligibility.support_phone = reseller_or_employer.support_phone;
  }

  return Promise.resolve(eligibility);
};
/**
  * A Lambda function that receive Requests from Eligibility API GW.
  */
exports.handleAPIRequest = async (event, context) => {
  console.log('[handleAPIRequest] event ', event);
  const employer_id = event.pathParameters.employer_id;
  const reseller_id = event.pathParameters.reseller_id;
  const eligibility_id = event.pathParameters.eligibility_id;
  const operation = event.requestContext.operationName;
  const data = JSON.parse(event.body);

  if (!employer_id && !reseller_id) {
    return response({}, new Error('Missing parameters'));
  }

  var employers, reseller;
  if (employer_id) {
    [employers] = await db.getEmployer(employer_id);
    [reseller] = await db.getReseller(employers[0].reseller_id);
  }
  else {
    [reseller] = await db.getResellerByExternalID(reseller_id);
    if (reseller[0] && reseller[0].id) {
      [employers] = await db.getActiveEmployersByResellerId(reseller[0].id);
    }
  }

  if (!employers) {
    return response({}, new Error('Missing parameters'));
  }

  console.log("operation", operation);
  console.log("reseller", reseller);
  console.log("employers", employers);
  console.log("eligibility_id", eligibility_id);
  console.log("data", data);

  var results = [], error;

  switch (operation) {
    case 'getEligibility':
      if (eligibility_id) {
        results = await getEligibility(employers[0], eligibility_id);
      }
      break;

    case 'checkEligibility':
      try {
        [results] = await checkEligibility(employers, data, reseller[0]);
      } catch (err) {
        console.log("checkEligibility Error: ", err);
        error = err;
      }
      break;

    case 'updateEligibility':
      if (eligibility_id) {
        results = await getEligibility(employers[0], eligibility_id, true);
        console.log('[updateEligibility] --> get eligibility result', results);
      }
      if (data && results[0]) {
        try {
          employers[0].reseller_name = reseller[0].name;
          await updateEligibility(data, results[0], employers[0]); // elig + log + SF + Braze
          results = await getEligibility(employers[0], eligibility_id);
          console.log('[updateEligibility] --> 2nd get eligibility result', results);
          if (results && results[0] && data.orders && data.orders.length > 0) {
            let status_res = await updateEligibilityStatusToEnrolled(results[0], employers[0], data); // elig status -> enrolled, elig log, SF
            console.log('[updateEligibility] --> updateEligibilityStatusToEnrolled result', status_res);
            await db.addEligibilityFlowLogTrx(results[0].id, 2020, `enrolled eligibility - ${JSON.stringify(data)}`);
            console.log('[updateEligibility] --> eligiblity flow updated');
            let postSMResult = await states.executePostEnrollmentStateMachine(results[0], employers[0]);
            console.log('[updateEligibility] --> post enrollment state machine executoion', postSMResult);
          }
          // Cancelled
          if (results && results[0] && results[0].shop_email && data.stage == 'canceled') {
            await darioUser.DisableDarioUserMembership(results[0]);
          }
        }
        catch (err) {
          console.log("[updateEligibility] Error", err);
          error = err;
        }
      }
      break;

    default:
      error = new Error(`Unsupported method "${operation}"`);
  }
  // console.log(results);
  if (!results) {
    var results = [{}];
  }

  if (!results[0]) {
    results[0] = {};
  }

  if (!results[0].support_email || !results[0].support_phone) {
    let empOrReseller = employers[0] ? employers[0] : reseller[0];
    results[0] = await addSupportPhoneAndEmail(results[0], empOrReseller);
    console.log('Missing results:', results[0], 'empOrReseller:', empOrReseller)
  }

  let formatted = await formatEligibilityInfo(results[0]);
  console.log('formatted', formatted, error);
  return response([formatted], error);
};

exports.AssignUserToClinic = async (event, context) => {
  console.log('Dario Provisioning StepFunction Event', event);
  try {
    let dario_response = await dario.assignToClinic(event.target.clinic_auth, event.email);
    console.log('Dario Provisioning Response', dario_response.body);
    return dario_response.body;
  }
  catch (err) {
    if (err.response.statusCode === 409 && err.response.body.error) {
      console.log('Dario Provisioning Error - Already Exist -> REMOVING', err.response.statusCode, err.response.body);
      let dario_delete_response = await dario.removeFromClinic(event.target.clinic_auth, err.response.body.data.id);
      console.log('Dario Provisioning Delete Response', dario_delete_response);
      console.log('Dario Provisioning Error - Already Exist -> REASSIGN');
      let dario_reassign_response = await dario.assignToClinic(event.target.clinic_auth, event.email);
      console.log('Dario Provisioning ReAssign Response', dario_reassign_response.body);
      return dario_reassign_response.body;
    } else {
      console.log('ERROR in Dario Provisioning.', err.response.statusCode, err.response.body);
      throw err.response.body ? JSON.stringify(err.response.body) : err;
    }
  }
}

exports.updateEligibilityV2 = async (event, context) => {
  console.log('[updateEligibilityV2] --> event', event)
  if (!event.shopData) {
    return response({ status: 'error' }, new Error('Missing shopData'));
  }

  let shopData = event.shopData.status ? event.shopData : JSON.parse(event.shopData);

  if (!shopData || !shopData.result.employer_id && !shopData.result.eligibility_id) {
    return response({ status: 'error' }, new Error('Missing parameters'));
  }
  let data = shopData.result;
  const employer_id = data.employer_id;
  const eligibility_id = data.eligibility_id;
  let [employers] = await db.getEmployer(employer_id);
  let [reseller] = await db.getReseller(employers[0].reseller_id);
  let results = await getEligibility(employers[0], eligibility_id, true);

  console.log('[updateEligibilityV2] --> getEligibility', results);

  if (data && results[0]) {
    try {
      employers[0].reseller_name = reseller[0].name;
      await updateEligibility(data, results[0], employers[0], true); // elig + log
      results = await getEligibility(employers[0], eligibility_id);
      console.log('[updateEligibilityV2] --> 2nd get eligibility result', results);
      if (results && results[0] && data.orders && data.orders.length > 0) {
        let status_res = await updateEligibilityStatusToEnrolled(results[0], employers[0], data, true); //  elig status -> enrolled, elig log
        console.log('[updateEligibilityV2] --> updateEligibilityStatusToEnrolled result', status_res);
        await db.addEligibilityFlowLogTrx(results[0].id, 2020, `enrolled eligibility - ${JSON.stringify(data)}`);
        console.log('[updateEligibilityV2] --> eligiblity flow updated');
        let postSMResult = await states.executePostEnrollmentStateMachine(results[0], employers[0]);
        console.log('[updateEligibilityV2] --> post enrollment state machine executoion', postSMResult);
      }
      // Cancelled
      if (results && results[0] && results[0].shop_email && data.stage == 'canceled') {
        await darioUser.DisableDarioUserMembership(results[0]);
      }
      return results[0];
    }
    catch (err) {
      console.log("[updateEligibilityV2] Error", err);
      return response({ status: 'error' }, new Error('[updateEligibilityV2] Error', err));
    }
  } else {
    console.log("[updateEligibilityV2 Error] -> Missing shop data or eligibility data", event)
    return response({ status: 'error' }, new Error('[updateEligibilityV2] Error'));
  }
}

exports.updateBackEndOverrides = async (event, context) => {
  try {
    console.log('[updateBackEndOverrides]', event)

    if (!event.Payload || !event.eligibleData) {
      return response({ status: 'error' }, new Error('[updateBackEndOverrides- Error] Missing require data'));
    }

    let pndOrderPayload = JSON.parse(Buffer.from(event.Payload, 'base64'));

    if (!event.eligibleData || !pndOrderPayload) {
      return response({ status: 'error' }, new Error('[updateBackEndOverrides- Error] Missing eligibility or Payload data'));
    }

    let empSet = typeof pndOrderPayload.emp_set === 'object' ? pndOrderPayload.emp_set : JSON.parse(pndOrderPayload.emp_set)
    let userData = typeof pndOrderPayload.user_data === 'object' ? pndOrderPayload.user_data : JSON.parse(pndOrderPayload.user_data)
    let apiData = typeof pndOrderPayload.api_data === 'object' ? pndOrderPayload.api_data : JSON.parse(pndOrderPayload.api_data)[0]
    console.log('eligibility_update_plan', empSet.eligibility_update_plan, empSet.eligibility_update_plan === '1', userData.phone, userData)

    if (empSet) {
      let phone = !apiData.parent ? userData.phone : (userData.phone != apiData.parent.shop_phone ? userData.phone : '')
      if (apiData.parent) {
        console.log('parent phone : ', apiData.parent.shop_phone)
        console.log('phone', phone)
      }

      let body = {
        users: [event.eligibleData.email],
        membership_plan: empSet.eligibility_plan,
        phone_number: phone,
        eligibility_id: event.eligibleData.eid,
        employer_id: event.eligibleData.employer_id,
        overrides: darioUser.overridesEligilbleProducts(event.eligibleData.eligible_products)
      }

      let darioRes = await dario.DarioUserMembership(body)
      darioRes = darioRes.body ? darioRes.body : darioRes
      console.log('[UpdateBackEndOverrides Res]', JSON.stringify(darioRes))
      return darioRes
    }
  } catch (err) {
    return response({ status: 'error' }, new Error('[updateBackEndOverrides- Error]', err));
  }
}

exports.CreateOrderEvents = async (event, context) => {
  try {
    console.log('[CreateOrderEvents]', event);

    if (!event.Payload || !event.employer_id) {
      return response({ status: 'error' }, new Error('[CreateOrderEvents- Error] Missing require data'));
    }

    let pndOrderPayload = JSON.parse(Buffer.from(event.Payload, 'base64'));

    if (!pndOrderPayload || !pndOrderPayload.user_data || !pndOrderPayload.api_data) {
      console.log("[CreateOrderEvents]: Missing Payload data");
      return response({ status: 'error' }, new Error('[CreateOrderEvents - Error] Missing Payload data'));
    }
    let userData = JSON.parse(pndOrderPayload.user_data) ? JSON.parse(pndOrderPayload.user_data) : pndOrderPayload.user_data
    let apiData = JSON.parse(pndOrderPayload.api_data) ? JSON.parse(pndOrderPayload.api_data)[0] : pndOrderPayload.api_data

    console.log(`userData ${JSON.stringify(userData)}, apiData ${JSON.stringify(apiData)}`)

    let obj = {
      pathParameters: {
        employer_id: event.employer_id,
        eligibility_id: apiData.eid,
        flow_id: ''
      },
      body: { notes: '' }
    }

    const tidFlowId = {
      'eml.enrollment_1': {
        id: '2010',
        note: `User ${apiData.eid} used HR email`
      },
      'eml.enrollment_4': {
        id: '2015',
        note: `User ${apiData.eid} used HR email`
      },
      'srt.enrollment_1': {
        id: '2130',
        note: `User ${apiData.eid} registered using shortlink`
      },
      'facebook.b2b2c.retargeting': {
        id: '2131',
        note: `User ${apiData.eid} registered using facebook retargeting`
      }
    }

    if (userData.tid && tidFlowId[userData.tid]) {
      obj.body.notes = tidFlowId[userData.tid].note
      obj.pathParameters.flow_id = tidFlowId[userData.tid].id
      let tidFlowRes = await flowEvents.handleAPIRequest(obj)
      console.log(`[CreateOrderEvents]--> tidFlowRes obj: : ${JSON.stringify(obj)}, tidFlowRes: ${JSON.stringify(tidFlowRes)} `)
    }

    const touchId = {
      1: { eventId: 2030 },
      2: { eventId: 2040 },
      3: { eventId: 2050 },
      4: { eventId: 2052 },
      5: { eventId: 2054 }
    }

    if (userData.touch && touchId[userData.touch]) {
      obj.body.notes = `User ${apiData.eid} completed enrollment in touch no. ${userData.touch}`
      obj.pathParameters.flow_id = userData.touch.eventId
      let touchFlowRes = await flowEvents.handleAPIRequest(obj)
      console.log(`[CreateOrderEvents] -->touchFlowRes, obj ${obj}, touchFlowRes: ${JSON.stringify(touchFlowRes)}`)
    }

    if (userData.origin) {
      obj.body.notes = `User ${apiData.eid} enrolled with origin ${userData.origin}`
      obj.pathParameters.flow_id = 2140
      let originFlowRes = await flowEvents.handleAPIRequest(obj)
      console.log(`[CreateOrderEvents]-->originFlowRes, obj ${JSON.stringify(obj)}, originFlowRes: ${JSON.stringify(originFlowRes)} `)
    }
    return response({ status: 'success' }, 'Finish to execute createOrderEvents function');
  } catch (err) {
    console.log("[CreateOrderEvents] Error occurred while creating order events", err);
    return response({ status: 'error' }, new Error('[CreateOrderEvents - Error] Missing Payload data', err));
  }
}

exports.ExternalServicesStep = async (event, context) => {
  try {
    console.log('[ExternalServicesStep]', event);
    console.log('process.env-sqs', process.env.SQS_EXTERNAL_QUEUE_URL)

    if (!event.shopData || !event.eligibleData) {
      return response({ status: 'error' }, new Error('[ExternalServicesStep- Error] - Missing require data'));
    }

    let data = event.shopData.result;
    let [employers] = await db.getEmployer(data.employer_id);
    let results = await getEligibility(employers[0], event.eligibleData.eid, true);
    console.log('[ExternalServicesStep] -> getEligibility', results)

    if (!results || !results[0] || results[0].length < 1) {
      return response({ status: 'error' }, new Error('[ExternalServicesStep- Error] - Missing require data'));
    }

    let currentEligibility = results[0]
    let employer = employers[0]
    employer.eligibility_rules = JSON.parse(employer.eligibility_rules);
    console.log('before sending message to queue')
    let employer_id = currentEligibility.employer_id
    return queue.sendMessage({ employer_id, currentEligibility, employer, data }, constants.EligibilityWorkerAction.EXTERNAL_SERVICES, process.env.SQS_EXTERNAL_QUEUE_URL)

  } catch (err) {
    return response({ status: 'error' }, new Error('[ExternalServicesStep - Error] Missing Payload data', err));
  }
}

exports.getEmployerRules = async (event, context) => {
  let err = false;
  let err_msg;
  let eligibility_rules = {};
  try {
    const { employer_id } = event.pathParameters

    // const [employerList] = await db.getEmployerByName(employer_id)
    const employerPromise = utils.isNumber(employer_id) ? db.getEmployerListByExternalID(employer_id) :  db.getEmployerByName(employer_id)
    const [employerList] = await employerPromise
    if (!employerList || !employerList[0]) {
      throw Error(`no employer found`)
    }
    const employer = employerList[0]

    eligibility_rules = employer && JSON.parse(employer.eligibility_rules);
    eligibility_rules.isAccountTerminated = employer && employer.status === "active" ? false : true;
    eligibility_rules.accountName  = employer.name.replace('_',' ')
    console.log('[getEmployerRules] eligibility_rules',eligibility_rules);
  } catch (error) {
    err = true
    console.log('getEmployerRules error:', error);
    err_msg = error.message
  }
  return {
    statusCode: err ? '400' : '200',
    body: err ? JSON.stringify({ success: false, error: err_msg }) : JSON.stringify(eligibility_rules),
    headers: {
      'Content-Type': 'application/json',
    },
  }
}

exports.generateEid = async (event) => {
  console.log('typeof event in generateEid:', typeof event)
  console.log('event in generateEid:', event)
  if (event.resource && event.resource === '/utils/generate-eid') {
    try {
      let data = JSON.parse(event.body)
      data['eid'] = uuid.v4()
      return response(data, false)
    }
    catch (err) {
      return response({}, new Error(`ERROR in single record EID generation: ${err}.`));
    }
  } else {
    try {
      const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
      if (srcKey.includes('_Output')) {
        return response({}, new Error('The file has already been processed. Cancel processing.'));
      }
      const params = {
        Bucket: event.Records[0].s3.bucket.name,
        Key: srcKey
      };
      let instream
      try {
        instream = await s3.getObject(params).createReadStream()
      } catch (err) {
        return response({}, new Error(`ERROR in S3 getObject: ${err}.`));
      }
      let records
      try {
        records = await s3CsvHandler.parseCSV(instream)
      } catch (err) {
        return response({}, new Error(`ERROR in parsing CSV file: ${err}.`));
      }
      let csv
      try {
        csv = await s3CsvHandler.convertArrayOfObjectsToCSV(records);
      } catch (err) {
        return response({}, new Error(`'ERROR in parsing back the CSV file: ${err}.`));
      }
      const fileName = srcKey.replace('.csv', '_Output.csv')
      let res
      try {
        res = await s3CsvHandler.uploadFileToS3(fileName, event.Records[0].s3.bucket.name, '', csv)
        console.log('res:', res)
        return response(res.Location, false)
      } catch (err) {
        return response({}, new Error(`'ERROR in uploadFileToS3: ${err}.`));
      }
    } catch (err) {
      return response({}, new Error(`'ERROR in generateEid handling: ${err}.`));
    }
  }
}

/////// FOR UT ////////
exports.addProductEigibilityInfo = addProductEigibilityInfo;
exports.reenrollEligibility = reenrollEligibility;
exports.generateUpdateRecord = generateUpdateRecord;
exports.generateFilterField = generateFilterField;
exports.getEligibilityFromData = searchEligiblityMatches;
exports.updateEligibilityRecord = updateEligibilityRecord;
exports.updateEligibilityStatusToEnrolled = updateEligibilityStatusToEnrolled;
exports.checkEligibility = checkEligibility;
exports.getEligibility = getEligibility
exports.AssignUserToClinicV2 = AssignUserToClinicV2;
exports.chooseRulesSet = chooseRulesSet
exports.externalServices = externalServices
