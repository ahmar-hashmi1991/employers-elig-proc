const AWS = require('aws-sdk');
const secrets = require('../services/secrets-service');
const Netmask = require('netmask').Netmask;

exports.authenticate = async (event, context) => {
    // console.log('event', JSON.stringify(event));
    let resp_data = {};

    if(!('username' in event) || !('serverId' in event)) {
        console.log("Incoming username or serverId missing  - Unexpected");
        return response_data
    }

    console.log(`Username: ${event.username}, ServerId: ${event.serverId}, Protocol: ${event.protocol}, source IP: ${event.sourceIp}`);

    //# Lookup user's secret which can contain the password or SSH public keys
    let secret = await secrets.getSecret(`${process.env.STAGE}/SFTP/${event.username}`);

    //IP whitelist
    if(secret.IPWhiteList && typeof secret.IPWhiteList === 'string'){
        let ipList = secret.IPWhiteList.split(',').map(item=>item.trim()).filter(ip => ip.trim().length > 0);
        console.log('IPLIST from secret manager ---->>>> ', ipList);
        ipList = ipList.map(ip => new Netmask(ip));
        console.log('IPLIST Netmask usage ---->>>> ', ipList);
        let found = ipList.find(m => m.contains(event.sourceIp));
        console.log('IPLIST FOUND RESULT ---->>>> ', found);
        if(!found){
            console.log('Unable to authenticate user - source IP not whitelisted.');
            return {};
        }
        else{
            console.log(`IP whitelisted: ${event.sourceIp} -> ${found.toString()}`);
        }
    }

    if(event.password) { //password auth
        if('Password' in secret) {
            if(secret.Password !== event.password) {
                console.log('Unable to authenticate user - Incoming password does not match');
                return {};
            }
            else console.log(`Successfully authenticated ${event.username}!`);
        }
        else{
            console.log('Unable to authenticate user - No field match in Secret for password');
            return {};
        }
    }
    else { // SSH Public Key Auth Flow - The incoming password was empty so we are trying ssh auth and need to return the public key data if we have it
        if('PublicKey' in secret) {
            resp_data.PublicKeys = [secret.PublicKey];
        }
        else {
            console.log("Unable to authenticate user - No public keys found");
            return {};
        }
    }
    
    resp_data.Role = process.env.ROLE_ARN;
    // resp_data.HomeBucket = process.env.BUCKET_NAME;
    // resp_data.HomeDirectory = `/${process.env.BUCKET_NAME}/${secret.HomeDirectory}`;
    resp_data.HomeDirectoryType = 'LOGICAL';
    resp_data.HomeDirectoryDetails = JSON.stringify([{
        Entry:"/",
        Target: `/${process.env.BUCKET_NAME}${secret.HomeDirectory !== '*' ? `/${secret.HomeDirectory}` : ''}`
    }]);
    resp_data.Policy = createPolity(secret.HomeDirectory);

    console.log(`Completed Response Data: ${JSON.stringify(resp_data)}`);
    return resp_data;
}

const createPolity = (HomeFolder) => {
    if(HomeFolder !== '*'){
        return JSON.stringify({
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AllowListingOfUserFolder",
                    "Action": [
                        "s3:ListBucket"
                    ],
                    "Effect": "Allow",
                    "Resource": [
                        `arn:aws:s3:::${process.env.BUCKET_NAME}`
                    ],
                    "Condition": {
                        "StringLike": {
                            "s3:prefix": [
                                `${HomeFolder}/*`,
                                `${HomeFolder}`
                            ]
                        }
                    }
                },
                {
                    "Sid": "AWSTransferRequirements",
                    "Effect": "Allow",
                    "Action": [
                        "s3:ListAllMyBuckets",
                        "s3:GetBucketLocation"
                    ],
                    "Resource": "*"
                },
                {
                    "Sid": "HomeDirObjectAccess",
                    "Effect": "Allow",
                    "Action": [
                        "s3:PutObject",
                        "s3:GetObject",
                        "s3:DeleteObjectVersion",
                        "s3:DeleteObject",
                        "s3:GetObjectVersion"
                    ],
                    "Resource": `arn:aws:s3:::${process.env.BUCKET_NAME}/${HomeFolder}/*`
                }
            ]
        })
    }
    else {
        return JSON.stringify({
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "AllowListingOfUserFolder",
                    "Action": [
                        "s3:ListBucket"
                    ],
                    "Effect": "Allow",
                    "Resource": [
                        `arn:aws:s3:::${process.env.BUCKET_NAME}`
                    ]
                },
                {
                    "Sid": "AWSTransferRequirements",
                    "Effect": "Allow",
                    "Action": [
                        "s3:ListAllMyBuckets",
                        "s3:GetBucketLocation"
                    ],
                    "Resource": "*"
                },
                {
                    "Sid": "HomeDirObjectAccess",
                    "Effect": "Allow",
                    "Action": [
                        "s3:PutObject",
                        "s3:GetObject",
                        "s3:DeleteObjectVersion",
                        "s3:DeleteObject",
                        "s3:GetObjectVersion"
                    ],
                    "Resource": `arn:aws:s3:::${process.env.BUCKET_NAME}/*`
                }
            ]
        })
    }
    
}