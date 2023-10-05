const emailSrv = require('../services/email-service');

const response = (res, err) => {
    return {
        statusCode: err ? '400' : '200',
        body: err ? JSON.stringify({ success: false, error: err.message }) : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    }
}

const handleSmbCountReached = async (data) => {
    console.log('[handleAPIRequest.handleSmbCountReached] data', data);

    const {count, id, max} = data

    if (count && id && max) {
        const precent = ((count/max)*100).toFixed(2)
        const subject = `Account ${id} has reached ${precent}%`
        const body = `Dear team,\n\n
        Account ${id} has reached ${precent}% of the expected enrolled members. \n
        Please review the members enrolled and verify that no malicious activity was done.\n\n`
        await emailSrv.sendEmail(subject, body);
    } else {
        return response({ success: false }, new Error(`ERROR: Missing properties`));
    }
    
}

exports.handleAPIRequest = async (event, context) => {
    console.log('[handleAPIRequest] event', event);

    const operationName = event.requestContext.operationName;
    try {
        switch (`${operationName}`) {
            case 'email_smb_update':
                const smbData = JSON.parse(event.body);
                await handleSmbCountReached(smbData);

                break;

            default:
                return response({ success: false }, new Error(`ERROR: Unsupported Operation`));
        }
    } catch (error) {
        console.log(error);
        console.log(error.message);
        return response({ success: false }, new Error(`ERROR: Uknown Error Occured`));
    }

    return response({ success: true });
}