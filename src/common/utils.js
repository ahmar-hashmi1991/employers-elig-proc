const { parsePhoneNumber } = require('libphonenumber-js');
const moment = require('moment');
const constants = require("./constants");
const { v4: uuidv4, validate: validateUUID } = require('uuid');



const  validateProductsArray =  (input) => {
  if (input && typeof input === 'object' && Array.isArray(input.products)) {
    const { products } = input;
    if (products.every(item => typeof item === 'string') && products.length >= 1) {
      return { statusCode: 200,  body: JSON.stringify({ message: 'JSON validation successful' }) };
    } else {
      return { statusCode: 422, body: JSON.stringify({ error: 'Invalid input. "products" should be an array of strings with at least one productCode.'} ) };
    }
  } else {
    return { statusCode: 422, body: JSON.stringify({  error: 'Invalid input format. Input should be an object with a "products" property that is an array.'} )  };
  }
};

module.exports = {
    stringToBase64: (str) => { 
      return Buffer.from(str).toString('base64');
  },
  base64ToString: (base64Str) => {
    return Buffer.from(base64Str, 'base64').toString();
  },
  formatTime: (ms) => {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    return [
      h,
      m > 9 ? m : (h ? '0' + m : m || '0'),
      s > 9 ? s : '0' + s
    ].filter(Boolean).join(':');
  },
  generateFakeEmail: (employerName, unifiedFlag = false) => {
    if (unifiedFlag) {
      return null;
    }
    let employerEmailName = employerName ? employerName.replace(/\s+/ig, '_').toLowerCase() : null;
    return `el_${`${Math.floor(Math.random() * 9999)}`.padStart(4, '0')}${Date.now()}${`${Math.floor(Math.random() * 9999)}`.padStart(4, '0')}_${employerEmailName}@mydario.com`;
  },
  isFakeEmail: (email) => {
    if (email) {
      return email.match(/el_\d{10,}_.*@mydario\.com/) !== null;
    } else {
      return true
    }
  },
  hash: (str) => {
    var h = 0, l = str.length, i = 0;
    if (l > 0)
      while (i < l)
        h = (h << 5) - h + str.charCodeAt(i++) | 0;
    return `${h > 0 ? 'A' : 'B'}${Math.abs(h)}`;
  },
  tryParsePhoneNumber: (phone) => {
    if (!phone) return null;
    try {
      let parsed = parsePhoneNumber(phone, 'US');
      if (parsed.isValid()) return parsed.number;
      console.warn({ activity: 'tryParsePhoneNumber', warning: 'the provided phone number is invalid', value: phone });
    }
    catch (e) {
      console.error('ERROR in phone number.', e);
    }
    return null;
  },
  isMinorAge: (rules, userDob) => {
    return rules.targeting && rules.targeting.minor_age &&
      moment().diff(userDob, 'years', false) <= rules.targeting.minor_age ? true : false;
  },
  isEffectiveDate: (effective_date) => {

    if (effective_date) {
      let givenDate = new Date(effective_date)
      let diff = new Date().getTime() - givenDate.getTime();
      console.log("Current Date: ", new Date().getTime())
      console.log("Effective date: ", givenDate.getTime())
      if (diff >= 0) {
        //user is eligible
        return false
      }
    } else {
      //Handle no effective date (null) --> user is eligible
      return false
    }
    //user not eligible -> dont load to DB
    return true
  },
  uniqByKeepFirst: (a, keyfn) => {
    let seen = new Map();
    let duplicates = [];
    let uniques = a.filter((item,i) => {
        let k = keyfn(item.normalized);
        if(seen.has(k)){
            let _dup = seen.get(k);
            duplicates.push({index: i, match: _dup.index, item});
            return false;
        }
        return seen.set(k, {index: i});
    });
    return {uniques, duplicates};
  },
  uniqByKeepLast: (a, keyfn) => {
    let res = a.reduceRight((acc, item, i, arr) => {
      let k = keyfn(item.normalized);
      if(acc.seen.has(k)){
        let _dup = acc.seen.get(k);
        acc.dup.push({index: arr.length - i - 1, match: _dup.index, item});
      }
      else {
        acc.seen.set(k, {index: arr.length - i - 1});
        acc.u.push(item);
      }
      return acc;
    }, {u: [], dup: [], seen: new Map()});
    
    return {uniques: res.u, duplicates: res.dup};
  },
  isFutureDateOfBirth: (dob) => {
    const userDOB = new Date(dob).getTime();
    const todayDOB = new Date().getTime();

    if(userDOB < todayDOB) {
        return false;
    }

    return true;
  },
  isNumber: (value) =>{
    return !isNaN(parseFloat(value)) && isFinite(value);
  },
  validateEligibilityApiInputJson: (data, allowedFields, operation = 'create') => {

    // Check for unexpected fields
    const unexpectedFields = Object.keys(data).filter((key) => !allowedFields.includes(key));
    if (unexpectedFields.length > 0) {
      return {
        statusCode: 422,
        body: JSON.stringify({ error: `Unexpected field(s): ${unexpectedFields.join(', ')}` })
      };
    }


    // Check if enrollmentEnable is a boolean
    if (!('enrollmentEnable' in data) || typeof data.enrollmentEnable !== 'boolean') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid enrollmentEnable value' })
      };
    }

    // Check if employerId is a present and valid
    if (!('employerId' in data) || typeof data.employerId !== 'number') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid employerId value' })
      };
    }

    // Check if records is a non-empty array
    if (!('records' in data) || !Array.isArray(data.records) || data.records.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'records must be a non-empty array' })
      };
    }

    // Iterate over each record and validate required fields
    for (const record of data.records) {
      if (typeof record !== 'object' || Array.isArray(record)) {
        return {
          statusCode: 422,
          body: JSON.stringify({ error: 'Each record must be an object' })
        };

      }

      if (operation === 'update') {

        if (!record.hasOwnProperty('eid')) {
          return {
            statusCode: 422,
            body: JSON.stringify({ error: 'Each object in record must have an "eid" field' })
          };
        }
        if (!validateUUID(record.eid)) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              message: "Invalid UUID format for record.eid",
            })
          };

        }




      }

      if (operation === 'create') {

        if (!record.hasOwnProperty('email')) {
          return {
            statusCode: 422,
            body: JSON.stringify({ error: 'Each object in record must have an "email" field' })
          };
        }
        
        if (record.hasOwnProperty('products')) {
           return validateProductsArray(record);
        }

      }



    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'JSON validation successful' })
    };

  },
  checkDuplicateEmailOrPhone: (arr) => {
    const emailSet = new Set();
    const phoneSet = new Set();

    for (const item of arr) {
      const email = item.email;
      const phone = item.phone;

      if ((email && emailSet.has(email)) || (phone && phoneSet.has(phone))) {
        return false;
      } else {
        if (email) {
          emailSet.add(email);
        }
        if (phone) {
          phoneSet.add(phone);
        }
      }
    }

    return true;
  },
  validateEnrollmentInputJson: (input) => {
   return validateProductsArray(input);
  },
  isNumber: (value) =>{
    return !isNaN(parseFloat(value)) && isFinite(value);
  },
   hasKeys: (obj) =>{
    return Object.keys(obj).length > 0;
  },
  shouldUseBehaviour : (eligibilityRules, requiredBehaviour) => {
    return Array.isArray(eligibilityRules.behaviors) && eligibilityRules.behaviors.some(behaviour => behaviour === requiredBehaviour);
  }
}