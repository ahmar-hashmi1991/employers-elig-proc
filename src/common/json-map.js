const moment = require('moment');
const utils = require('./utils');
const NodeCache = require( "node-cache" );

const eligibilityCache = new NodeCache();
const emailValidatorRegexp = /^[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
const ROLE_EMPLOYEE = 'EE';
const CACHE_KEY_CURR_EMPL_ID = 'current_employee_id';

module.exports = {
    setupEmployerMappingRules: (employer, sourceName) => {
        
        if (employer.mapping_rules) {
            employer.mapping_rules = (typeof employer.mapping_rules == "object") ? JSON.stringify(employer.mapping_rules) : employer.mapping_rules;
            let mapping_rules = JSON.parse(employer.mapping_rules);
            let mappingBySource = sourceName &&  mapping_rules[sourceName] ? mapping_rules[sourceName] : mapping_rules;
            employer.mapping_rules = setupMappingRules(mappingBySource);
        }
    },
    setupMappingRules
}

function setupMappingRules(mapping_rules) {
    for (src of Object.keys(mapping_rules)) {
        if (typeof mapping_rules[src] === 'object' && mapping_rules[src].transform) {
            let rule = mapping_rules[src].transform.split(':');
            if (rule[0] === 'date') {
                // mapping_rules[src].transform = parseDate(rule.slice(1).join(':'), mapping_rules[src].key);
                mapping_rules[src].transform = parseDate(rule.slice(1).join(':'));
            }
            else if (rule[0] === 'lowercase') {
                mapping_rules[src].transform = lowercase();
            }
            else if (rule[0] === 'trim') {
                mapping_rules[src].transform = trim();
            }
            else if (rule[0] === 'country') {
                mapping_rules[src].transform = country();
            }
            else if (rule[0] === 'noSpecialChar') {
                mapping_rules[src].transform = noSpecialChar(mapping_rules[src].regex);
            }
            else if (rule[0] === 'email') {
                mapping_rules[src].transform = email(rule.slice(1));
            }
            else if (rule[0] === 'valid_email') {
                mapping_rules[src].transform = valid_email(rule.slice(1));
            }
            else if (rule[0] === 'employee_email') {
                mapping_rules[src].transform = employee_email(rule.slice(1));
            }
            else if (rule[0] === 'unique_email') {
                mapping_rules[src].transform = unique_email(rule.slice(1));
            }
            else if (rule[0] === 'inherit') {
                mapping_rules[src].transform = inherit(rule[1]);
            }
            else if (rule[0] === 'hash') {
                mapping_rules[src].transform = hash(rule.slice(1));
            }
            else if (rule[0] === 'hash2') {
                mapping_rules[src].transform = hash2(rule.slice(1));
            }
            else if (rule[0] === 'phone_number') {
                mapping_rules[src].transform = phone_number();
            }
            else if (rule[0] === 'gender') {
                mapping_rules[src].transform = gender(mapping_rules[src].default);
            }
            else if (rule[0] === 'role') {
                mapping_rules[src].transform = role(rule[1],mapping_rules[src].default);
            } 
            else if (rule[0] === 'parseDateV2') {
                mapping_rules[src].transform = parseDateV2(rule.slice(1).join(':'));
            }
            else if (rule[0] === 'parseUSzipCode') {
                mapping_rules[src].transform = parseUSzipCode();
            }
            else if (rule[0] === 'parseDateV2') {
                mapping_rules[src].transform = parseDateV2(rule.slice(1).join(':'));
            }
            else if (rule[0] === 'parseDateV3') {
                mapping_rules[src].transform = parseDateV3(rule.slice(1).join(':'));
            }
        }
    }
    console.log('Mapping Rules Transformed', JSON.stringify(mapping_rules));
    return mapping_rules;
}

const parseDate = (format) => {
    return (val) => {
        if(!!val){
            let mdate = moment(val.trim(),format,true);
            if(!mdate.isValid()) throw new Error(`Invalid date value - ${val.trim()}, should be: ${format}`);
           
            let date = new Date(moment(mdate).format("YYYY-MM-DD"))
            // const hasFutureDOB = utils.isFutureDateOfBirth(date);
            // if (hasFutureDOB && key == "dob") throw new Error(`Invalid date value - future DOB: ${val.trim()}`);
           
            return mdate.toDate();
        }
        return val;
    }
}

const parseDateV2 = (format) => {
    return (val) => {
        if(!!val){
            const date = moment(val.trim(), format, true);
            if(!date.isValid()) throw new Error(`Invalid date value - ${val.trim()}, should be: ${format}`);

            let mdate = new Date(moment(date).format("YYYY-MM-DD"))
            // const hasFutureDOB = utils.isFutureDateOfBirth(mdate);
            // if (hasFutureDOB) throw new Error(`Invalid date value - future DOB: ${val.trim()}`);

            const splittedDate = format.split(' ');
            const formattedDate = moment(date, splittedDate[0], true); 
            return formattedDate.toDate();
        }
        return val;
    }
}

const parseDateV3 = (format) => {
    return (val) => {
        if(!!val){
            let mdate = moment(val.trim(),format,true);
            if(!mdate.isValid()) throw new Error(`Invalid date value - ${val.trim()}, should be: ${format}`);

            let date = new Date(moment(mdate).format("YYYY-MM-DD"))
            // const hasFutureDOB = utils.isFutureDateOfBirth(date);
            // if (hasFutureDOB) throw new Error(`Invalid date value - future DOB: ${val.trim()}`);
            return date;
        }
        return val;
    }
}
const noSpecialChar = (format) => {
    return (val) => {
        let re = new RegExp(format);
        val = val.trim()
        if (val.length < 1) {
            throw new Error(`Name cannot be empty`);
        }
        if(!re.test(val)){
            throw new Error(`Invalid name - ${val.trim()}, should not contain special chracters`);

        }
        return val;
    }
}

const parseUSzipCode = () => {
    return (val) => typeof val === 'string' ? val.split('-')[0] : val;
}

const lowercase = () => {
    return (val) => typeof val === 'string' ? val.trim().toLowerCase() : val;
}

const trim = () => {
    return (val) => typeof val === 'string' ? val.trim() : val;
}

const country = () => {
    return (val) => {
        if (!val) {
            throw new Error('Country field is mandatory')
        }

        return val
    }
}

const email = (ignoreList) => {
    return (val) => {
        if(typeof val === 'string'){
            let lower = val.trim().toLowerCase();
            if(ignoreList){
                let invalid = ignoreList.find(expr => lower.match(expr));
                if(invalid){
                    console.log(`email '${val}' is invalid by expr: '${invalid}'`);
                    return null;
                }
            }
            return lower;
        }
        return val;
    };
}

const phone_number = (ignoreList) => {
    return (val) => {
        if(typeof val === 'string'){
            let parsed = utils.tryParsePhoneNumber(val.trim());
            return parsed;
        }
        return val;
    };
}

const gender = (defaultValue) => {
    return (val) => {
        if(typeof val === 'string'){
            if(['m','male'].includes(val.toLowerCase())){
                return 'M';
            }
            else if(['f','female'].includes(val.toLowerCase())){
                return 'F';
            } 
            else if(!defaultValue) {
                return val;
            }

            return defaultValue;
        }
        return val;
    };
}

const role = (roleData, defaultValue) => {
    console.log("roleData: " , roleData)
    return (val) => {
        console.log("roleData val: " , val)
        if(typeof val === 'string' || typeof val === 'number'){
            val = String(val)
            let mapper = roleData.split(',')
            let res = mapper.find(mapperVal => mapperVal.split('|')[0].toLowerCase() == val.toLowerCase())
            if(!res){
                if(!defaultValue){
                    throw new Error('Invalid role and default role not found')
                }else{
                    return defaultValue
                } 
            }
            console.log("roleData res: " , res)
            console.log("roleData res.split: " , res.split('|')[1])
           return res.split('|')[1];
        } else if (val == null) {
            if(!defaultValue){
                throw new Error('Invalid role and default role not found');
            } else {
                return defaultValue;
            } 
        }
        return val;
    };
}

const valid_email = (ignoreList) => {
    return (val) => {
        if(typeof val === 'string'){
            let lower = val.trim().toLowerCase();
            if(ignoreList){
                let invalid = ignoreList.find(expr => lower.match(expr));
                if(invalid){
                    console.log(`email '${val}' is invalid by expr: '${invalid}'`);
                    return null;
                }
            }
            if(!emailValidatorRegexp.test(lower)){
                console.warn(`WARNING: email '${val}' is invalid, this email will not pass!`);
                return null;
            }
            return lower;
        }
        return val;
    };
}

const employee_email = (roleFieldName) => {
    return (val,rec) => {
        let role = rec[roleFieldName];
        if(role === ROLE_EMPLOYEE){
            return valid_email()(val);
        }
        return null;
    }
}

const unique_email = (roleFieldName) => {
    let empEmails = new Map();
    let validEmailMapper = valid_email();
    
    return (val,rec) => {
        let email = validEmailMapper(val);
        if(!email) return email;
        
        let role = rec[roleFieldName];
        if(role === ROLE_EMPLOYEE){
            if(empEmails.has(email)){
                throw new Error(`ERROR: found duplicate employee email - '${email}'`);
            }
            empEmails.set(email, rec);
            return email;
        }
        else {
            if(!empEmails.has(email)){
                return email;
            }
        }
        return null;
    }
}

const hash = (fieldList) => {
    return (val,rec) => {
        if(!val){
            return utils.hash(fieldList.map(f => rec[f]).join(''));
        }
        else return val;
    }
}

const hash2 = (fieldList) => {
    return (val,rec) => {
        if(!val){
            return utils.hash(fieldList.map(f => rec[f].trim()).join(''));
        }
        else return val;
    }
}

const inherit = (roleFld) => {
    return (empId, sourceObject) => {
        let role = sourceObject[roleFld];
        // console.log('MAPPING ----> ', empId, sourceObject);
        if(role === ROLE_EMPLOYEE){
            if(!!!empId){
                throw new Error(`ERROR: reseller employee ID missing in record ${JSON.stringify(sourceObject)}`);
            }
            eligibilityCache.set(CACHE_KEY_CURR_EMPL_ID, empId);
        }
        else{
            if(!!!empId){
                // console.log('MAPPING restoring cache value ----> ', eligibilityCache.get(CACHE_KEY_CURR_EMPL_ID));
                return eligibilityCache.get(CACHE_KEY_CURR_EMPL_ID);
            }
        }
        return empId;
    }
}

