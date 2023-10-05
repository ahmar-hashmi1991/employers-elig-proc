const AWS = require('aws-sdk');

const region = "us-east-1";
const secretsManager = new AWS.SecretsManager({
    region: region
});

async function checkSftpUserExist(secretName) {
    const secret = await exports.getSftpSecretValue(secretName);
    if (Object.keys(secret).length === 0) {
        return false;
    }
    return true;
}

async function createSftpUser(params) {
    try {
        const data = await secretsManager.createSecret(params).promise();
        return {
            statusCode: 200,
            body: data
        }
    }
    catch (err) {
        return {
            statusCode: 400,
            body: err
        };
    }
}

async function updateSftpUser(params) {
    try {
        const data = await secretsManager.updateSecret(params).promise();
        return {
            statusCode: 200,
            body: data
        }
    }
    catch (err) {
        return {
            statusCode: 400,
            body: err
        };
    }
}

exports.getSftpSecretValue = async (secretName) => {
    try {
        let data = await secretsManager.getSecretValue({SecretId: secretName}).promise();
        if ('SecretString' in data) {
            return JSON.parse(data.SecretString);
        } else {
            let buff = Buffer.from(data.SecretBinary, 'base64');
            return JSON.parse(buff.toString('ascii'));
        }
    }
    catch(err) {
        return {};
    }
}

exports.sftpUserService = async (sftpUserName, sftpData) => {
    const { sftpPassword, ipWhitelist, description, isUpdated } = sftpData;
    if (!sftpUserName || !sftpPassword) {
        return {
            statusCode: 400,
            body: 'SFTP username or password cannot be empty'
        };
    }
    const secretName = `${process.env.STAGE}/SFTP/${sftpUserName}`;
    
    const isSftpUserExist = await checkSftpUserExist(secretName);
    const secretData = {
        'Password': sftpPassword,
        'HomeDirectory': `/${sftpUserName}`,
        ...(ipWhitelist) && {'IPWhiteList': ipWhitelist}
    };

    if (isSftpUserExist && isUpdated) {
        const secretParamsUpdate = {
            'SecretId': secretName,
            'SecretString': JSON.stringify(secretData),
            ...(description) && {'Description': description}
        };
        const res = await updateSftpUser(secretParamsUpdate);
        return res;
    }
    else if (!isSftpUserExist) {
        const secretParamsCreate = {
            'Name': secretName,
            'SecretString': JSON.stringify(secretData),
            'Tags': [{Key: 'Application', Value: 'admin'}],
            ...(description) && {'Description': description}
        };
        const res = await createSftpUser(secretParamsCreate);
        return res;
    }
}
