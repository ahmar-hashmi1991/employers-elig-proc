
const db = require('../services/rds-data-service');
var constants = require("../common/constants");
const dario = require('../services/dario-service.js');

const response = (res, err) => {
    let body = err ? {error:{code:err.code? error.code : 400, message: err.message}}: res
    return {
        statusCode: err ? 400 : 200,
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
        },
    }
};

const getUserForImatByAppEmail = async (email) => {
    let [user] = await db.getEligibilityByFields(`app_email = ?`, [email]);
    if(user[0] && user[0].attribute_1){
        let [employer] = await db.getEmployerByID(user[0].employer_id);
        let eligibility_rules = employer[0].eligibility_rules ? JSON.parse(employer[0].eligibility_rules) : {};
      
        if (eligibility_rules.IMATConfiguration  &&  eligibility_rules.IMATConfiguration.enableIMATEvents) {
            return {
                email,
                user: user[0],
                employer_id: employer[0].external_id,
                mrn: user[0].attribute_1,
                PersonNbr: user[0].employee_id,
                TaskGroup: user[0].group_task,
            };
        }

    }
    return false;
}; 

const getUserForImatByEid = async (eid) => {
    let [user] = await db.getEligibilityByFields(`eid = ?`, [eid]);
    if(user[0] && user[0].attribute_1){
        let [employer] = await db.getEmployerByID(user[0].employer_id);
        let eligibility_rules = employer[0].eligibility_rules ? JSON.parse(employer[0].eligibility_rules) : {};

        if (eligibility_rules.IMATConfiguration  &&  eligibility_rules.IMATConfiguration.enableIMATEvents) {
            return {
                eid,
                user: user[0],
                employer_id: employer[0].external_id,
                mrn: user[0].attribute_1,
                PersonNbr: user[0].employee_id,
                TaskGroup: user[0].group_task,
            };
        }
    }
    return false;
}; 

const log_message = async (message = "" , data = {} , type = "INFO") => {
    console.log({type, message, data});
};
exports.handleAPISearchRequest = async (event, context) => {
    const operation = event.requestContext.operationName;
    const data = JSON.parse(event.body);

    if(operation !== 'search'){
        return response({},  new Error(`Unsupported method "${operation}"`));
    }

    if(!data || !data.entity || !data.value || !data.query_param){
        return response({},  new Error("Missing search params."));
    }
    await log_message("Search Request", data);
    let result = {
        users:[]
    };
    let error = false;
    switch (data.entity) {
        case 'user':
            if(data.query_param === 'eid'){
                let user = await getUserForImatByEid(data.value);
                if(!!user){
                    result.users.push(user);
                }
            }
            else if(data.query_param === 'app_email'){
                let user = await getUserForImatByAppEmail(data.value);
                if(!!user){
                    result.users.push(user);
                }
            }else if(data.query_param === 'phone'){
                //....
            }
            break;
        default:
            error = new Error(`Unsupported method "${operation}"`);
    }
    await log_message("Search Request Result", {result, error});
    return response(result,  error);
};

exports.getUserForImatByAppEmail = getUserForImatByAppEmail;
exports.getUserForImatByEid = getUserForImatByEid;