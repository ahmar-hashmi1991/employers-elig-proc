const AWS = require('aws-sdk');
const BUCKET = process.env.ArchiveBucket;
const s3 = new AWS.S3();
const db = require('../../services/rds-data-service');


exports.employerFileDownloadHandler = async (event, context) => {

    console.log('event in the file employerFileDownloadHandler ', event);
    try {
        const employerId =  event.pathParameters.employerId;
        let [emp] = await db.getEmployer(employerId);
        console.log('inside the emp', emp[0].file_path)
         /* let pathArray = emp[0].file_path.split('/');
        console.log('pathArray', pathArray)
        let fileName = pathArray[pathArray.length-1];
        console.log('fileName',fileName)*/
        if (!emp) {
            return {
                statusCode: 409,
                result: 'Something went wrong, Please try after sometime ',
            };
        } else if(!!emp[0].file_path) {
       /*     const params = {
                Bucket: BUCKET,
                Key: `employer_files/${employerId}/${fileName}`
            };
            console.log('call inside the if ', params)
            const res = await s3.getSignedUrlPromise('getObject', params)
            console.log('CONTENT TYPE:', res);
            if (!!res) {*/
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        status: 'SUCCESS',
                        result: emp[0].file_path
                    })
                };
      /*      } else {
                return {
                    statusCode: 409,
                    body: JSON.stringify({status: 'Something went wrong'}),
                    result: res
                };
            }*/
        } else{
            return {
                statusCode: 500,
                result: 'There is no File To Download',
            };
        }
    } catch (err) {
        console.log('call inside the catch block ', err)
        return {
            statusCode: 500,
            body: err
        }
    }
}
