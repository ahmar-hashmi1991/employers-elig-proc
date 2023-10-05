const wayforward = require('../services/wayforward-service');
const upright = require('../services/upright-service');
const db = require('../services/rds-data-service');

const TEST_EMAIL_REGEX = '^testqa';

const wf_gender = {
  "female": "Female",
  "male": "Male",
  "transgenderfemale": "Transgender Female",
  "transgendermale": "Transgender Male",
  "variant": "Gender Variant / Non-conforming",
  "notlisted": "Not listed",
  "notanswer": "Prefer not to answer"
}

const gender_mapping = {
  m: 'male',
  f: 'female'
}

function wfGender(gender) {
  if(gender && gender_mapping[gender.toLowerCase()]){
    return gender_mapping[gender.toLowerCase()];
  }
  return 'notlisted';
}

exports.ProvisionToWayforweard= async (event, context) => {
    console.log('Wayforward Provisioning StepFunction Event', event);
    try {
      let email = event.email;
      let dario_ext_id = event.assigned.data.id;
      let firstName = event.eligibility.first_name;
      let lastName = event.eligibility.last_name;
      let phone = event.eligibility.shop_phone;
      let gender = wfGender(event.eligibility.gender);
      let dob = new Date(event.eligibility.dob);
      let birth_day = `${dob.getUTCDate()}`.padStart(2,'0');
      let birth_month = `${dob.getUTCMonth() + 1}`.padStart(2,'0');
      let birth_year = `${dob.getUTCFullYear()}`;
      let access_code = event.target.access_code;
      let eid = event.eligibility.eid;
      let country = event.eligibility.country

      if (access_code && typeof access_code == "object") {
        if (country && access_code[country]) {
          access_code = access_code[country]
        } else {
          access_code = access_code["US"]
        }
      }

      const isTestUser = recogniseTestUser(event.eligibility);

      let result = await wayforward.createWayforwardUser(
        email,
        firstName,
        lastName,
        phone,
        gender,
        birth_year,
        birth_month,
        birth_day,
        dario_ext_id,
        access_code,
        eid,
        isTestUser,
        country
      );

      console.log('Create wayforward user result:', result.body);
      return result.body;
    }
    catch (err) {
      let error = err.response ? JSON.stringify(err.response.body) : err;
      console.error('ERROR in wayforward provisioning.', error);
      throw error;
    }
  }

  exports.ProvisionToMSK= async (event, context) => {
    console.log('MSK Provisioning StepFunction Event', event);
    try {
      let [employers_list] = await db.getEmployerByID(event.eligibility.employer_id)
      let employer = employers_list[0]
      let products = event.eligibility.eligible_products
      let ordered = {
        'BP': false,
        'BG': false,
        'WM': false,
        'MSK': false,
        'PST': false,
        'BH': false,
        'EAP': false,
        'CVA': false
      }
      const isTestUser = recogniseTestUser(event.eligibility);
      const testUserValue = isTestUser ? 'Y' : 'N';

      for (const [prodName, value] of Object.entries(products)) {
        if (!value && !['MSK_PST', 'MSK_CVA'].includes(prodName)) {
          ordered[prodName.toUpperCase()] = true
        }
      }

      console.log('MSK Provisioning StepFunction products', products);

      // If it's the migrated account mark MSK as well
      if(typeof products.PST === 'boolean' && products.PST === true) {
        ordered.MSK = true,
        ordered.PST = true
      }

      // If it's the mixes MSK + PST mark them also as ordered
      if(typeof products.MSK_PST === 'boolean' && products.MSK_PST === false) {
        ordered.MSK = true,
        ordered.PST = true
      }
      if (typeof products.MSK_CVA === 'boolean' && products.MSK_CVA === false) {
        ordered.MSK = true,
        ordered.CVA = true
      }

      let result = await upright.createMSKUser(
        event.email,
        event.eligibility.eid,
        event.eligibility.first_name,
        event.eligibility.last_name,
        event.eligibility.shop_phone,
        employer.external_id,
        event.assigned.data.id,
        ordered,
        testUserValue
      );

      console.log('Create upright MSK user result:', result.body);
      return result.body;
    }
    catch(e) {
      let err = e.response ? e.response.body : e;
      if(err.error === 'ConflictError' && err.message === 'User already exists'){
        console.error('User aleady exists in upright provisioning.');
        return err;
      }
      console.error('ERROR in upright provisioning.', err);
      throw err;
    }
  }

function recogniseTestUser(userRecord) {
  const regexp = new RegExp(TEST_EMAIL_REGEX, 'gm');
  const isTestEmail = regexp.test(userRecord.email);

  const isTestRecord = !!userRecord.test_record;

  if (!isTestEmail && !isTestRecord) {
    return false;
  }

  if (isTestRecord && !isTestRecord) {
    return true;
  }

  return true;
}
