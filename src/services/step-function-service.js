const AWS = require('aws-sdk');
const stepfunctions = new AWS.StepFunctions();
const crypto = require('crypto');

module.exports = {
    executeAssignUserToClinic: (input) => {
        const params = {
            'stateMachineArn': process.env.EligAssignToClinicStateMachineArn,
            'input': JSON.stringify(input)
        };
        return stepfunctions.startExecution(params).promise();
    },
    executeAssignUserToClinicV2: (email, targets, eligibility, isMinor, shopdata, rules) => {
        let md5email = crypto.createHash('md5').update(email).digest('hex');
        let productsNames = shopdata.orders.map(target => target.product_type).join('-')
        const params = {
            'stateMachineArn': process.env.EligAssignToClinicStateMachineArn,
            'input': JSON.stringify({
                email,
                targets,
                eligibility,
                isMinor,
                shopdata, 
                rules
            }),
            'name': `${md5email}-${productsNames}-${Date.now()}`
        };
        return stepfunctions.startExecution(params).promise();
    },
    executePostEnrollmentStateMachine: (eligibility, employer) => {
        const params = {
            'stateMachineArn': process.env.EligibilityPostEnrollmentStateMachineArn,
            'input': JSON.stringify({
                employer,
                eligibility
            }),
            'name': `${eligibility.eid}-${Date.now()}`
        };
        return stepfunctions.startExecution(params).promise();
    },
    executeCreatePendingOrderStateMachine: (event) => {
        const params = {
            'stateMachineArn': process.env.CreatePendingOrderStateMachineArn,
            'input': JSON.stringify(event)
        };
        console.log(`executeCreatePendingOrderStateMachine process.env.CreatePendingOrderStateMachineArn ------ ${process.env.CreatePendingOrderStateMachineArn}`)
        return stepfunctions.startExecution(params).promise();
    }
}
