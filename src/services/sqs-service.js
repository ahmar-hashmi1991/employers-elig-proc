const AWS = require('aws-sdk');
const constants = require('../common/constants');

const region = "us-east-1";
AWS.config.update({ region });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

module.exports = {
    getShopParams: (order_data , employer_id) => {
        return {
            Id: `elig-order-${order_data.orderId}-${order_data.memberId}-${order_data.employerId}`,
            MessageGroupId: `${employer_id}:${order_data.employerId}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: "order"
                }
            },
            MessageBody: JSON.stringify({order_data, employer_id})
        };
    },
    getEligibilityParams: (eligibility, old_eligibility, employer, fileHistId, action, i, count, originalRecord) => {
        console.log("get Eligibility Params, original Record to send sqs:", originalRecord)
        if (action === 'grace') console.log(">> action", action)
        return {
            Id: `elig-${fileHistId}-${action}-${i}-${count}`,
            MessageGroupId: `${fileHistId}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: action
                },
                RecordIndex: {
                    DataType: "Number",
                    StringValue: `${i}`
                },
                RecordCount: {
                    DataType: "Number",
                    StringValue: `${count}`
                }
            },
            MessageBody: JSON.stringify({
                eligibility,
                old_eligibility,
                employer,
                fileHistId,
                originalRecord
            })
        };
    },
    getFinishParams: (fileHistId, stats) => {
        return {
            Id: `elig-${fileHistId}-finish`,
            MessageGroupId: `${fileHistId}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: constants.EligibilityWorkerAction.FINISH
                }
            },
            MessageBody: JSON.stringify({
                fileHistId,
                stats
            })
        };
    },
    sendEligibilityMessage: (eligibility, old_eligibility, employer, fileHistId, action, i, count) => {
        const params = {
            MessageGroupId: `${fileHistId}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: action
                },
                RecordIndex: {
                    DataType: "Number",
                    StringValue: `${i}`
                },
                RecordCount: {
                    DataType: "Number",
                    StringValue: `${count}`
                }
            },
            MessageBody: JSON.stringify({
                eligibility,
                old_eligibility,
                employer,
                fileHistId
            }),
            // MessageDeduplicationId: "TheWhistler",  // Required for FIFO queues
            QueueUrl: process.env.SQS_QUEUE_URL
        };

        return sqs.sendMessage(params).promise();
    },
    sendFinishMessage: (fileHistId, stats, s3Configuration) => {
        const params = {
            MessageGroupId: `${fileHistId}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: constants.EligibilityWorkerAction.FINISH
                }
            },
            MessageBody: JSON.stringify({
                fileHistId,
                stats,
                s3Configuration
            }),
            // MessageDeduplicationId: "TheWhistler",  // Required for FIFO queues
            QueueUrl: process.env.SQS_QUEUE_URL
        };

        return sqs.sendMessage(params).promise();
    },
    sendBatch: (entries, queueUrl) => {
        if(!entries.length) return;

        const params = {
            Entries: entries,
            QueueUrl: process.env.SQS_QUEUE_URL
        };
        // console.log('Batch params:',params);
        return sqs.sendMessageBatch(params).promise();
    },
    sendTransaction: (transaction) => {
        if(!transaction) return;

        const params = {
            MessageBody: JSON.stringify(transaction),
            QueueUrl: process.env.SQS_QUEUE_URL
        };
        console.log('Message params:', params);
        return sqs.sendMessage(params).promise();
    },
    sendMessage: (body, workerAction, QueueUrl) => {
        console.log('sendMessage- func', body, workerAction, QueueUrl)
        
        const params = {
            MessageGroupId: `${body.employer_id}`,
            MessageAttributes: {
                EligibilityAction: {
                    DataType: "String",
                    StringValue: workerAction
                }
            },
            MessageBody: JSON.stringify(body),
            QueueUrl: QueueUrl
        };
        // console.log('sendMessage', params)
        return sqs.sendMessage(params).promise();
    },
    sendFlowTransaction: (transaction) => {
        if(!transaction) return;

        console.log('[sendFlowTransaction] transaction', transaction)

        return sqs.sendMessage(transaction).promise();
    },
    sendSoleraMessage: (body) => {
        const params = {
            MessageGroupId: `elig-solera-disenroll-user-${body.userId}`,
            MessageBody: JSON.stringify(body),
            QueueUrl: process.env.SQS_SOLERA_DISENROLLMENT_QUEUE
        };

        console.log('[sendSoleraMessage] params', params);

        return sqs.sendMessage(params).promise();
    },
}