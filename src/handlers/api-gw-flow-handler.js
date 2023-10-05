const db = require('../services/rds-data-service');
var constants = require("../common/constants");
const salesforce = require('../services/salesforce-service');
const braze = require('../services/braze-service.js');
const queue = require('../services/sqs-service');

const CHUNK_SIZE = 10;

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
  try {
    console.log('[handleAPIRequest] - flow-handler', event,  event.pathParameters, event.requestContext);
    let operationName = event.requestContext && event.requestContext.operationName ? event.requestContext.operationName : ''
    const employer_id = event.pathParameters.employer_id;
    const eligibility_id = event.pathParameters.eligibility_id;
    const flow_id = event.pathParameters.flow_id;
    let body = event.body && event.body.notes ? event.body : JSON.parse(event.body) 
    const notes = body.notes;
    
    const flowEvent = {
      MessageGroupId: `${flow_id}`,
      MessageAttributes: {
          EligibilityAction: {
              DataType: "String",
              StringValue: 'AddFlowEvent'
          }
      },
      MessageBody: JSON.stringify({
        employer_id,
        eligibility_id,
        flow_id,
        notes,
        body
      }),
      QueueUrl: process.env.SQS_FLOW_QUEUE_URL
    };

    console.log('flowEvent', flowEvent);

    let res = await queue.sendFlowTransaction(flowEvent);

    console.log('flowEvent res', res);

    return response({ success: true });
  }
  catch(error){
    console.log(error);
    return response({ success: false }, new Error(`ERROR: ${error.message}`));
  }
};