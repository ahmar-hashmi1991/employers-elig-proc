const AWS = require('aws-sdk');
const constants = require('../common/constants');

const region = "us-east-1";
AWS.config.update({ region });

const sns = new AWS.SNS({apiVersion: '2010-03-31'})

module.exports = {
    sendMessage: (message) => {
        const params = {
            Subject: `Employers Eligibility Notificaiton`,
            Message: message, /* required */
            TopicArn: process.env.SMS_TOPIC_ARN
        };
        console.log('SNS params', JSON.stringify(params));
        return sns.publish(params).promise();
    },
    sendFullMessage: (subject, message) => {
        const params = {
            Subject: `[Employers Eligibility] ${subject}`,
            Message: message, /* required */
            TopicArn: process.env.SMS_TOPIC_ARN
        };
        console.log('SNS params', JSON.stringify(params));
        return sns.publish(params).promise();
    }
}