const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const util = require('util');

const client = jwksClient({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10, // Default value
    jwksUri: process.env.JWKS_URI
})

const jwtOptions = {
    audience: process.env.AUDIENCE,
    issuer: process.env.TOKEN_ISSUER
}
const signingKeyForSAMLToken = process.env.SAMLSIGNINGKEY;

exports.authorize = async (event, context) => {
    try {
        console.log('event', JSON.stringify(event));

        const result = await determineAuthorization(event);

        console.log('Authorizer result', JSON.stringify(result));

        return result;
    }
    catch(err) {
        console.error('Error in JWT authorizer', err);
        return {
            policyDocument: getPolicyDocument('Deny', event.methodArn),
        }
    }
}
const determineAuthorization = async (event) => {
    // Sanity check: the callers sourceIp should be present
    // const sourceIp = assertSourceIp(event);

    // TEMPORARY - until dario tools is decommisioned
    if(event.methodArn.endsWith('GET/files-history')){
        const tokenString = event.authorizationToken;
        const match = tokenString.match(/^Basic (.*)$/);
        if (match && match.length >= 2) {
            const credentials = Buffer.from(match[1],'base64').toString('utf8').split(':');
            if(credentials.length === 2){
                if(credentials[1] === '4LyVZQXJEMasjmzmpiiee3X8qLuOYj9c6DjhFwLl') {
                    return {
                        principalId: `apikey:${credentials[0]}`,
                        policyDocument: getPolicyDocument('Allow', event.methodArn),
                        context: {
                            scope: 'profile email',
                            userid: credentials[0]
                        }
                    };
                }
            }
        }
    }

    const token = getToken(event);
    console.log("token from determineAuthorization", token);

    const decoded = jwt.decode(token, { complete: true });
    console.log("decoded", JSON.stringify(decoded));
    // Keeping commented code for future reference --- START
    // if (!decoded || !decoded.header || !decoded.header.kid) {
    //     // throw new Error('invalid token');
    //     console.error(`invalid token ${token}`);
    //     return {
    //         policyDocument: getPolicyDocument('Deny', event.methodArn),
    //     }
    // }
    // --- END

    // In order to verify the SAML Token or Auth0 token because both can be used the above conditions for Denying the access to user is getting changed
    if(decoded && decoded.header && decoded.header.kid){
        try {
            const getSigningKey = util.promisify(client.getSigningKey);
            const key = await getSigningKey(decoded.header.kid);
            const signingKey = key.publicKey || key.rsaPublicKey;
            const verified = jwt.verify(token, signingKey, jwtOptions);
            console.log('Authorizer verified from Auth0', verified);
            return {
                principalId: verified.sub,
                policyDocument: getPolicyDocument('Allow', event.methodArn),
                context: {
                    scope: verified.scope,
                    userid: verified.dario_userid //EMAIL-ID
                }
            };
        } catch (err){
            console.error(`invalid token from Auth0 ${token}`);
            return {
                policyDocument: getPolicyDocument('Deny', event.methodArn),
            }
        }
    } else if(decoded && decoded.header && !decoded.header.kid) { // Checking for SAML Token from Dario-Admin, which would not have kid, but still checking for proper decoding of the token
        try {
            const verifiedSAMLToken = jwt.verify(token, signingKeyForSAMLToken);
            console.log("verified from SSO SAML", JSON.stringify(verifiedSAMLToken));
            // Authorizer result -> Result for Allowing Access in case of Auth0, kept here for future reference
            // {
            //     "principalId":"auth0|63b40eabab5860e9fab44616",
            //     "policyDocument":{"Version":"2012-10-17",
            //     "Statement":[{"Action":"execute-api:Invoke","Effect":"Allow","Resource":"arn:aws:execute-api:us-east-1:123456789012:1234567890/stage/GET/files-history/statistics"}]},
            //     "context":{"scope":"openid profile email address phone","userid":"sachindras@dariohealth.com"}
            // }
            return {
                principalId: `SAML|${verifiedSAMLToken.sessionId}`, // I think its about which entity is trying to login, Auth0 sends back -> auth0|63b40eabab5860e9fab44616
                policyDocument: getPolicyDocument('Allow', event.methodArn),
                context: {
                    scope: 'SAML-SSO', // I think it is the scope coming from Auth0 -> openid profile email address phone, for us it is coming from 'SAML-SSO'
                    userid: verifiedSAMLToken.user_email_id //EMAIL-ID
                }
            };
        } catch (err){
            console.error(`invalid token from SAML SSO from Dario-Admin ${token}`);
            return {
                policyDocument: getPolicyDocument('Deny', event.methodArn),
            }
        }
    } else {
        console.error(`invalid token for unexpected scenarios ${token}`);
        return {
            policyDocument: getPolicyDocument('Deny', event.methodArn),
        }
    }
}

const verifyToken = async (token, methodArn) => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
        // throw new Error('invalid token');
        console.error(`invalid token ${token}`);
        return {
            policyDocument: getPolicyDocument('Deny', methodArn),
        }
    }

    const getSigningKey = util.promisify(client.getSigningKey);
    const key = await getSigningKey(decoded.header.kid);

    const signingKey = key.publicKey || key.rsaPublicKey;
    const verified = jwt.verify(token, signingKey, jwtOptions);

    console.log('Authorizer verified', verified);

    return {
        principalId: verified.sub,
        policyDocument: getPolicyDocument('Allow', methodArn),
        context: {
            scope: verified.scope,
            userid: verified.dario_userid
        }
    };
}

const getPolicyDocument = (effect, resource) => {
    const policyDocument = {
        Version: '2012-10-17', // default version
        Statement: [{
            Action: 'execute-api:Invoke', // default action
            Effect: effect,
            Resource: resource,
        }]
    };
    return policyDocument;
}

const getToken = (event) => {
    if (!event.type || event.type !== 'TOKEN') {
        throw new Error('Expected "event.type" parameter to have value "TOKEN"');
    }

    const tokenString = event.authorizationToken;
    if (!tokenString) {
        throw new Error('Expected "event.authorizationToken" parameter to be set');
    }

    const match = tokenString.match(/^Bearer (.*)$/);
    if (!match || match.length < 2) {
        throw new Error(`Invalid Authorization token - ${tokenString} does not match "Bearer .*"`);
    }
    return match[1];
}

const assertSourceIp = (event) => {
    const sourceIp = event.requestContext && event.requestContext.identity.sourceIp;
    if (!sourceIp) {
        throw new Error('Source IP Cannot be determined');
    }
    return sourceIp;
}
