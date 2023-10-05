const db = require('../services/rds-data-service');
const dario = require('../services/dario-service.js');
const utils = require('../common/utils');
const emailSrv = require('../services/email-service');
const constants = require("../common/constants");
const gwHandler = require('../handlers/api-gw-handler')
const brazeSrv = require('../services/braze-service')
const sfSrv = require('../services/salesforce-service')
const queue = require('../services/sqs-service');

const CHUNK_SIZE = 10;
const DUMMY_FILE_HIST_ID = 1;
const TEST_EMAIL_REGEX = '^testqa';

const secrets = require('../services/secrets-service');
const unifiedSecretName= `${process.env.STAGE}-unified-flag`

exports.CreateDarioUserForMinor = async (event, context) => {
    console.log('CreateDarioUserForMinor', event)

    let eligibility = event.eligibility
    let shopData = event.shopdata
    let appEmail = null
    let [parent] = await db.getEligibilityByResellerRoleEmpId(eligibility.reseller_employee_id, eligibility.employer_id , constants.EligibilityRole.EMPLOYEE)

    console.log('CreateDarioUserForMinor - parent', parent)

    if(parent.length == 0 || parent[0] && !parent[0].id){
      console.log('Missing parent', parent)
    }

    appEmail = (parent[0] && parent[0].id && parent[0].app_email) ? parent[0].app_email : null;

    if(appEmail){
        eligibility.shop_email = eligibility.email
        eligibility.shop_phone = eligibility.shop_phone != parent[0].shop_phone
        ? eligibility.shop_phone
        : (eligibility.phone != parent[0].shop_phone ? eligibility.phone : null);

        let res = await createDarioUserInternal(eligibility, shopData, true, appEmail)

        await minorAttForParentBraze(appEmail, eligibility, event.rules);
        return res;
    }  else if(parent[0] && parent[0].id){
        // when generating parent user, phone and email should be taken from enrollment form
        parent[0].shop_phone = shopData.phone ? shopData.phone : parent[0].phone
        parent[0].shop_email = shopData.parent_email ? shopData.parent_email : parent[0].email
        await createDarioUserInternal(parent[0], shopData, false)

        // relative user
        eligibility.shop_email = eligibility.email
        eligibility.shop_phone = eligibility.phone != parent[0].shop_phone ? eligibility.phone : null
        eligibility.phone = eligibility.shop_phone
        let res = await createDarioUserInternal(eligibility, shopData, true, parent[0].shop_email)

        await minorAttForParentBraze(parent[0].shop_email, eligibility, event.rules);
        return res;
    }

}

exports.CreateDarioUser = async (event, context) => {
    console.log('CreateDarioUser- eligibility', event)
    return await createDarioUserInternal(event.eligibility, event.shopdata , false)
}

async function minorAttForParentBraze(email, eligibility, rules){
  console.log('minorAttForParentBraze', email, eligibility, rules)

  let minorAge = rules ? rules.targeting.minor_age : 0
  console.log('minorAge', minorAge)

  const { brazeUnifiedFlag } = await secrets.getSecret(unifiedSecretName);

  if(minorAge){
    let [enrolledMinors] = await db.getEnrolledMinorsByReseller(eligibility.reseller_employee_id, eligibility.employer_id , constants.EligibilityRole.EMPLOYEE, minorAge)
    console.log('enrolledMinors', enrolledMinors)
    await brazeSrv.sendUserEvent( brazeUnifiedFlag ?  eligibility.eid: email, constants.Braze.MINOR_ENROLLED, {}, {child_enrolled: enrolledMinors.length}, eligibility.employer_id)

    let emails = enrolledMinors.map(record => record.email)
    let externalIds = await brazeSrv.generateExternalIds(emails)
    console.log('braze event- MINOR_B2B',emails, externalIds)
    let eventName = constants.Braze.MINOR_B2B
    await brazeSrv.sendUserEvent(brazeUnifiedFlag ?  eligibility.eid: email, eventName, {}, {[eventName]: JSON.stringify(externalIds)}, eligibility.employer_id)
  } else {
    console.log('Missing definition for minor age in employer rules', rules)
  }
}

async function createDarioUserInternal(eligibility, shopData, isMinor, appEmail) {
  console.log('createDarioUserInternal', eligibility, shopData, isMinor, appEmail)
  console.log("shopData - ", shopData)
  if (!!eligibility.app_email) {
    console.log('Dario user already created...');
    return;
  }
  console.log('Creating Dario user...');
  let email = !!eligibility.shop_email ? eligibility.shop_email : eligibility.email;
  let phone = !!eligibility.shop_phone ? eligibility.shop_phone : eligibility.phone;
  let gender = !!eligibility.gender ? eligibility.gender : eligibility.gender;
  let dob = !!eligibility.dob ? eligibility.dob : eligibility.dob;
  let country = !!shopData.country ? shopData.country : 'US';
  let b2b = !!shopData.b2b ? shopData.b2b : shopData.b2b;
  let actions = !!shopData.actions ? shopData.actions : shopData.actions;
  const isTestUser = recogniseTestUser(eligibility);

  const b2bData = getB2bData(b2b, actions);

  phone = utils.tryParsePhoneNumber(phone);

  try {
    let darioRes = await dario.createDarioUser(
      email,
      eligibility.first_name,
      eligibility.last_name,
      phone,
      'en',
      country,
      eligibility.role,
      isMinor,
      appEmail,
      eligibility.eid,
      eligibility.reseller_employee_id,
      eligibility.employer_id,
      b2bData,
      gender,
      dob,
      isTestUser
    );
    console.log('Daio user created successfully.', darioRes.statusCode, darioRes.body);

    let emailToUpdate = isMinor || !appEmail ? email : appEmail
    await db.updateEligibilityAppUserId(darioRes.body.uid, eligibility.id);
    return await db.updateEligibilityAppEmail(emailToUpdate, eligibility.id);
  }
  catch (err) {
    if (err.response.statusCode === 400 && err.response.body.error && err.response.body.error.code === 10) {
      console.log(`user already exists in Dario - ${err.response.body.error.description}`);
      //user exist make sure to update the eligibility record with it's app email
      if (!!!eligibility.app_email) {
        await db.updateEligibilityAppUserId(darioRes.body.uid, eligibility.id);
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

function recogniseTestUser(userRecord) {
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

function getB2bData(b2b, actions) {
  let b2bData = {};

  if (b2b === null) {
    return b2bData;
  }

  b2bData.weight = b2b.weight;
  b2bData.height = b2b.height;
  b2bData.hba1c = b2b.hba1c;
  b2bData.last_fasting_bg = b2b.fasting;

  if (actions === null) {
    return b2bData;
  }

  const weightUnit = actions.weight;
  const heightUnit = actions.height;

  if (weightUnit === "lb") {
    b2bData.weight = b2bData.weight * 0.454;
  }

  if (heightUnit === "ft") {
    let heightNumbers = b2bData.height.split(' ');
    heightNumbers.forEach((value, index) => {
      heightNumbers[index] = Number(value.replace(/\D/g, ''));
    });
    b2bData.height = heightNumbers[0] * 30.48 + heightNumbers[1] * 2.54;
  }

  b2bData.height = Number(b2bData.height / 100).toFixed(4);

  console.log('createDarioUser.getB2bData b2bData: ', b2bData);

  return b2bData;
}

exports.DarioUserMembership = async (event, context) => {
  console.log('Membership - event', event)
  let eligibility = event.eligibility
  let shopData = event.shopdata
  let rules = event.rules
  let [employers_list] = await db.getEmployerByID(eligibility.employer_id)
  let employer = employers_list[0]

  console.log('employer data', employer)

  if(!rules || !rules.membership){
    console.log('Missing employer membership rules', rules)
    return;
  }

  let external_employer_id = eligibility.external_employer_id;

  let clinic_meta = rules.membership.clinic_meta

  if (clinic_meta.channel == '$external_employer_id' || clinic_meta.sub_channel == '$external_employer_id') {

    let key = 'channel';
    if(clinic_meta.sub_channel == '$external_employer_id'){
      key = 'sub_channel';
    }

    //UFCW 1176 for exmaple - "external_employer_id" not exist in DB so we need to feacth it by employer_id + employee_id + role
    if (!external_employer_id) {
        [external_employer_id] = await db.getExternalEmployerId(eligibility.employer_id,eligibility.employee_id,'EE')
        external_employer_id = external_employer_id[0].external_employer_id
    }

    if (external_employer_id) {
      let [attributes] = await db.getEmployerAttribute(eligibility.employer_id,'virtual_account',external_employer_id)

      console.log('getEmployerFromEmployerAttributes',attributes);
      if (attributes[0].value) {
        clinic_meta[key] = attributes[0].value;
      }
    }
  }

  let body = {}
  let flagsToUpdate = {}
  body.membership_plan = rules.membership.membership_plan
  body.phone_number = shopData.phone
  body.employer_id = employer.external_id
  body.overrides = {
    clinic: rules.membership.clinic,
    clinic_meta: clinic_meta,
    display_name: rules.membership.display_name,
    checkup_call_expert: rules.membership.checkup_call_expert,
    contact_us_email: rules.membership.contact_us_email,
    contact_us_phone: rules.membership.contact_us_phone
  }
  if(rules.membership.activate_grocery_scanner) {
    body.overrides.activate_grocery_scanner = rules.membership.activate_grocery_scanner
    flagsToUpdate.activate_grocery_scanner = rules.membership.activate_grocery_scanner
  }
  if(rules.membership.activate_healthkit_observers) {
    body.overrides.activate_healthkit_observers = rules.membership.activate_healthkit_observers
    flagsToUpdate.activate_healthkit_observers = rules.membership.activate_healthkit_observers
  }
  if(rules.membership.activate_prescription_manager) {
    body.overrides.activate_prescription_manager = rules.membership.activate_prescription_manager
    flagsToUpdate.activate_prescription_manager = rules.membership.activate_prescription_manager
  }

  if(rules.membership.activate_grocery_scanner || rules.membership.activate_healthkit_observers || rules.membership.activate_prescription_manager) {
    let updateSFFlagsResult = await sfSrv.updateSFFlags(eligibility.reseller_employee_id,flagsToUpdate)
    console.log('Flags updated in salesforce while assigning membership: ',updateSFFlagsResult);
  }

  if(event.isMinor){
    let [parent] = await db.getEligibilityByResellerRoleEmpId(eligibility.reseller_employee_id, eligibility.employer_id , constants.EligibilityRole.EMPLOYEE)

    console.log('Parent', parent)

    if(parent.length == 0 || parent[0] && !parent[0].id){
      console.log('Missing parent', parent)
      return
    }

    let parentEmail = (parent[0].app_email ? parent[0].app_email : shopData.email)

    // parent membership
    let parentEligibleProds = await gwHandler.getEligibility(employer, parent[0].eid)
    console.log('Parent Data', employer, parent[0].eid, 'Parent returned data', parentEligibleProds)

    Object.assign(body.overrides, overridesEligilbleProducts(parentEligibleProds[0].eligible_products, eligibility.eligible_products));
    body.users = [parentEmail]
    body.eligibility_id = parent[0].eid
    console.log('parent body', body)
    let darioResParent = await dario.DarioUserMembership(body)
    console.log('Dario membership assigned successfully.', darioResParent);

    // child membership

    Object.assign(body.overrides, overridesEligilbleProducts(eligibility.eligible_products));
    body.users = [eligibility.email]
    body.eligibility_id = eligibility.eid
    body.phone_number = eligibility.shop_phone != parent[0].shop_phone
    ? eligibility.shop_phone
    : (eligibility.phone != parent[0].shop_phone ? eligibility.phone : null);

    console.log('child body', body)
    let darioResChild = await dario.DarioUserMembership(body)
    console.log('Dario membership assigned successfully.', darioResChild);
    return;
  }

  Object.assign(body.overrides, overridesEligilbleProducts(eligibility.eligible_products));
  body.users = [shopData.email]
  body.eligibility_id = eligibility.eid

  console.log("user isn't minor - body", body)
  let darioRes = await dario.DarioUserMembership(body)
  console.log('Dario membership assigned successfully.', darioRes);
}

const overridesEligilbleProducts = (parent_prods, minor_prods) => {
  let obj = {
    'BP': false,
    'BG': false,
    'WM': false,
    'MSK': false,
    'PST': false,
    'MSK_PST': false,
    'MSK_CVA': false,
    'BH': false,
    'EAP': false
  }

  for (const [prodName, value] of Object.entries(parent_prods)) {
    if(!value){
      obj[prodName.toUpperCase()] = true
    }
  }

  if(minor_prods){
    for (const [prodName, value] of Object.entries(minor_prods)) {
      if(!value){
        obj[prodName.toUpperCase()] = true
      }
    }
  }
  console.log('overridesEligilbleProducts', parent_prods, minor_prods, obj)
  return obj;
}

async function terminationListHandler(termination_list) {

  if(termination_list.length < 1) {
    console.log('[terminationListHandler] termination_list empty');
    return;
  }

  console.log('[terminationListHandler] termination_list', JSON.stringify(termination_list));

  let batch = [];

  for(const [i,missingElig] of termination_list.entries()){
    let recnum = i+1;
    console.log('[terminationListHandler] remove user eligibility', JSON.stringify(missingElig));

    batch.push(queue.getEligibilityParams(missingElig, null, null, DUMMY_FILE_HIST_ID, constants.EligibilityWorkerAction.REMOVE, recnum, termination_list.length));
  }

  let chunkgen = chunks(batch, CHUNK_SIZE);

  for(let chunk of chunkgen){
    await queue.sendBatch(chunk);
  }

  return;
}

exports.cronTerminateUserHandler = async (event, context) => {
  console.log('[cronTerminateUserHandler] event', JSON.stringify(event));

  let [termination_list] = await db.getTerminationList();
  return await terminationListHandler(termination_list);
  // if(termination_list.length < 1) {
  //   console.log('[cronTerminateUserHandler] termination_list empty');
  //   return
  // }

  // console.log('[cronTerminateUserHandler] termination_list', JSON.stringify(termination_list));

  // let batch = [];

  // for(const [i,missingElig] of termination_list.entries()){
  //   let recnum = i+1;
  //   console.log('[cronTerminateUserHandler] remove user eligibility', JSON.stringify(missingElig));

  //   batch.push(queue.getEligibilityParams(missingElig, null, null, DUMMY_FILE_HIST_ID, constants.EligibilityWorkerAction.REMOVE, recnum, termination_list.length))
  // }

  // let chunkgen = chunks(batch, CHUNK_SIZE);

  // for(let chunk of chunkgen){
  //   await queue.sendBatch(chunk);
  // }

  // return
}

exports.cronTerminateGraceUserHandler = async (event, context) => {
  console.log('[cronTerminateGraceUserHandler] event', JSON.stringify(event));

  let [termination_list] = await db.getGraceTerminationList();
  return await terminationListHandler(termination_list);
  // if(termination_list.length < 1) {
  //   console.log('[cronTerminateGraceUserHandler] termination_list empty');
  //   return
  // }

  // console.log('[cronTerminateGraceUserHandler] termination_list', JSON.stringify(termination_list));

  // let batch = [];

  // for(const [i,missingElig] of termination_list.entries()){
  //   let recnum = i+1;
  //   console.log('[cronTerminateGraceUserHandler] remove user eligibility', JSON.stringify(missingElig));

  //   batch.push(queue.getEligibilityParams(missingElig, null, null, DUMMY_FILE_HIST_ID, constants.EligibilityWorkerAction.REMOVE, recnum, termination_list.length))
  // }

  // let chunkgen = chunks(batch, CHUNK_SIZE);

  // for(let chunk of chunkgen){
  //   await queue.sendBatch(chunk);
  // }

  // return
}

exports.cronTerminateMinorUserLinkHandler = async (event, context) => {
  console.log('[cronTerminateMinorUserHandler] event', JSON.stringify(event));

  let [employers_list] = await db.getEmployerMinorTargetingList();
  if(employers_list.length < 1) {
    console.log('[cronTerminateMinorUserHandler] minor_termination_list empty');
    return
  }

  let id = [];
  let minor_age = {};

  for(const [i,employer] of employers_list.entries()){
    if (
      employer.eligibility_rules == null ||
      (employer.eligibility_rules.hasOwnProperty('skipIfMinor') &&
        employer.eligibility_rules.skipIfMinor)
    ) {
      continue;
    }

    if (
      !employer.eligibility_rules.hasOwnProperty('targeting') ||
      (employer.eligibility_rules.hasOwnProperty('targeting') &&
        !employer.eligibility_rules.targeting.minor_age)
    ) {
      continue;
    }

    id.push(employer.id);
    minor_age[employer.id] = employer.eligibility_rules.targeting.minor_age;
  }

  if(id.length < 1) {
    console.log('[cronTerminateMinorUserHandler] id empty');
    return
  }

  let minor_link_termination_list = [];
  for(const [i, employer_id] of id.entries()) {
    let date = new Date();
    let minor_date = new Date(date.setFullYear(date.getFullYear() - minor_age[employer_id]));
    let range_date = new Date(date.setDate(minor_date.getDate() - 1));

    minor_date = minor_date.toISOString().substring(0,10);
    range_date = range_date.toISOString().substring(0,10);

    minor_link_termination_list = minor_link_termination_list.concat(await db.getEmployerMinorTerminationLinkList(employer_id, minor_date, range_date));
  }

  if(minor_link_termination_list.length < 1) {
    console.log('[cronTerminateMinorUserHandler] minor_link_termination_list empty');
    return
  }
  console.log('[cronTerminateMinorUserHandler] minor_link_termination_list', JSON.stringify(minor_link_termination_list));

  let batch = [];

  for(const [i,minor] of minor_link_termination_list.entries()){
    batch.push(minor);
  }

  let chunkgen = chunks(batch, CHUNK_SIZE);
  for(const [chunk] of chunkgen){
    await dario.removeMinorLink(chunk.email);
    console.log('[cronTerminateMinorUserHandler] deleted');
  }

  return
}

function* chunks(arr, n) {
  for (let i = 0; i < arr.length; i += n) {
      yield arr.slice(i, i + n);
  }
}

exports.DisableDarioUserMembership = async (event, context) => {

  console.log('DisableDarioUserMembership - event', event)
  let [employers_list] = await db.getEmployerByID(event.employer_id)
  let employer = employers_list[0]

  console.log('employer data', employer)

  if (!event.app_email) {
    console.log('Missing employer email')
    return
  }

  employer.eligibility_rules = JSON.parse(employer.eligibility_rules);
  let membershipRules = employer.eligibility_rules.membershipDisabled

  if(!membershipRules){
    console.log('Missing employer membership Rules', membershipRules)
    return;
  }

  let body = {}
  let flagsToUpdate = {}
  body.membership_plan = membershipRules.membership_plan
  body.overrides = {
    clinic: membershipRules.clinic,
    clinic_meta: membershipRules.clinic_meta,
    display_name: membershipRules.display_name,
    checkup_call_expert: membershipRules.checkup_call_expert,
    contact_us_email: membershipRules.contact_us_email,
    contact_us_phone: membershipRules.contact_us_phone
  }
  body.users = [event.app_email]

  if(membershipRules.activate_grocery_scanner) {
    body.overrides.activate_grocery_scanner = membershipRules.activate_grocery_scanner
    flagsToUpdate.activate_grocery_scanner = membershipRules.activate_grocery_scanner
  }
  if(membershipRules.activate_healthkit_observers) {
    body.overrides.activate_healthkit_observers = membershipRules.activate_healthkit_observers
    flagsToUpdate.activate_healthkit_observers = membershipRules.activate_healthkit_observers
  }
  if(membershipRules.activate_prescription_manager) {
    body.overrides.activate_prescription_manager = membershipRules.activate_prescription_manager
    flagsToUpdate.activate_prescription_manager = membershipRules.activate_prescription_manager
  }

  if(membershipRules.activate_grocery_scanner || membershipRules.activate_healthkit_observers || membershipRules.activate_prescription_manager) {
    let updateSFFlagsResult = await sfSrv.updateSFFlags(eligibility.sf_id,flagsToUpdate)
    console.log('Flags updated in salesforce while removing membership: ',updateSFFlagsResult);
  }
  try {
  let darioRes = await dario.DarioUserMembership(body)
  console.log('Dario membership remove successfully.', darioRes);
  } catch (error) {
    console.log(`catch block DisableDarioUserMembership ${error}`)
  }
}

exports.overridesEligilbleProducts = overridesEligilbleProducts;