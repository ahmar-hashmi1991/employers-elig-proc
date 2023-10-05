const processor = require('../handlers/reconciliation-report-handler');
const braze = require('../services/braze-service');
const fs = require('fs');

(async () => {
    console.log("START");

    // const params = {
    //     Bucket: 'aws-us-east-1-dario-employers-elig-proc-employersbucket-stage',
    //     Key: 'umr_test/WBWC246P_Med_20210209_111301.txt',
    // };

    // await processor.s3InsuranceClaimsFileHandler(params, {id: 4});
    // let stream = fs.createReadStream('https://appboy-02-data-export.s3.amazonaws.com/4XWB35pWbbrwkA0-ZcaLbdu4_nqh6CW6mcDzi19F3p4.zip');

    const filehist = [
        {
          id: 751,
          employer_id: 3,
          employer_upload_counter: 106,
          file_name: 'emblem/eligibility/incoming/Eligibility-2020121417-100015.csv',
          folder: 'emblem',
          status: 'success',
          notes: null,
          output: '{"summary":{"added":0,"updated":0,"removed":0,"startTime":1617787492521,"duration":4760}}',
          created_at: '2021-04-07T06:24:54.000Z',
          updated_at: '2021-04-07T06:24:58.000Z'
        }
      ]
    await processor.test('https://appboy-02-data-export.s3.amazonaws.com/HwpgQzR1jaGzmUI-Uw0T0iW5uhHf5odIONV4bi05bBU.zip', filehist);
    console.log("END");
})();