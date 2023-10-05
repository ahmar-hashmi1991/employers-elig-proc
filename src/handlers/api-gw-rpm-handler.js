const db = require('../services/rds-data-service');
const constants = require('../common/constants');
const uuid = require('uuid');

const response = (code, status, body) => {
  console.log('res', code, status, body)
  return {
    statusCode: code,
    body: JSON.stringify({data: body, status}),
    headers: {
      'Content-Type': 'application/json',
    }
  }
}

exports.checkRpmUserAPIRequest = async (event, context) => {
    console.log('event', event);
    const body = JSON.parse(event.body);
    console.log('checkRpmUserAPIRequest-body', body);

    if (!body.email || !body.employer_id) {
      const paramName = !body.email ? 'email' : 'employer id';
      return response(400, 'error', `Missing ${paramName} parameter`);
    }

    let [user] = await db.getActiveRpmUser(body.email, body.employer_id);
    console.log('rpm user', JSON.stringify(user), JSON.stringify(user[0]));
    if (user.length < 1) {
      return response(200, 'error', {});
    }

    return response(200, 'success', user[0]);
}

exports.addPatientByMrnID = async (event, context) => {
  console.log('event', event);

  const body = JSON.parse(event.body);

  console.log('addPatientByMrnID-body', body);

  if (!body.mrn || !body.employer_id) {
    const paramName = !body.mrn ? 'mrn' : 'employer id';
    return response(400, 'error', `Missing ${paramName} parameter`);
  }
  const [emp] = await db.getEmployer(body.employer_id);
  console.log('emp', JSON.stringify(emp), JSON.stringify(emp[0]))

  if (emp.length < 1) {
    return response(404, 'error', `Employer is not exists`);
  }
  const [eligibleUser] = await db.getEligibilityByResellerRoleEmpId(body.mrn, emp[0].id, constants.EligibilityRole.EMPLOYEE);
  console.log('eligibleUser', JSON.stringify(eligibleUser), JSON.stringify(eligibleUser[0]));

  const phone = body.phone ? body.phone : null

  if (eligibleUser.length < 1) {
    const [newEligibleUser] = await db.addEligibility({ reseller_employee_id: body.mrn, eid: uuid.v4(), phone: phone, record_source: constants.Behaviors.ADD_ELIGIBLE_BY_RPM }, emp[0].id, constants.EligibilityStatus.ELIGIBLE)
    console.log('newEligibleUser', newEligibleUser) 
  }

  const message = eligibleUser.length < 1 ? 'This user added' : 'This user already exists';
  return response(200, 'success', { message });
}