const AWS = require('aws-sdk');

const region =  process.env.Region || 'us-east-1';
const client = new AWS.SecretsManager({
    region: region
});

const getSftpSecretValue = async (secretName) => {
    try {
        let data = await client.getSecretValue({SecretId: secretName}).promise();
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

module.exports = {
    getSecret: (secretName) => {
        return new Promise((resolve,reject) => {
            client.getSecretValue({SecretId: secretName}, function(err, data) {
                if (err) {
                    console.log(`ERROR retrieving secret '${secretName}'`, err);
                    reject(err);
                }
                else {
                    // Decrypts secret using the associated KMS CMK.
                    // Depending on whether the secret is a string or binary, one of these fields will be populated.
                    if ('SecretString' in data) {
                        resolve(JSON.parse(data.SecretString));
                    } else {
                        let buff = new Buffer(data.SecretBinary, 'base64');
                        resolve(JSON.parse(buff.toString('ascii')));
                    }
                }
            });
        });
    },
    getSecretValue: async (secretName) => {
        try{
            console.log(`get secret: ${secretName}`);
            let data = await client.getSecretValue({SecretId: secretName}).promise();
            if ('SecretString' in data) {
                return JSON.parse(data.SecretString);
            } else {
                let buff = Buffer.from(data.SecretBinary, 'base64');
                return JSON.parse(buff.toString('ascii'));
            }
        }
        catch(err){
            console.log(`ERROR retrieving secret '${secretName}'`, err);
            throw err;
        }
    },
    checkSftpUserExist: async (secretName) => {
        const secret = await getSftpSecretValue(secretName);
        if (Object.keys(secret).length === 0) {
            return false;
        }
        return true;
    },
    deleteSftpUser : async (secretName) => {
        try {
            const params = {
                ForceDeleteWithoutRecovery: true,
                // RecoveryWindowInDays: 7, // * This is the minimum window we can set. Max is 30 days
                SecretId: secretName,
            }
            const data = await client.deleteSecret(params).promise();
            return {
                statusCode: 200,
                body: data
            }
        }
        catch (err) {
            return {
                statusCode: 500,
                body: err
            };
        }
    },
    createSftpUser: async (params) => {
        try {
            const data = await client.createSecret(params).promise();
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
    },
    updateSftpUser: async (params) => {
        try {
            const data = await client.updateSecret(params).promise();
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
    },
}