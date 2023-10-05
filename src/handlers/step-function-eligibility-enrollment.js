const moment = require('moment');
const braze = require('../services/braze-service.js');

exports.SubscribeToBrazeSubscriptionGroup = async (event, context) => {
    try {
        console.log('Eligibility Enrollment StepFunction Event', event);
        let eligibility = event.eligibility;
        let rules = getRulesFromEmployer(event.employer);

        if(rules && rules.targeting && rules.targeting.minor_age){
            if(!eligibility.dob){
                console.log('user has no date of birth data');
                return 'user has no date of birth data';
            }
    
            let age = moment().diff(eligibility.dob, 'years');
            if(age > rules.targeting.minor_age){
                let result = await Promise.all([
                    braze.setEmailSubscription(eligibility.email, 'subscribed'),
                    braze.subscribeToAllSubscriptionGroups(eligibility.email, eligibility.shop_phone, true)
                ]);
                console.log(`register adult, age ${age}, to SMS subscription group result`, result);
                return result;
            }
            else {
                let result = await Promise.all([
                    braze.setEmailSubscription(eligibility.email, 'unsubscribed'),
                    braze.subscribeToAllSubscriptionGroups(eligibility.email, eligibility.shop_phone, false)
                ]);
                console.log(`unsubscribe minor, age ${age}, from sms/email/push subscription result`, result);
                return {description: `user's age - ${age} is minor, not subscribed...`, result};
            }
        }
        else {
            //no minor resriction
            let result = await braze.subscribeToAllSubscriptionGroups(eligibility.email, eligibility.shop_phone, true);
            console.log('register to SMS subscription group result', result);
            return result;
        }
        
    }
    catch (err) {
        console.error(`Error subscribing to braze subscription groups`, err);
        throw err;
    }
}

function getRulesFromEmployer(employer) {
    try {
        json = JSON.parse(employer.eligibility_rules);
        return json;
    } catch (e) {
        console.log("eligibility_rules parse error", e);
        return null;
    }
}