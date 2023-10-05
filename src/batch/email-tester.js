const emailSrv = require('../services/email-service');

(async () => {
    console.log("START");

    //env vars - SES_FROM_EMAIL, SES_TO_EMAIL
    process.env['SES_FROM_EMAIL'] = '"B2B Eligibility" <empl-elig-notifications@mydario.com>';
    process.env['SES_TO_EMAIL'] = 'ronw@mydario.com';

    let errorBody = {
      status: 500,
      error: { code: 11, description: 'apiInvalidResponse: null' }
    }

    // await emailSrv.sendTemplateEmail(`error in creation of Dario user during enrollment`, {
    //     error: JSON.stringify(errorBody),
    //     eid: '43298324jh-42k2j3423-kjh42kjh432-lj432'
    // }, 'failed-dario-user-creation');

    await emailSrv.sendTemplateEmail(`succesful file validation of employer ${'test_employer'}`, {
      step: 'Validation Success',
      datetime: new Date().toLocaleString(),
      employer: 'test_employer',
      employerId: '12345678',
      file: '/emp/test_employer.csv',
      totalRecords: 14543,
      duration: '23:32',
      stats: `new users ${43343}, update users: ${0}, remove users: ${65}`
  }, 'processing1')
    
    console.log("END");
})();