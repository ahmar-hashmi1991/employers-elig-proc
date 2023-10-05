const AWS = require('aws-sdk');
const path = require('path');
const db = require('../../services/rds-claims-data-service');
const constants = require('../../common/constants');

const batch = new AWS.Batch();

exports.handleClaimsFile = async (event, context) => {
    console.log('event', JSON.stringify(event));

    try {
        const resultsAsPromised = event.Records.map(processClaimsFile);
        return await Promise.all(resultsAsPromised);
    }
    catch(err) {
        console.error('ERROR in S3 event handling', err);
        if(err.constructor.name === 'Error') throw err;
        else throw new Error(err);
    }
}

async function processClaimsFile(record) {
    let eventTime = record.eventTime;
    const fileKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    let filepath = fileKey.slice(0, fileKey.lastIndexOf('/'));

    if(!!!path.relative(filepath, fileKey)){
        console.log(`identified folder only: ${fileKey}, nothing to process...`);
        return {statusCode: 200, body: JSON.stringify({status: 'SUCCESS', fileKey: fileKey, message: 'folder - nothing to process'})};
    }
    if(fileKey.lastIndexOf('/') === -1) {
        console.log(`file in root folder: ${fileKey}, nothing to process...`);
        return {statusCode: 200, body: JSON.stringify({status: 'SUCCESS', fileKey: fileKey, message: 'file in root folder - nothing to process'})};
    }

    let [accounts] = await db.getAccountByFolder(filepath);
    console.log('search account by folder result', accounts);

    if(accounts.length !== 1){
        console.log(`WARNING: Account record NOT FOUND for file: ${fileKey}`);
        throw new Error(`WARNING: Account record NOT FOUND for file: ${fileKey}`);
    }

    const account = accounts[0];

    let fileLogResult = await db.createFileHistoryLog(account.id, fileKey, filepath, constants.ClaimsFileStatus.NEW);
    var fileHistLogId = fileLogResult.insertId;

    const jobInput = {
        eventTime,
        bucket: record.s3.bucket.name,
        key: fileKey,
        accountId: account.id,
        fileHistoryId: fileHistLogId
    };
    const jobPayoad = Buffer.from(JSON.stringify(jobInput)).toString("base64");
    const params = {
        jobDefinition: process.env.BATCH_JOB_DEFINITION, 
        jobName: `claim-file-processing-${new Date(eventTime).getTime()}`,
        jobQueue: process.env.BATCH_JOB_QUEUE_NAME,
        containerOverrides: {
            "command": [ "node", "src/jobs/claims", jobPayoad  ],
            "environment": [ 
                {"name": "InputBucket", "value": record.s3.bucket.name},
                {"name": "FileKey", "value": fileKey}
            ]
        }
    };

    console.log('Submiting new job -->', params);
    let jobInfo = await batch.submitJob(params).promise();
    console.log('Submitted job -->', jobInfo);
    return jobInfo;
}
