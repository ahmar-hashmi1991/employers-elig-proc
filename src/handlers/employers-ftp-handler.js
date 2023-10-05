// Create clients outside of the handler
const AWS = require('aws-sdk');
const db = require('../services/rds-data-service');
const Client = require('ssh2').Client;
const { promisify } = require('util');

const s3 = new AWS.S3();

/**
  * A Lambda function that logs the payload received from S3.
  */
exports.employersFTPFileHandler = async (event, context) => {
  console.log('event', JSON.stringify(event));

  let [employers, employers_flds] = await db.getAllEmployers();
  console.log(`found ${employers.length} employers....`);

  for (employer of employers) {
    if(employer.external_ftp && !!employer.ftp_info && employer.status === 'active'){
      console.log(`Processing external FTP for employer ---> ${employer.name} (${employer.external_id})`);
      let ftp_info = JSON.parse(employer.ftp_info);
      let ftpconn = ftp_info.server;
      let folder = ftp_info.folder;
      let bucket = event.bucket;
      let s3folder = employer.folder;
      let file_name_filter = employer.file_name_filter ? employer.file_name_filter : '.+\.csv$';

      if(ftpconn.privateKey) ftpconn.privateKey = Buffer.from(ftpconn.privateKey, 'base64').toString('utf8');
      let sftp = await exports.connetToFTP(ftpconn);
      
      let files = await promisify(sftp.readdir).bind(sftp)(folder);
      console.log('ftp files: ', files);
      files = files.filter(f => f.filename.match(new RegExp(file_name_filter)) && !f.filename.endsWith('.done'));
      console.log('ftp csv files for processing: ', files);

      for(file of files){
        let result = await exports.processIncomingEligibilityFile(sftp, folder, file.filename, bucket, s3folder);
        console.log('File transfer sftp --> S3 result ---> ', result);
        await promisify(sftp.rename).bind(sftp)(`${folder}/${file.filename}`, `${folder}/${file.filename}.done`);
      }
    }
    else {
      console.log(`No external FTP for employer or employer is not active ---> ${employer.name} (${employer.external_id})`);
    }
  }

  const result = {
    statusCode: 200,
    body: JSON.stringify({ status: 'SUCCESS' }),
  };
  return result;
};

exports.processIncomingEligibilityFile = (sftp, folder, filename, bucket, s3folder) => {
  console.log(`processing ${filename}...`);
  const rstream = sftp.createReadStream(`${folder}/${filename}`);
  const params = {Bucket: bucket, Key: `${s3folder}/${filename}`, Body: rstream};
  return s3.upload(params).promise();
}

exports.connetToFTP = (connection) => {
  return new Promise((resolve,reject) => {
    let conn = new Client();
    conn.on('ready', function () {
      console.log('Client :: ready');
      conn.sftp(function (err, sftp) {
        if (err) reject(err);
        resolve(sftp);
      });
    }).connect(connection);
  })
}
