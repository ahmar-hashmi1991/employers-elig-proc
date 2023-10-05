const db = require('../services/rds-data-service');
var constants = require("../common/constants");
const salesforce = require('../services/salesforce-service');
const braze = require('../services/braze-service.js');

const response = (res, err) => {
  return {
    statusCode: err ? '400' : '200',
    body: err ? JSON.stringify({ success: false, error: err.message }) : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json',
    },
  }
};

/**
  * A Lambda function that receive Requests from Eligibility API GW.
  */
exports.handleAPIRequest = async (event, context) => {
  console.log('event', event);
  let operationName = event.requestContext.operationName;
  const employer_id = event.pathParameters.employer_id;
  const eligibility_id = event.pathParameters.eligibility_id;
  let body = JSON.parse(event.body);

  try {
    if(!!!employer_id){
      return response({ success: false }, new Error(`ERROR missing employer ID - ${employer_id}`));
    }
    let [employer, emp_flds] = await db.getEmployer(employer_id);
    if (employer.length !== 1) {
      return response({ success: false }, new Error(`ERROR invalid employer ID - ${employer_id}`));
    }

    let [elig, elig_flds] = await db.getEligibility(employer[0].id, eligibility_id);
    if (elig.length !== 1) {
      return response({ success: false }, new Error(`ERROR invalid eligibility ID - ${eligibility_id}`));
    }

    console.log('adding survey log...');
    let [result] = await db.addEligibilitySurveyLog(elig[0].id, body.type, body.score, body.answers);
    console.log('survey log added', result);

    return response({ success: true });
  }
  catch(error){
    console.log(error);
    return response({ success: false }, new Error(`ERROR: ${error.message}`));
  }
};