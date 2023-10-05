const AWS = require('aws-sdk');

const BUCKET = process.env.ArchiveBucket;
const db = require('../services/rds-data-service');
const sftpService = require('../services/sftp-user-service');
const s3 = new AWS.S3();


exports.sftpEmployerFolderHandler = async (event, context) => {
    const { username, employer_id } = JSON.parse(event.body);
    try {
        const sftpUserName = username.trim().replace(/ /g,'_');
        const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`;
        const sftpDetails = await sftpService.getSftpSecretValue(secretName);
        if (Object.keys(sftpDetails).length) {
            const keyList = [`${sftpUserName}/claims/`, `${sftpUserName}/test_files/`, `${sftpUserName}/outgoing/`, `${sftpUserName}/incoming/Error/`, `${sftpUserName}/incoming/Failed/`];
            for (const key of keyList) {
                const params = {
                    Bucket: BUCKET,
                    Key: key,
                    Body: '',
                    ACL: 'public-read-write'
                };
                const s3Upload = await s3.upload(params).promise();
                if (!s3Upload) {
                    return {
                        statusCode: 400,
                        body: `Folder could not be created ${key}`
                    };
                }
            }

            const employerParams = {
                'external_id': employer_id,
                'folder': sftpUserName
            }
            const res = await db.updateEmployerSourceFolder(employerParams);
            if (!res || res.length === 0) {
                return {
                    statusCode: 400,
                    body: 'Source folder could not be updated'
                };
            }
            return {
                statusCode: 200,
                body: `S3 folders successfully created for ${sftpUserName}`
            };
        }
        return {
            statusCode: 400,
            body: `AWS Secret is not present for ${sftpUserName}`
        };
    }
    catch (err) {
        return {
            statusCode: 400,
            body: `Something went wrong`
        };
    }
}
